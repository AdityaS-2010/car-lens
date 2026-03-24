// background.js
// Service worker for the CarLens extension (Manifest V3).
// Handles opening CARFAX report tabs and extracting data from them.

chrome.runtime.onInstalled.addListener(() => {
  console.log("[CarLens] Extension installed / updated.");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CARLENS_LOG") {
    console.log("[CarLens background]", message.payload);
    sendResponse({ status: "received" });
    return false;
  }

  if (message.type === "FETCH_REPORT") {
    handleFetchReport(message.url)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ data: null, error: err.message }));
    return true; // keep channel open for async response
  }
});

async function handleFetchReport(reportUrl) {
  console.log("[CarLens background] Opening report tab:", reportUrl);

  let tab;
  try {
    tab = await chrome.tabs.create({ url: reportUrl, active: false });
  } catch (err) {
    return { data: null, error: "Could not open report tab: " + err.message };
  }

  // Wait for initial page load
  try {
    await waitForTabLoad(tab.id, 20000);
  } catch (err) {
    await safeCloseTab(tab.id);
    return { data: null, error: "Report page took too long to load" };
  }

  // Step 1: Wait for React hydration, then scroll + expand to trigger lazy content
  await sleep(3000);

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: prepareReportPage,
    });
  } catch (err) {
    console.warn("[CarLens background] Prepare script failed:", err.message);
  }

  // Step 2: Wait for lazy-loaded content to render after scrolling
  await sleep(4000);

  // Step 3: Extract all data from the fully rendered page
  let extractionResult;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractReportFromTab,
    });
    extractionResult = results?.[0]?.result || null;
  } catch (err) {
    await safeCloseTab(tab.id);
    return { data: null, error: "Could not extract data from report tab: " + err.message };
  }

  await safeCloseTab(tab.id);

  if (!extractionResult || extractionResult.length < 50) {
    return { data: null, error: "Report page loaded but no structured data found — React may not have rendered the content" };
  }

  console.log("[CarLens background] Extracted report length:", extractionResult.length);
  return { data: extractionResult, error: null };
}

// ── STEP 1: Injected into report tab to scroll & expand everything ──
function prepareReportPage() {
  // Scroll through the entire page to trigger lazy-loading
  const scrollStep = window.innerHeight;
  const maxScroll = document.body.scrollHeight;
  let pos = 0;

  function scrollDown() {
    pos += scrollStep;
    window.scrollTo(0, pos);
    if (pos < maxScroll) {
      setTimeout(scrollDown, 200);
    } else {
      // Scroll back to top when done
      window.scrollTo(0, 0);
    }
  }
  scrollDown();

  // Click all expand/accordion/show-more buttons
  const expandSelectors = [
    '[aria-expanded="false"]',
    'button[class*="accordion"]',
    '[class*="expand"]',
    '[role="button"][aria-expanded="false"]',
    'summary',
  ];

  for (const sel of expandSelectors) {
    try {
      document.querySelectorAll(sel).forEach((el) => el.click());
    } catch (e) { /* ignore */ }
  }

  // Click any buttons with relevant text
  document.querySelectorAll("button, [role='button'], summary, [tabindex='0']").forEach((el) => {
    const text = el.textContent.trim().toLowerCase();
    if (
      text.includes("show more") || text.includes("see more") ||
      text.includes("view all") || text.includes("detailed history") ||
      text.includes("service history") || text.includes("show all")
    ) {
      if (el.getAttribute("aria-expanded") !== "true") {
        try { el.click(); } catch (e) { /* ignore */ }
      }
    }
  });
}

// ── STEP 2: Injected into report tab to extract all report data ──
function extractReportFromTab() {
  const pageText = document.body.innerText;
  const report = [];

  // ── Helper: extract text between section headers ──
  function extractSection(startPattern, stopPatterns, maxLines) {
    const startIdx = pageText.search(startPattern);
    if (startIdx === -1) return null;

    let endIdx = pageText.length;
    for (const stop of stopPatterns) {
      const idx = pageText.indexOf(stop, startIdx + 50);
      if (idx !== -1 && idx < endIdx) endIdx = idx;
    }

    const sectionText = pageText.substring(startIdx, endIdx);
    const lines = sectionText.split("\n").map((l) => l.trim()).filter((l) => l.length > 2);
    return lines.slice(0, maxLines).join("\n");
  }

  // ── 1. DETAILED HISTORY — the most important section ──
  // This contains every service record, ownership event, title event etc.
  // It's structured as: Date | Mileage | Source | Comments
  // We want to grab as much as possible (up to 200 lines).
  const detailedSection = extractSection(
    /Detailed\s*History/i,
    ["Have Questions", "Glossary", "CARFAX DEPENDS ON", "© 20"],
    200
  );
  if (detailedSection) {
    report.push("=== DETAILED HISTORY (Service Records, Title Events, Ownership) ===\n" + detailedSection);
  }

  // ── 2. Also try to extract from HTML tables directly ──
  // CARFAX renders the detailed history as tables with rows
  const tables = document.querySelectorAll("table");
  const tableData = [];
  for (const table of tables) {
    const rows = table.querySelectorAll("tr");
    for (const row of rows) {
      const cells = row.querySelectorAll("td, th");
      if (cells.length >= 2) {
        const rowText = Array.from(cells).map((c) => c.innerText.replace(/\s+/g, " ").trim()).join(" | ");
        if (rowText.length > 5 && rowText.length < 500) {
          tableData.push(rowText);
        }
      }
    }
    if (tableData.length >= 100) break;
  }
  if (tableData.length > 0) {
    report.push("=== TABLE DATA ===\n" + tableData.join("\n"));
  }

  // ── 3. Try data-testid rows (React rendered service events) ──
  const historyRows = document.querySelectorAll(
    "[data-testid='detailed-history-event'], [data-testid='history-event'], " +
    ".history-record, .history-table-row, [data-testid='service-record']"
  );
  if (historyRows.length > 0) {
    const events = [];
    for (const row of historyRows) {
      const text = row.innerText.replace(/\s+/g, " ").trim();
      if (text.length > 5 && text.length < 600) events.push(text);
      if (events.length >= 80) break;
    }
    if (events.length > 0) {
      report.push("=== HISTORY EVENT ELEMENTS ===\n" + events.join("\n"));
    }
  }

  // ── 4. Additional History (Total Loss, Structural Damage, Airbag, Odometer, etc.) ──
  const additionalSection = extractSection(
    /Additional\s*History/i,
    ["Title History", "Ownership History", "Detailed History"],
    40
  );
  if (additionalSection) report.push("=== ADDITIONAL HISTORY ===\n" + additionalSection);

  // ── 5. Title History ──
  const titleSection = extractSection(
    /Title\s*History/i,
    ["Ownership History", "Detailed History", "GUARANTEED"],
    25
  );
  if (titleSection) report.push("=== TITLE HISTORY ===\n" + titleSection);

  // ── 6. Ownership History ──
  const ownershipSection = extractSection(
    /Ownership\s*History/i,
    ["Detailed History", "Service History", "Last serviced"],
    30
  );
  if (ownershipSection) report.push("=== OWNERSHIP HISTORY ===\n" + ownershipSection);

  // ── 7. Accident / Damage History ──
  const accidentSection = extractSection(
    /Accident\s*\/?\s*Damage\s*History/i,
    ["Title History", "Additional History", "Ownership History", "Detailed History", "Recent Service"],
    25
  );
  if (accidentSection) report.push("=== ACCIDENT / DAMAGE HISTORY ===\n" + accidentSection);

  // ── 8. Recent Service Highlights ──
  const serviceHighlights = extractSection(
    /Recent\s*Service\s*Highlights/i,
    ["Reliability Forecast", "Additional History", "Accident"],
    20
  );
  if (serviceHighlights) report.push("=== RECENT SERVICE HIGHLIGHTS ===\n" + serviceHighlights);

  // ── 9. Reliability Forecast ──
  const reliabilitySection = extractSection(
    /Reliability\s*Forecast/i,
    ["Additional History", "Accident", "Title History"],
    15
  );
  if (reliabilitySection) report.push("=== RELIABILITY FORECAST ===\n" + reliabilitySection);

  // ── 10. Certified Pre-Owned info ──
  const cpoMatch = pageText.match(/(Certified Pre-Owned[\s\S]{0,500}?(?:warranty|inspection|roadside)[\s\S]{0,200}?period)/i);
  if (cpoMatch) {
    report.push("=== CERTIFIED PRE-OWNED ===\n" + cpoMatch[0].replace(/\s+/g, " ").trim());
  }

  // ── 11. Status flags from the full page ──
  const statusFlags = [];
  const checks = [
    [/no\s+total\s+loss/i, "No total loss reported", null],
    [/total\s+loss.*reported/i, "TOTAL LOSS REPORTED", /no\s+total\s+loss/i],
    [/no\s+(?:issues\s+)?(?:structural\s+damage|issues\s+reported)/i, "No structural damage reported", null],
    [/structural\s+damage.*reported/i, "STRUCTURAL DAMAGE REPORTED", /no\s+(?:issues|structural)/i],
    [/no\s+airbag\s+deploy/i, "No airbag deployment reported", null],
    [/airbag\s+deploy/i, "AIRBAG DEPLOYED", /no\s+airbag/i],
    [/no\s+(?:indication|issues).*odometer/i, "No odometer issues indicated", null],
    [/odometer\s+rollback/i, "ODOMETER ROLLBACK INDICATED", /no\s+(?:indication|issues)/i],
    [/warranty\s+expired/i, "Warranty expired", null],
    [/warranty\s+active/i, "Warranty active", null],
    [/guaranteed\s+no\s+problem/i, "Title: Guaranteed No Problem", null],
    [/no\s+accidents?\s+or\s+damage\s+reported/i, "No accidents or damage reported", null],
    [/no\s+open\s+recalls/i, "No open recalls", null],
  ];
  for (const [pattern, label, negative] of checks) {
    if (pattern.test(pageText)) {
      if (negative && negative.test(pageText)) continue;
      statusFlags.push(label);
    }
  }
  if (statusFlags.length > 0) {
    report.push("=== STATUS FLAGS ===\n" + [...new Set(statusFlags)].join("\n"));
  }

  // ── 12. Damage detail lines ──
  const damageDetails = [];
  const lines = pageText.split("\n");
  for (const line of lines) {
    const t = line.trim();
    const lower = t.toLowerCase();
    if (
      (lower.includes("damage reported") && /\d/.test(t)) ||
      /(?:rear|front|side|left|right)\s*(?:impact|damage)/i.test(t) ||
      /(?:moderate|minor|severe|functional|disabling)\s*damage/i.test(t) ||
      lower.includes("rollover") ||
      (lower.includes("accident") && lower.includes("reported") && /\d{2}\/\d{2}/.test(t))
    ) {
      if (t.length > 5 && t.length < 300) damageDetails.push(t);
    }
  }
  if (damageDetails.length > 0) {
    report.push("=== SPECIFIC DAMAGE DETAILS ===\n" + damageDetails.join("\n"));
  }

  // ── Debug: log what we found ──
  console.log("[CarLens Report Extractor] Sections found:", report.length);
  console.log("[CarLens Report Extractor] Total chars:", report.join("").length);
  console.log("[CarLens Report Extractor] Page text length:", pageText.length);
  console.log("[CarLens Report Extractor] Tables found:", tables.length);
  console.log("[CarLens Report Extractor] First 200 chars of page:", pageText.substring(0, 200));

  return report.length > 0 ? report.join("\n\n") : null;
}

function waitForTabLoad(tabId, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Tab load timeout"));
    }, timeout);

    function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);

    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }).catch(() => {});
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeCloseTab(tabId) {
  try {
    await chrome.tabs.remove(tabId);
  } catch (e) {
    // Tab may already be closed
  }
}
