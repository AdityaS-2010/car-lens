// content.js
// Injected on CARFAX listing pages. Extracts car data from the DOM,
// sends it to the CarLens backend, and displays the verdict overlay.

(function () {
  "use strict";

  if (document.getElementById("carlens-overlay")) return;

  const BACKEND_URL = "http://localhost:5000/analyze";

  // Track the current URL so we can detect navigation
  let lastUrl = window.location.href;

  // ── Extraction Helpers ────────────────────────────────────────────────

  function extractNumber(text) {
    if (!text) return null;
    const cleaned = text.replace(/[^0-9.]/g, "");
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }

  function textFromSelectors(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) return el.textContent.trim();
    }
    return null;
  }

  // ── Structured Data Extraction (JSON-LD / meta tags) ────────────────

  function extractStructuredData() {
    const data = {};

    const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of ldScripts) {
      try {
        const json = JSON.parse(script.textContent);
        const items = Array.isArray(json) ? json : [json];
        for (const item of items) {
          if (item["@type"] === "Car" || item["@type"] === "Vehicle" || item["@type"] === "Product") {
            if (item.name) data.title = item.name;
            if (item.vehicleIdentificationNumber) data.vin = item.vehicleIdentificationNumber;
            if (item.mileageFromOdometer) {
              data.mileage = extractNumber(
                typeof item.mileageFromOdometer === "object"
                  ? item.mileageFromOdometer.value
                  : item.mileageFromOdometer
              );
            }
            if (item.offers) {
              const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
              if (offer.price) data.price = extractNumber(offer.price);
            }
            if (item.brand) {
              data.make = typeof item.brand === "object" ? item.brand.name : item.brand;
            }
            if (item.model) data.model = item.model;
            if (item.vehicleModelDate) data.year = parseInt(item.vehicleModelDate);
          }
        }
      } catch (e) { /* skip invalid JSON-LD */ }
    }

    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle && !data.title) data.title = ogTitle.content;

    return data;
  }

  // ── CARFAX Data Extraction ──────────────────────────────────────────

  function extractCarData() {
    const pageText = document.body.innerText;
    const structured = extractStructuredData();

    // ── VIN
    let vin = null;
    const urlVinMatch = window.location.pathname.match(/\/vehicle\/([A-HJ-NPR-Z0-9]{17})/i);
    if (urlVinMatch) {
      vin = urlVinMatch[1].toUpperCase();
    } else {
      const vinText = textFromSelectors([".vin-number", "[data-testid='vin-value']"]);
      if (vinText) {
        const vinMatch = vinText.match(/([A-HJ-NPR-Z0-9]{17})/i);
        if (vinMatch) vin = vinMatch[1].toUpperCase();
      }
      if (!vin) vin = structured.vin || null;
      if (!vin) {
        const pageVinMatch = pageText.match(/(?:VIN[:\s]*)?([A-HJ-NPR-Z0-9]{17})/i);
        if (pageVinMatch) vin = pageVinMatch[1].toUpperCase();
      }
    }

    // ── Title / Year / Make / Model / Trim
    let titleText = structured.title || "";
    if (!titleText) {
      titleText = textFromSelectors([
        "h1",
        "[data-testid*='ehicle']",
        "[class*='ehicle'][class*='itle']",
        "[class*='ehicle'][class*='ame']",
      ]) || "";
    }

    let year = structured.year || null;
    let make = structured.make || null;
    let model = structured.model || null;
    let trim = null;

    const titleMatch = titleText.match(/(\d{4})\s+([A-Za-z][A-Za-z-]+)\s+(.+)/);
    if (titleMatch) {
      if (!year) year = parseInt(titleMatch[1]);
      if (!make) make = titleMatch[2];
      const rest = titleMatch[3].trim();
      if (!model) {
        const modelParts = rest.split(/\s+/);
        model = modelParts[0];
        if (modelParts.length > 1) {
          trim = modelParts.slice(1).join(" ");
        }
      } else if (!trim) {
        const trimText = rest.replace(model, "").trim();
        if (trimText) trim = trimText;
      }
    }

    if (!year || !make || !model) {
      const pageMatch = pageText.match(/((?:Used|New|Certified)\s+)?(\d{4})\s+([A-Za-z][A-Za-z-]+)\s+([A-Za-z0-9][^\n$]{1,40})/);
      if (pageMatch) {
        if (!year) year = parseInt(pageMatch[2]);
        if (!make) make = pageMatch[3];
        if (!model) {
          const rest = pageMatch[4].trim();
          const parts = rest.split(/\s+/);
          model = parts[0];
          if (!trim && parts.length > 1) trim = parts.slice(1).join(" ");
        }
      }
    }

    // ── Price + Mileage
    let price = structured.price || null;
    let mileage = structured.mileage || null;

    const priceAndMileage = pageText.match(/\$([\d,]+)\s*[•·]\s*([\d,]+)\s*mi/i);
    if (priceAndMileage) {
      if (!price) price = extractNumber(priceAndMileage[1]);
      if (!mileage) mileage = extractNumber(priceAndMileage[2]);
    }

    if (!price) {
      const titleIdx = pageText.search(/(?:Used|New|Certified)\s+\d{4}\s+/i);
      if (titleIdx !== -1) {
        const nearTitle = pageText.substring(titleIdx, titleIdx + 200);
        const priceMatch = nearTitle.match(/\$([\d,]+)/);
        if (priceMatch) {
          const val = extractNumber(priceMatch[1]);
          if (val >= 1000 && val <= 500000) price = val;
        }
      }
    }

    if (!mileage) {
      const mileagePatterns = [
        /(?:mileage|odometer)[:\s]*([\d,]{3,})/i,
        /([\d,]{3,})\s*(?:miles|mi\b)/i,
      ];
      for (const pattern of mileagePatterns) {
        const match = pageText.match(pattern);
        if (match) {
          const val = extractNumber(match[1]);
          if (val && val >= 100 && val < 1000000) {
            mileage = val;
            break;
          }
        }
      }
    }

    // ── Accident status
    let accidentStatus = "Unknown";
    const accidentEl = document.querySelector(".accident-history, [data-testid='accident-history']");
    if (accidentEl && /accident/i.test(accidentEl.innerText)) {
      accidentStatus = accidentEl.innerText.trim().replace(/\s+/g, " ");
    } else if (pageText.match(/no\s+accident/i) || pageText.match(/0\s+accident/i)) {
      accidentStatus = "No accidents reported";
    } else if (pageText.match(/accident.*reported/i) || pageText.match(/\d+\s+accident/i)) {
      const accMatch = pageText.match(/(\d+)\s+accident/i);
      accidentStatus = accMatch ? `${accMatch[1]} accident(s) reported` : "Accident(s) reported";
    }

    // ── Number of owners
    let owners = null;
    const ownerText = textFromSelectors([".owner-history", "[data-testid='owner-history']"]);
    if (ownerText) {
      const ownerMatch = ownerText.match(/(\d+)\+?\s*owner/i);
      if (ownerMatch) owners = parseInt(ownerMatch[1]);
    }
    if (!owners) {
      const ownerPatterns = [
        /(\d+)\+?\s*[- ]?owner/i,
        /owners?[:\s]*(\d+)/i,
      ];
      for (const pattern of ownerPatterns) {
        const match = pageText.match(pattern);
        if (match) {
          owners = parseInt(match[1]);
          break;
        }
      }
    }

    // ── Commercial use
    let commercialUse = false;
    if (pageText.match(/commercial\s+use/i) || pageText.match(/fleet\s+(?:use|vehicle)/i)) {
      commercialUse = true;
    }

    // ── Service history
    const serviceHistory = [];
    const seen = new Set();

    const serviceStart = pageText.indexOf("Last serviced");
    const serviceEnd = pageText.indexOf("VIN:", serviceStart);

    if (serviceStart !== -1) {
      const serviceText = serviceEnd !== -1
        ? pageText.substring(serviceStart, serviceEnd)
        : pageText.substring(serviceStart, serviceStart + 1000);

      const items = serviceText.split(/[\n•]/).map((s) => s.trim()).filter(Boolean);

      for (const item of items) {
        if (item.length > 8 && item.length < 200 && !seen.has(item)) {
          seen.add(item);
          serviceHistory.push(item);
        }
        if (serviceHistory.length >= 15) break;
      }
    }

    // ── Location
    let location = null;
    const stateAbbrs = "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
    const locPattern = new RegExp(`([A-Z][a-z]+(?:\\s[A-Z][a-z]+)*),\\s*(${stateAbbrs})\\b`);
    const locMatch = pageText.match(locPattern);
    if (locMatch) {
      location = `${locMatch[1]}, ${locMatch[2]}`;
    }

    // ── Value delta
    let valueDelta = textFromSelectors([
      ".value-label",
      ".price-delta",
      "[data-testid='vdp-price-delta']",
    ]);
    if (!valueDelta) {
      const deltaPatterns = [
        /(\$[\d,]+\s+(?:below|above|under|over)\s+market)/i,
        /((?:below|above|under|over)\s+market\s+(?:value|price|average))/i,
        /(great\s+(?:deal|price|value))/i,
        /(good\s+(?:deal|price|value))/i,
        /(fair\s+(?:deal|price|value))/i,
        /(overpriced|high\s+price)/i,
      ];
      for (const pattern of deltaPatterns) {
        const match = pageText.match(pattern);
        if (match) {
          valueDelta = match[1];
          break;
        }
      }
    }

    // ── Damage report link
    const damageReportText = extractDamageReport();

    return {
      year,
      make,
      model,
      trim,
      price,
      mileage,
      accident_status: accidentStatus,
      owners,
      commercial_use: commercialUse,
      vin,
      service_history: serviceHistory,
      location,
      value_delta: valueDelta,
      source_url: window.location.href,
      damage_report: damageReportText,
    };
  }

  // ── Detailed Report Extraction ──────────────────────────────────────

  function extractDamageReport() {
    // This function extracts all available detailed report data from
    // the CARFAX report page — accident/damage history, title history,
    // ownership history, recall status, warranty info, and detailed
    // service records per owner.

    const pageText = document.body.innerText;
    const report = [];

    // ── Section extractor: grabs text between a section header and the next one
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
      return lines.slice(0, maxLines || 30).join("\n");
    }

    // ── Accident / Damage History
    const accidentSection = extractSection(
      /Accident\s*\/?\s*Damage\s*History/i,
      ["Title History", "Additional History", "Ownership History", "Detailed History"],
      25
    );
    if (accidentSection) report.push("=== ACCIDENT / DAMAGE HISTORY ===\n" + accidentSection);

    // ── Additional History (Total Loss, Structural Damage, Airbag, Odometer, Recalls)
    const additionalSection = extractSection(
      /Additional\s*History/i,
      ["Title History", "Ownership History", "Detailed History"],
      30
    );
    if (additionalSection) report.push("=== ADDITIONAL HISTORY ===\n" + additionalSection);

    // ── Title History (Damage Brands, Odometer Brands)
    const titleSection = extractSection(
      /Title\s*History/i,
      ["Ownership History", "Detailed History", "GUARANTEED"],
      20
    );
    if (titleSection) report.push("=== TITLE HISTORY ===\n" + titleSection);

    // ── Ownership History
    const ownershipSection = extractSection(
      /Ownership\s*History/i,
      ["Detailed History", "Service History", "Last serviced"],
      20
    );
    if (ownershipSection) report.push("=== OWNERSHIP HISTORY ===\n" + ownershipSection);

    // ── Detailed service records (per-owner service history on the report page)
    const detailedSection = extractSection(
      /Detailed\s*(?:History|Records)/i,
      ["View another", "Print this report"],
      60
    );
    if (detailedSection) report.push("=== DETAILED SERVICE RECORDS ===\n" + detailedSection);

    // ── Specific damage details (if there's an accident detail section)
    // Look for specific damage language anywhere on page
    const damageDetails = [];
    const lines = pageText.split("\n");
    for (const line of lines) {
      const t = line.trim();
      const lower = t.toLowerCase();
      if (
        (lower.includes("damage reported") && lower.includes("/")) ||
        lower.includes("rear impact") || lower.includes("front impact") ||
        lower.includes("side impact") || lower.includes("rollover") ||
        lower.includes("damage to front") || lower.includes("damage to rear") ||
        lower.includes("damage to left") || lower.includes("damage to right") ||
        lower.includes("moderate damage") || lower.includes("minor damage") ||
        lower.includes("severe damage") || lower.includes("functional damage") ||
        lower.includes("disabling damage") ||
        (lower.includes("accident") && lower.includes("reported") && /\d{2}\/\d{2}\/\d{2,4}/.test(t))
      ) {
        if (t.length > 5 && t.length < 300) damageDetails.push(t);
      }
    }
    if (damageDetails.length > 0) {
      report.push("=== SPECIFIC DAMAGE DETAILS ===\n" + damageDetails.join("\n"));
    }

    // ── Recall information
    const recallLines = [];
    for (const line of lines) {
      const t = line.trim();
      const lower = t.toLowerCase();
      if (
        (lower.includes("recall") && !lower.includes("no open recall") && !lower.includes("no recalls")) ||
        (lower.includes("nhtsa") && t.length > 10)
      ) {
        if (t.length > 8 && t.length < 300) recallLines.push(t);
      }
    }
    if (recallLines.length > 0) {
      report.push("=== RECALL INFORMATION ===\n" + recallLines.slice(0, 10).join("\n"));
    }

    // ── Key status flags (quick scan for important items)
    const statusFlags = [];
    const flagPatterns = [
      { pattern: /no\s+total\s+loss/i, label: "No total loss reported" },
      { pattern: /total\s+loss/i, label: "TOTAL LOSS REPORTED", negative: /no\s+total\s+loss/i },
      { pattern: /no\s+structural\s+damage/i, label: "No structural damage" },
      { pattern: /structural\s+damage/i, label: "STRUCTURAL DAMAGE", negative: /no\s+structural/i },
      { pattern: /no\s+airbag\s+deploy/i, label: "No airbag deployment" },
      { pattern: /airbag\s+deploy/i, label: "AIRBAG DEPLOYED", negative: /no\s+airbag/i },
      { pattern: /no\s+(?:indication\s+of\s+)?odometer\s+rollback/i, label: "No odometer rollback" },
      { pattern: /odometer\s+rollback/i, label: "ODOMETER ROLLBACK", negative: /no\s+(?:indication|issues)/i },
      { pattern: /salvage|junk|rebuilt|flood|fire|hail|lemon/i, label: null }, // captured with match text
      { pattern: /warranty\s+expired/i, label: "Warranty expired" },
      { pattern: /original\s+warranty/i, label: null },
    ];
    for (const { pattern, label, negative } of flagPatterns) {
      if (pattern.test(pageText)) {
        if (negative && negative.test(pageText)) continue;
        if (label) statusFlags.push(label);
        else {
          const m = pageText.match(pattern);
          if (m) statusFlags.push(m[0]);
        }
      }
    }
    if (statusFlags.length > 0) {
      report.push("=== STATUS FLAGS ===\n" + statusFlags.join("\n"));
    }

    return report.length > 0 ? report.join("\n\n") : null;
  }

  // ── Overlay UI ──────────────────────────────────────────────────────────

  function createOverlay() {
    const overlay = document.createElement("div");
    overlay.id = "carlens-overlay";
    overlay.innerHTML = `
      <div class="carlens-resize-handle carlens-resize-n" data-resize="n"></div>
      <div class="carlens-resize-handle carlens-resize-s" data-resize="s"></div>
      <div class="carlens-resize-handle carlens-resize-e" data-resize="e"></div>
      <div class="carlens-resize-handle carlens-resize-w" data-resize="w"></div>
      <div class="carlens-resize-handle carlens-resize-ne" data-resize="ne"></div>
      <div class="carlens-resize-handle carlens-resize-nw" data-resize="nw"></div>
      <div class="carlens-resize-handle carlens-resize-se" data-resize="se"></div>
      <div class="carlens-resize-handle carlens-resize-sw" data-resize="sw"></div>
      <div id="carlens-header">
        <span id="carlens-logo">
          <span class="carlens-drag-dots"><span></span><span></span><span></span></span>
          CarLens
        </span>
        <button id="carlens-close">&times;</button>
      </div>
      <div id="carlens-body">
        <div id="carlens-mode-toggle">
          <button class="carlens-mode-btn active" data-mode="brief">Quick</button>
          <button class="carlens-mode-btn" data-mode="detailed">Deep Dive</button>
        </div>
        <button id="carlens-analyze-btn">Analyze This Listing</button>
        <div id="carlens-loading" style="display:none;">
          <div class="carlens-loading-orb"></div>
          <span class="carlens-loading-text">Analyzing listing...</span>
        </div>
        <div id="carlens-results" style="display:none;"></div>
        <div id="carlens-error" style="display:none;"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Add full-page aura overlay
    const aura = document.createElement("div");
    aura.id = "carlens-aura";
    document.body.appendChild(aura);

    // Close button
    document.getElementById("carlens-close").addEventListener("click", () => {
      overlay.style.display = overlay.style.display === "none" ? "block" : "none";
    });

    document.getElementById("carlens-analyze-btn").addEventListener("click", analyzeListing);

    // Mode toggle
    const modeButtons = overlay.querySelectorAll(".carlens-mode-btn");
    modeButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        modeButtons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });

    // ── Make panel draggable by the header ──
    const header = document.getElementById("carlens-header");
    let isDragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    header.style.cursor = "grab";

    header.addEventListener("mousedown", (e) => {
      if (e.target.id === "carlens-close") return;
      isDragging = true;
      header.style.cursor = "grabbing";
      const rect = overlay.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      overlay.style.left = (e.clientX - dragOffsetX) + "px";
      overlay.style.top = (e.clientY - dragOffsetY) + "px";
      overlay.style.right = "auto";
    });

    document.addEventListener("mouseup", () => {
      if (isDragging) {
        isDragging = false;
        header.style.cursor = "grab";
      }
    });

    // ── Custom resize from any edge/corner ──
    setupResize(overlay);
  }

  function setupResize(overlay) {
    let isResizing = false;
    let resizeDir = "";
    let startX, startY, startW, startH, startLeft, startTop;

    const MIN_W = 300;
    const MIN_H = 150;

    overlay.addEventListener("mousedown", (e) => {
      const handle = e.target.closest("[data-resize]");
      if (!handle) return;

      isResizing = true;
      resizeDir = handle.dataset.resize;
      const rect = overlay.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startW = rect.width;
      startH = rect.height;
      startLeft = rect.left;
      startTop = rect.top;
      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener("mousemove", (e) => {
      if (!isResizing) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      let newW = startW;
      let newH = startH;
      let newLeft = startLeft;
      let newTop = startTop;

      if (resizeDir.includes("e")) newW = Math.max(MIN_W, startW + dx);
      if (resizeDir.includes("w")) {
        newW = Math.max(MIN_W, startW - dx);
        newLeft = startLeft + (startW - newW);
      }
      if (resizeDir.includes("s")) newH = Math.max(MIN_H, startH + dy);
      if (resizeDir.includes("n")) {
        newH = Math.max(MIN_H, startH - dy);
        newTop = startTop + (startH - newH);
      }

      overlay.style.width = newW + "px";
      overlay.style.height = newH + "px";
      overlay.style.left = newLeft + "px";
      overlay.style.top = newTop + "px";
      overlay.style.right = "auto";
      overlay.style.maxHeight = "none";
    });

    document.addEventListener("mouseup", () => {
      isResizing = false;
    });
  }

  // ── Reset overlay to initial state ──

  function resetOverlay() {
    const btn = document.getElementById("carlens-analyze-btn");
    const loading = document.getElementById("carlens-loading");
    const results = document.getElementById("carlens-results");
    const errorDiv = document.getElementById("carlens-error");
    const aura = document.getElementById("carlens-aura");
    const overlay = document.getElementById("carlens-overlay");

    if (!btn) return;

    btn.style.display = "block";
    btn.textContent = "Analyze This Listing";
    loading.style.display = "none";
    results.style.display = "none";
    results.innerHTML = "";
    errorDiv.style.display = "none";
    errorDiv.textContent = "";
    aura.classList.remove("active");
    overlay.classList.remove("carlens-analyzing");
    overlay.style.display = "block";
  }

  // ── URL Change Detection (SPA navigation) ──

  function watchForNavigation() {
    // Poll for URL changes — works for both pushState and hash changes
    setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        console.log("[CarLens] Page navigated, resetting overlay.");
        resetOverlay();
      }
    }, 1000);

    // Also listen for popstate (back/forward)
    window.addEventListener("popstate", () => {
      setTimeout(() => {
        if (window.location.href !== lastUrl) {
          lastUrl = window.location.href;
          console.log("[CarLens] Popstate navigation, resetting overlay.");
          resetOverlay();
        }
      }, 100);
    });
  }

  // ── Verdict badge class helper ──

  function getVerdictClass(verdict) {
    const v = verdict.toLowerCase();
    if (v.includes("good")) return "carlens-verdict-good";
    if (v.includes("fair")) return "carlens-verdict-fair";
    if (v.includes("overpriced")) return "carlens-verdict-overpriced";
    if (v.includes("caution")) return "carlens-verdict-caution";
    return "carlens-verdict-insufficient";
  }

  // ── Render Results ──────────────────────────────────────────────────

  function renderResults(data) {
    const resultsDiv = document.getElementById("carlens-results");

    const confidenceColor =
      data.confidence >= 70 ? "#34a853" : data.confidence >= 40 ? "#fbbc04" : "#ea4335";

    const circumference = 125.66;
    const dashOffset = circumference * (1 - data.confidence / 100);

    const verdictClass = getVerdictClass(data.verdict);
    const isDetailed = data.mode === "detailed";

    function makeCard(id, icon, title, bodyHTML, collapsed) {
      return `
        <div class="carlens-card carlens-card-${id}${collapsed ? " collapsed" : ""}">
          <button class="carlens-card-header" onclick="this.parentElement.classList.toggle('collapsed')">
            <span class="carlens-card-icon">${icon}</span>
            ${title}
            <span class="carlens-card-chevron">&#9660;</span>
          </button>
          <div class="carlens-card-body">${bodyHTML}</div>
        </div>
      `;
    }

    let cardsHTML = "";

    // Strengths
    if (data.positives && data.positives.length > 0) {
      cardsHTML += makeCard(
        "strengths",
        "\u{1F6E1}",
        "Strengths",
        `<ul class="carlens-list carlens-positive-list">
          ${data.positives.map((p) => `<li>${p}</li>`).join("")}
        </ul>`,
        false
      );
    }

    // Risks
    if (data.risks && data.risks.length > 0) {
      cardsHTML += makeCard(
        "risks",
        "\u26A0\uFE0F",
        "Risks",
        `<ul class="carlens-list carlens-risk-list">
          ${data.risks.map((r) => `<li>${r}</li>`).join("")}
        </ul>`,
        false
      );
    }

    // Detailed-only sections
    if (isDetailed) {
      if (data.damage_analysis && data.damage_analysis !== "No damage reported") {
        cardsHTML += makeCard(
          "damage",
          "\u{1F4A5}",
          "Damage Analysis",
          `<p class="carlens-summary">${data.damage_analysis}</p>`,
          false
        );
      }

      if (data.ownership_costs) {
        cardsHTML += makeCard(
          "costs",
          "\u{1F4B0}",
          "Ownership Costs",
          `<p class="carlens-summary">${data.ownership_costs}</p>`,
          false
        );
      }

      if (data.market_comparison) {
        cardsHTML += makeCard(
          "market",
          "\u{1F4CA}",
          "Market Comparison",
          `<p class="carlens-summary">${data.market_comparison}</p>`,
          false
        );
      }
    }

    // Model Intel
    if (data.car_specific_notes && data.car_specific_notes.length > 0) {
      cardsHTML += makeCard(
        "intel",
        "\u{1F50D}",
        "Model Intel",
        `<ul class="carlens-list carlens-intel-list">
          ${data.car_specific_notes.map((n) => `<li>${n}</li>`).join("")}
        </ul>`,
        false
      );
    }

    // Bottom Line
    if (data.summary) {
      cardsHTML += makeCard(
        "summary",
        "\u{1F4CB}",
        "Bottom Line",
        `<p class="carlens-summary">${data.summary}</p>`,
        false
      );
    }

    resultsDiv.innerHTML = `
      <div id="carlens-verdict">
        <div class="carlens-verdict-label">Verdict</div>
        <div class="carlens-verdict-badge ${verdictClass}">${data.verdict}</div>
        <div class="carlens-confidence-ring">
          <div class="carlens-ring-container">
            <svg class="carlens-ring-svg" viewBox="0 0 48 48">
              <circle class="carlens-ring-bg" cx="24" cy="24" r="20"></circle>
              <circle class="carlens-ring-fill" cx="24" cy="24" r="20"
                stroke="${confidenceColor}"
                stroke-dasharray="${circumference}"
                stroke-dashoffset="${dashOffset}"></circle>
            </svg>
            <span class="carlens-ring-text">${data.confidence}%</span>
          </div>
          <div class="carlens-confidence-info">
            <div class="carlens-confidence-pct">Confidence</div>
            <div class="carlens-confidence-disclaimer">
              How confident the AI is in its assessment based on the data available — not a guarantee or buy/sell recommendation.
            </div>
          </div>
        </div>
      </div>
      ${cardsHTML}
      <button id="carlens-reanalyze-btn">Re-analyze</button>
    `;

    // Wire up re-analyze button
    document.getElementById("carlens-reanalyze-btn").addEventListener("click", () => {
      resetOverlay();
    });

    resultsDiv.style.display = "block";
  }

  // ── Expand Dropdowns ─────────────────────────────────────────────────

  function expandDropdowns() {
    const clickTargets = document.querySelectorAll(
      '[aria-expanded="false"], [class*="collapse"]:not([class*="show"]), ' +
      'button[class*="accordion"], [class*="expand"], [role="button"][aria-expanded="false"]'
    );
    clickTargets.forEach((el) => el.click());

    const allClickable = document.querySelectorAll("button, [role='button'], summary, [tabindex='0']");
    for (const el of allClickable) {
      const text = el.textContent.trim().toLowerCase();
      if (
        (text.includes("service history") || text.includes("vehicle history") ||
         text.includes("show more") || text.includes("see more") ||
         text.includes("detailed history") || text.includes("detailed records") ||
         text.includes("additional history") || text.includes("view all")) &&
        el.getAttribute("aria-expanded") !== "true"
      ) {
        el.click();
      }
    }
  }

  // ── Find CARFAX Report Link ──────────────────────────────────────────

  function findReportLink() {
    // Look for "View FREE CARFAX Report" or similar links on the listing page
    const allLinks = document.querySelectorAll("a");
    for (const link of allLinks) {
      const text = link.textContent.trim().toLowerCase();
      if (
        (text.includes("carfax report") || text.includes("view report") ||
         text.includes("free carfax") || text.includes("vehicle history report")) &&
        link.href && link.href.includes("carfax.com")
      ) {
        return link.href;
      }
    }

    // Also check buttons that might be links
    const allButtons = document.querySelectorAll("button, [role='button']");
    for (const btn of allButtons) {
      const text = btn.textContent.trim().toLowerCase();
      if (text.includes("carfax report") || text.includes("free carfax")) {
        // Check if it wraps a link or has an onclick that navigates
        const innerLink = btn.querySelector("a");
        if (innerLink && innerLink.href) return innerLink.href;
        // Check parent link
        const parentLink = btn.closest("a");
        if (parentLink && parentLink.href) return parentLink.href;
      }
    }

    // Check for "See Damage Report" links
    for (const link of allLinks) {
      const text = link.textContent.trim().toLowerCase();
      if (text.includes("damage report") || text.includes("see report")) {
        if (link.href && link.href.includes("carfax.com")) return link.href;
      }
    }

    return null;
  }

  // ── Fetch and Parse CARFAX Report Page ─────────────────────────────────

  async function fetchReportData(reportUrl) {
    console.log("[CarLens] Fetching CARFAX report:", reportUrl);

    try {
      const resp = await fetch(reportUrl, { credentials: "include" });
      if (!resp.ok) {
        console.warn("[CarLens] Could not fetch report page:", resp.status);
        return null;
      }

      const html = await resp.text();

      // Parse the HTML into a DOM we can query
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const reportText = doc.body.innerText;

      const report = [];

      // ── Section extractor for the report page
      function extractSection(startPattern, stopPatterns, maxLines) {
        const startIdx = reportText.search(startPattern);
        if (startIdx === -1) return null;

        let endIdx = reportText.length;
        for (const stop of stopPatterns) {
          const idx = reportText.indexOf(stop, startIdx + 50);
          if (idx !== -1 && idx < endIdx) endIdx = idx;
        }

        const sectionText = reportText.substring(startIdx, endIdx);
        const lines = sectionText.split("\n").map((l) => l.trim()).filter((l) => l.length > 2);
        return lines.slice(0, maxLines || 30).join("\n");
      }

      // Accident / Damage History
      const accidentSection = extractSection(
        /Accident\s*\/?\s*Damage\s*History/i,
        ["Title History", "Additional History", "Ownership History", "Detailed History"],
        25
      );
      if (accidentSection) report.push("=== ACCIDENT / DAMAGE HISTORY ===\n" + accidentSection);

      // Additional History
      const additionalSection = extractSection(
        /Additional\s*History/i,
        ["Title History", "Ownership History", "Detailed History"],
        30
      );
      if (additionalSection) report.push("=== ADDITIONAL HISTORY ===\n" + additionalSection);

      // Title History
      const titleSection = extractSection(
        /Title\s*History/i,
        ["Ownership History", "Detailed History", "GUARANTEED"],
        20
      );
      if (titleSection) report.push("=== TITLE HISTORY ===\n" + titleSection);

      // Ownership History
      const ownershipSection = extractSection(
        /Ownership\s*History/i,
        ["Detailed History", "Service History", "Last serviced"],
        20
      );
      if (ownershipSection) report.push("=== OWNERSHIP HISTORY ===\n" + ownershipSection);

      // Detailed service records
      const detailedSection = extractSection(
        /Detailed\s*(?:History|Records)/i,
        ["View another", "Print this report", "Glossary"],
        80
      );
      if (detailedSection) report.push("=== DETAILED SERVICE RECORDS ===\n" + detailedSection);

      // Specific damage details
      const damageDetails = [];
      const lines = reportText.split("\n");
      for (const line of lines) {
        const t = line.trim();
        const lower = t.toLowerCase();
        if (
          (lower.includes("damage reported") && /\d/.test(t)) ||
          lower.includes("rear impact") || lower.includes("front impact") ||
          lower.includes("side impact") || lower.includes("rollover") ||
          lower.includes("damage to front") || lower.includes("damage to rear") ||
          lower.includes("damage to left") || lower.includes("damage to right") ||
          lower.includes("moderate damage") || lower.includes("minor damage") ||
          lower.includes("severe damage") || lower.includes("functional damage") ||
          lower.includes("disabling damage") ||
          (lower.includes("accident") && lower.includes("reported") && /\d{2}\/\d{2}\/\d{2,4}/.test(t))
        ) {
          if (t.length > 5 && t.length < 300) damageDetails.push(t);
        }
      }
      if (damageDetails.length > 0) {
        report.push("=== SPECIFIC DAMAGE DETAILS ===\n" + damageDetails.join("\n"));
      }

      // Recall info
      const recallLines = [];
      for (const line of lines) {
        const t = line.trim();
        const lower = t.toLowerCase();
        if (
          (lower.includes("recall") && !lower.includes("no open recall") && !lower.includes("no recalls")) ||
          (lower.includes("nhtsa") && t.length > 10)
        ) {
          if (t.length > 8 && t.length < 300) recallLines.push(t);
        }
      }
      if (recallLines.length > 0) {
        report.push("=== RECALL INFORMATION ===\n" + recallLines.slice(0, 10).join("\n"));
      }

      // Status flags
      const statusFlags = [];
      const flagChecks = [
        [/no\s+total\s+loss/i, "No total loss reported", null],
        [/total\s+loss/i, "TOTAL LOSS REPORTED", /no\s+total\s+loss/i],
        [/no\s+structural\s+damage/i, "No structural damage", null],
        [/structural\s+damage.*issues/i, "STRUCTURAL DAMAGE", /no\s+structural|no issues/i],
        [/no\s+airbag\s+deploy/i, "No airbag deployment", null],
        [/airbag\s+deploy/i, "AIRBAG DEPLOYED", /no\s+airbag/i],
        [/no\s+(?:indication\s+of\s+)?odometer\s+rollback/i, "No odometer rollback", null],
        [/warranty\s+expired/i, "Warranty expired", null],
        [/guaranteed\s+no\s+problem/i, "Title: Guaranteed No Problem", null],
      ];
      for (const [pattern, label, negative] of flagChecks) {
        if (pattern.test(reportText)) {
          if (negative && negative.test(reportText)) continue;
          statusFlags.push(label);
        }
      }
      if (statusFlags.length > 0) {
        report.push("=== STATUS FLAGS ===\n" + [...new Set(statusFlags)].join("\n"));
      }

      const result = report.length > 0 ? report.join("\n\n") : null;
      console.log("[CarLens] Extracted report data:", result ? result.substring(0, 500) + "..." : "none");
      return result;

    } catch (err) {
      console.warn("[CarLens] Error fetching report:", err.message);
      return null;
    }
  }

  // ── Analysis Logic ──────────────────────────────────────────────────────

  async function analyzeListing() {
    const btn = document.getElementById("carlens-analyze-btn");
    const loading = document.getElementById("carlens-loading");
    const results = document.getElementById("carlens-results");
    const errorDiv = document.getElementById("carlens-error");
    const aura = document.getElementById("carlens-aura");
    const overlay = document.getElementById("carlens-overlay");
    const loadingText = overlay.querySelector(".carlens-loading-text");

    // Get selected mode
    const activeMode = overlay.querySelector(".carlens-mode-btn.active");
    const mode = activeMode ? activeMode.dataset.mode : "brief";

    btn.style.display = "none";
    loading.style.display = "flex";
    results.style.display = "none";
    errorDiv.style.display = "none";
    aura.classList.add("active");
    overlay.classList.add("carlens-analyzing");

    // Update loading text based on mode
    if (loadingText) {
      loadingText.textContent = mode === "detailed"
        ? "Scanning full CARFAX report..."
        : "Analyzing listing...";
    }

    try {
      expandDropdowns();
      await new Promise((r) => setTimeout(r, 500));

      const carData = extractCarData();
      carData.mode = mode;

      // For Deep Dive: fetch the full CARFAX report page if we can find the link
      if (mode === "detailed") {
        if (loadingText) loadingText.textContent = "Finding CARFAX report...";

        const reportLink = findReportLink();
        if (reportLink) {
          if (loadingText) loadingText.textContent = "Reading full CARFAX report...";
          const reportData = await fetchReportData(reportLink);
          if (reportData) {
            carData.damage_report = reportData;
            console.log("[CarLens] Enriched with full CARFAX report data");
          } else {
            console.log("[CarLens] Could not fetch report, using page data only");
          }
        } else {
          console.log("[CarLens] No report link found, using page data only");
        }

        if (loadingText) loadingText.textContent = "Running deep analysis...";
      }

      console.log("[CarLens] Extracted data:", carData);
      console.log("[CarLens] Analysis mode:", mode);

      const response = await fetch(BACKEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(carData),
      });

      if (!response.ok) {
        throw new Error(`Backend returned HTTP ${response.status}`);
      }

      const result = await response.json();
      console.log("[CarLens] Backend response:", result);
      renderResults(result);
    } catch (err) {
      console.error("[CarLens] Error:", err);
      errorDiv.textContent = `Error: ${err.message}. Make sure the CarLens backend is running.`;
      errorDiv.style.display = "block";
      btn.style.display = "block";
    } finally {
      loading.style.display = "none";
      aura.classList.remove("active");
      overlay.classList.remove("carlens-analyzing");
    }
  }

  // ── Init ────────────────────────────────────────────────────────────────

  createOverlay();
  watchForNavigation();
})();
