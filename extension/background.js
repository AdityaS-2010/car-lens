// background.js
// Service worker for the CarLens extension (Manifest V3).
// Handles opening CARFAX tabs for report extraction and comparable price scraping.

chrome.runtime.onInstalled.addListener(() => {
  console.log("[CarLens] Extension installed / updated.");
});

// ── Message Router ──────────────────────────────────────────────────

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
    return true;
  }

  if (message.type === "FETCH_COMPARABLE_PRICES") {
    handleFetchComparablePrices(message.make, message.model, message.year, message.location)
      .then((result) => sendResponse(result))
      .catch((err) => {
        console.warn("[CarLens background] Comps error:", err.message);
        sendResponse(null);
      });
    return true;
  }
});

// ── CARFAX Report Extraction ────────────────────────────────────────

async function handleFetchReport(reportUrl) {
  console.log("[CarLens background] Opening report tab:", reportUrl);

  let tab;
  try {
    tab = await chrome.tabs.create({ url: reportUrl, active: false });
  } catch (err) {
    return { data: null, error: "Could not open report tab: " + err.message };
  }

  try {
    await waitForTabLoad(tab.id, 20000);
  } catch (err) {
    await safeCloseTab(tab.id);
    return { data: null, error: "Report page took too long to load" };
  }

  // Wait for React hydration, then scroll + expand
  await sleep(3000);

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: prepareReportPage,
    });
  } catch (err) {
    console.warn("[CarLens background] Prepare script failed:", err.message);
  }

  // Wait for lazy-loaded content
  await sleep(4000);

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

// ── Comparable Prices Scraping ──────────────────────────────────────

async function handleFetchComparablePrices(make, model, _year, location) {
  // _year is available for future use but we search by make+model only —
  // trim and exact year are too restrictive (e.g. C300 vs C63 is huge, but
  // 2023 vs 2024 of the same model is fine to compare)
  if (!make || !model) return null;

  // Normalize for CARFAX URL: "Grand Cherokee" → "Grand-Cherokee"
  const makePart = make.trim().replace(/\s+/g, "-");
  const modelPart = model.trim().replace(/\s+/g, "-");

  // Build tiered search URLs — search by make+model (no trim, no exact year)
  const tiers = [];

  // Tier 1: make+model in same area
  if (location) {
    const locMatch = location.match(/^([^,]+),\s*([A-Z]{2})$/);
    if (locMatch) {
      const city = locMatch[1].trim().replace(/\s+/g, "-");
      const state = locMatch[2];
      tiers.push({
        tier: 1,
        label: "your area",
        url: `https://www.carfax.com/Used-${makePart}-${modelPart}_${city}-${state}/`,
      });
    }
  }

  // Tier 2: make+model nationwide
  tiers.push({
    tier: 2,
    label: "nationwide",
    url: `https://www.carfax.com/Used-${makePart}-${modelPart}/`,
  });

  for (const { tier, label, url } of tiers) {
    console.log(`[CarLens background] Comps Tier ${tier} (${label}):`, url);

    let tab;
    try {
      tab = await chrome.tabs.create({ url, active: false });
    } catch (err) {
      console.warn("[CarLens background] Could not open comps tab:", err.message);
      continue;
    }

    try {
      await waitForTabLoad(tab.id, 15000);
    } catch (err) {
      await safeCloseTab(tab.id);
      continue;
    }

    // Wait for React hydration
    await sleep(3000);

    // Scroll the page to trigger lazy-loaded listings
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: function () {
          window.scrollTo(0, document.body.scrollHeight / 2);
          setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 500);
          setTimeout(() => window.scrollTo(0, 0), 1000);
        },
      });
    } catch (e) { /* ignore */ }

    // Wait for lazy content to load after scrolling
    await sleep(2000);

    let listings;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapeComparablePrices,
      });
      listings = results?.[0]?.result || [];
    } catch (err) {
      console.warn("[CarLens background] Comps scrape failed:", err.message);
      await safeCloseTab(tab.id);
      continue;
    }

    await safeCloseTab(tab.id);

    console.log(`[CarLens background] Tier ${tier}: found ${listings.length} listings`);

    if (listings.length >= 2) {
      const prices = listings.map((l) => l.price);
      return {
        tier,
        tier_label: label,
        count: listings.length,
        avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
        min: Math.min(...prices),
        max: Math.max(...prices),
        listings: listings.slice(0, 15),
      };
    }
  }

  return null;
}

// ── Injected Functions (fully self-contained) ───────────────────────

// Scrolls the page and expands collapsed sections in the CARFAX report
function prepareReportPage() {
  const scrollStep = window.innerHeight;
  const maxScroll = document.body.scrollHeight;
  let pos = 0;

  function scrollDown() {
    pos += scrollStep;
    window.scrollTo(0, pos);
    if (pos < maxScroll) {
      setTimeout(scrollDown, 200);
    } else {
      window.scrollTo(0, 0);
    }
  }
  scrollDown();

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

// Extracts detailed report data from the rendered CARFAX report page
function extractReportFromTab() {
  const pageText = document.body.innerText;
  const report = [];

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

  // Detailed History — the most important section
  const detailedSection = extractSection(
    /Detailed\s*History/i,
    ["Have Questions", "Glossary", "CARFAX DEPENDS ON", "\u00a9 20"],
    200
  );
  if (detailedSection) {
    report.push("=== DETAILED HISTORY (Service Records, Title Events, Ownership) ===\n" + detailedSection);
  }

  // HTML tables
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

  // React data-testid rows
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

  // Additional History
  const additionalSection = extractSection(
    /Additional\s*History/i,
    ["Title History", "Ownership History", "Detailed History"],
    40
  );
  if (additionalSection) report.push("=== ADDITIONAL HISTORY ===\n" + additionalSection);

  // Title History
  const titleSection = extractSection(
    /Title\s*History/i,
    ["Ownership History", "Detailed History", "GUARANTEED"],
    25
  );
  if (titleSection) report.push("=== TITLE HISTORY ===\n" + titleSection);

  // Ownership History
  const ownershipSection = extractSection(
    /Ownership\s*History/i,
    ["Detailed History", "Service History", "Last serviced"],
    30
  );
  if (ownershipSection) report.push("=== OWNERSHIP HISTORY ===\n" + ownershipSection);

  // Accident / Damage History
  const accidentSection = extractSection(
    /Accident\s*\/?\s*Damage\s*History/i,
    ["Title History", "Additional History", "Ownership History", "Detailed History", "Recent Service"],
    25
  );
  if (accidentSection) report.push("=== ACCIDENT / DAMAGE HISTORY ===\n" + accidentSection);

  // Recent Service Highlights
  const serviceHighlights = extractSection(
    /Recent\s*Service\s*Highlights/i,
    ["Reliability Forecast", "Additional History", "Accident"],
    20
  );
  if (serviceHighlights) report.push("=== RECENT SERVICE HIGHLIGHTS ===\n" + serviceHighlights);

  // Reliability Forecast
  const reliabilitySection = extractSection(
    /Reliability\s*Forecast/i,
    ["Additional History", "Accident", "Title History"],
    15
  );
  if (reliabilitySection) report.push("=== RELIABILITY FORECAST ===\n" + reliabilitySection);

  // CPO info
  const cpoMatch = pageText.match(/(Certified Pre-Owned[\s\S]{0,500}?(?:warranty|inspection|roadside)[\s\S]{0,200}?period)/i);
  if (cpoMatch) {
    report.push("=== CERTIFIED PRE-OWNED ===\n" + cpoMatch[0].replace(/\s+/g, " ").trim());
  }

  // Status flags
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

  // Damage detail lines
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

  console.log("[CarLens Report Extractor] Sections found:", report.length);
  console.log("[CarLens Report Extractor] Total chars:", report.join("").length);

  return report.length > 0 ? report.join("\n\n") : null;
}

// Scrapes listing prices from a CARFAX search results page
function scrapeComparablePrices() {
  const listings = [];
  const seen = new Set();

  // Debug: log page state so we can diagnose scraping failures
  console.log("[CarLens Comps] Page title:", document.title);
  console.log("[CarLens Comps] Page URL:", window.location.href);
  console.log("[CarLens Comps] Body text length:", document.body.innerText.length);

  // Try multiple selector strategies — CARFAX React app uses different ones
  const selectorSets = [
    // Known CARFAX SRP selectors
    "[data-testid='srp-listing-card']",
    "[data-testid='listing-card']",
    ".srp-listing-card",
    ".listing-card",
    ".srp-list-item",
    "article[class*='listing']",
    // Generic card-like containers that hold price + vehicle info
    "[class*='vehicle-card']",
    "[class*='VehicleCard']",
    "[class*='result-tile']",
    "[class*='ResultTile']",
    "[data-testid*='vehicle']",
    "[data-testid*='listing']",
  ];

  let cards = [];
  for (const sel of selectorSets) {
    const found = document.querySelectorAll(sel);
    if (found.length > cards.length) {
      cards = found;
      console.log("[CarLens Comps] Best selector so far:", sel, "→", found.length, "cards");
    }
  }

  // Fallback: find any container that has both a $ price and a year
  if (cards.length === 0) {
    console.log("[CarLens Comps] No cards from selectors, trying generic containers...");
    const allContainers = document.querySelectorAll("div, section, li, article");
    const candidates = [];
    for (const el of allContainers) {
      const text = el.innerText || "";
      // Must have a price and a year, and be reasonably sized (not the whole page)
      if (text.length > 20 && text.length < 800 && /\$[\d,]+/.test(text) && /\b20\d{2}\b/.test(text)) {
        // Skip if it contains too many other price patterns (probably a parent container)
        const priceCount = (text.match(/\$[\d,]+/g) || []).length;
        if (priceCount <= 2) {
          candidates.push(el);
        }
      }
    }
    if (candidates.length >= 2) {
      cards = candidates;
      console.log("[CarLens Comps] Found", candidates.length, "generic card candidates");
    }
  }

  for (const card of cards) {
    const text = card.innerText || "";

    const priceMatch = text.match(/\$([\d,]+)/);
    if (!priceMatch) continue;
    const price = parseInt(priceMatch[1].replace(/,/g, ""));
    if (price < 1000 || price > 500000) continue;

    const yearMatch = text.match(/\b((?:19|20)\d{2})\b/);
    const year = yearMatch ? parseInt(yearMatch[1]) : null;

    const mileageMatch = text.match(/([\d,]+)\s*(?:mi|miles)/i);
    const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, "")) : null;

    // Get the listing URL
    const link = card.querySelector("a[href*='carfax.com']") || card.querySelector("a[href]");
    const parentLink = card.closest("a[href]");
    const url = (link && link.href) || (parentLink && parentLink.href) || null;

    const key = `${price}-${year}-${mileage}`;
    if (seen.has(key)) continue;
    seen.add(key);

    listings.push({ price, year, mileage, url });
    if (listings.length >= 15) break;
  }

  // Last resort fallback: regex the entire page text for price+mileage pairs
  if (listings.length === 0) {
    console.log("[CarLens Comps] Card scraping failed, falling back to text regex...");
    const allText = document.body.innerText;
    // Look for patterns like "$45,985 • 12,000 mi" or "$45,985\n2024\n12,000 mi"
    const pricePattern = /\$([\d,]+)/g;
    let match;
    while ((match = pricePattern.exec(allText)) !== null && listings.length < 15) {
      const price = parseInt(match[1].replace(/,/g, ""));
      if (price < 1000 || price > 500000) continue;
      // Look for mileage nearby (within 200 chars after price)
      const nearby = allText.substring(match.index, match.index + 200);
      const miMatch = nearby.match(/([\d,]+)\s*(?:mi|miles)/i);
      const mileage = miMatch ? parseInt(miMatch[1].replace(/,/g, "")) : null;
      const yearMatch = nearby.match(/\b((?:19|20)\d{2})\b/);
      const year = yearMatch ? parseInt(yearMatch[1]) : null;
      if (mileage || year) {
        const key = `${price}-${year}-${mileage}`;
        if (!seen.has(key)) {
          seen.add(key);
          listings.push({ price, year, mileage, url: null });
        }
      }
    }
  }

  console.log("[CarLens Comps] Final result:", listings.length, "listings");
  if (listings.length > 0) {
    console.log("[CarLens Comps] Sample:", JSON.stringify(listings[0]));
  }
  return listings;
}

// ── Utility Functions ───────────────────────────────────────────────

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
