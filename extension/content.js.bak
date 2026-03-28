// content.js
// Injected on CARFAX listing pages. Extracts car data from the DOM,
// sends it to the CarLens backend, and displays the verdict overlay.

(function () {
  "use strict";

  if (document.getElementById("carlens-overlay")) return;

  const BACKEND_URL = "http://localhost:5000/analyze";

  // Track the current URL so we can detect SPA navigation
  let lastUrl = window.location.href;

  // ── Helpers ──────────────────────────────────────────────────────────

  function extractNumber(text) {
    if (!text) return null;
    const cleaned = text.replace(/[^0-9.]/g, "");
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }

  // Get text from first matching selector — prioritizes data-testid
  function getVal(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim()) return el.innerText.trim();
    }
    return null;
  }

  // Wait for a selector to appear in the DOM (React hydration)
  function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve) => {
      const el = document.querySelector(selector);
      if (el && el.innerText.trim()) { resolve(el); return; }

      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found && found.innerText.trim()) {
          observer.disconnect();
          resolve(found);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
    });
  }

  // ── JSON-LD / Schema.org Extraction (React hydration data) ────────

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

  // ── Main Data Extraction (data-testid first, fallback to text) ────

  async function extractCarData() {
    const structured = extractStructuredData();

    // Wait for React to hydrate key elements before scraping
    await waitForElement(
      "[data-testid='vdp-price-value'], [data-testid='vdp-mileage-value'], h1, .listing-price",
      3000
    );

    const pageText = document.body.innerText;

    // ── VIN: URL > data-testid > JSON-LD > page text
    let vin = null;
    const urlVinMatch = window.location.pathname.match(/\/vehicle\/([A-HJ-NPR-Z0-9]{17})/i);
    if (urlVinMatch) {
      vin = urlVinMatch[1].toUpperCase();
    }
    if (!vin) {
      const vinVal = getVal(["[data-testid='vdp-vin-value']", "[data-testid='vin-value']", ".vin-number"]);
      if (vinVal) {
        const m = vinVal.match(/([A-HJ-NPR-Z0-9]{17})/i);
        if (m) vin = m[1].toUpperCase();
      }
    }
    if (!vin) vin = structured.vin || null;
    if (!vin) {
      const m = pageText.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
      if (m) vin = m[1].toUpperCase();
    }

    // ── Price: data-testid > JSON-LD > combined pattern > near-title fallback
    let price = extractNumber(
      getVal(["[data-testid='vdp-price-value']", "[data-testid='listing-price']", ".listing-price", ".primary-price"])
    );
    if (!price) price = structured.price || null;
    if (!price) {
      const combined = pageText.match(/\$([\d,]+)\s*[•·]\s*([\d,]+)\s*mi/i);
      if (combined) price = extractNumber(combined[1]);
    }
    if (!price) {
      const titleIdx = pageText.search(/(?:Used|New|Certified)\s+\d{4}\s+/i);
      if (titleIdx !== -1) {
        const nearTitle = pageText.substring(titleIdx, titleIdx + 200);
        const m = nearTitle.match(/\$([\d,]+)/);
        if (m) {
          const val = extractNumber(m[1]);
          if (val >= 1000 && val <= 500000) price = val;
        }
      }
    }

    // ── Mileage: data-testid > JSON-LD > combined pattern > text fallback
    // Strictly targeted to avoid grabbing owner count
    let mileage = extractNumber(
      getVal(["[data-testid='vdp-mileage-value']", "[data-testid='mileage-value']", ".vehicle-mileage"])
    );
    if (!mileage) mileage = structured.mileage || null;
    if (!mileage) {
      const combined = pageText.match(/\$([\d,]+)\s*[•·]\s*([\d,]+)\s*mi/i);
      if (combined) mileage = extractNumber(combined[2]);
    }
    if (!mileage) {
      // Only match mileage patterns that are clearly mileage (3+ digits, >= 100)
      const patterns = [
        /(?:mileage|odometer)[:\s]*([\d,]{3,})/i,
        /([\d,]{3,})\s*(?:miles|mi\b)/i,
      ];
      for (const p of patterns) {
        const m = pageText.match(p);
        if (m) {
          const val = extractNumber(m[1]);
          if (val && val >= 100 && val < 1000000) { mileage = val; break; }
        }
      }
    }

    // ── Title / Year / Make / Model / Trim
    let titleText = structured.title || "";
    if (!titleText) {
      titleText = getVal([
        "h1",
        "[data-testid='vehicle-title']",
        "[data-testid*='ehicle']",
        "[itemprop='name']",
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
        const parts = rest.split(/\s+/);
        model = parts[0];
        if (parts.length > 1) trim = parts.slice(1).join(" ");
      } else if (!trim) {
        const trimText = rest.replace(model, "").trim();
        if (trimText) trim = trimText;
      }
    }

    if (!year || !make || !model) {
      const m = pageText.match(/((?:Used|New|Certified)\s+)?(\d{4})\s+([A-Za-z][A-Za-z-]+)\s+([A-Za-z0-9][^\n$]{1,40})/);
      if (m) {
        if (!year) year = parseInt(m[2]);
        if (!make) make = m[3];
        if (!model) {
          const parts = m[4].trim().split(/\s+/);
          model = parts[0];
          if (!trim && parts.length > 1) trim = parts.slice(1).join(" ");
        }
      }
    }

    // ── Accident status: data-testid > DOM selectors > text
    let accidentStatus = "Unknown";
    const accidentVal = getVal([
      "[data-testid='accident-history']",
      "[data-testid='accident-damage-section']",
      ".accident-history",
    ]);
    if (accidentVal) {
      accidentStatus = accidentVal.replace(/\s+/g, " ").trim();
    } else if (/no\s+accident/i.test(pageText) || /0\s+accident/i.test(pageText)) {
      accidentStatus = "No accidents reported";
    } else if (/accident.*reported/i.test(pageText) || /\d+\s+accident/i.test(pageText)) {
      const m = pageText.match(/(\d+)\s+accident/i);
      accidentStatus = m ? `${m[1]} accident(s) reported` : "Accident(s) reported";
    }

    // Add damage location if available
    const damageLocation = getVal([
      "[data-testid='damage-location-value']",
      ".damage-details",
      ".damage-location",
    ]);
    if (damageLocation) {
      accidentStatus += ` (Location: ${damageLocation})`;
    }

    // ── Owners: data-testid > text (careful not to mix with mileage)
    let owners = null;
    const ownerVal = getVal([
      "[data-testid='owner-history']",
      "[data-testid='owner-count']",
      ".owner-history",
    ]);
    if (ownerVal) {
      const m = ownerVal.match(/(\d+)\+?\s*(?:owner|previous)/i);
      if (m) owners = parseInt(m[1]);
    }
    if (!owners) {
      const m = pageText.match(/(\d+)\+?\s*(?:-\s*)?(?:owner|previous\s+owner)/i);
      if (m) owners = parseInt(m[1]);
    }

    // ── Commercial use
    let commercialUse = false;
    if (/commercial\s+use/i.test(pageText) || /fleet\s+(?:use|vehicle)/i.test(pageText)) {
      commercialUse = true;
    }
    // Also check data-testid based ownership type
    const ownerType = getVal(["[data-testid='owner-type']", ".owner-type"]);
    if (ownerType && /commercial|fleet|rental|lease/i.test(ownerType)) {
      commercialUse = true;
    }

    // ── Service history: data-testid DOM elements > text fallback
    const serviceHistory = [];
    const seen = new Set();

    // Try structured DOM elements first (React-rendered service rows)
    const serviceRows = document.querySelectorAll(
      "[data-testid='detailed-history-event'], [data-testid='service-record'], .history-record, .history-table-row"
    );
    for (const row of serviceRows) {
      const text = row.innerText.replace(/\s+/g, " ").trim();
      if (
        text.length > 8 && text.length < 300 && !seen.has(text) &&
        (/serviced|inspection|maintenance|oil|tire|brake|filter|fluid|alignment|rotation/i.test(text))
      ) {
        seen.add(text);
        serviceHistory.push(text);
        if (serviceHistory.length >= 15) break;
      }
    }

    // Fallback: text-based extraction between "Last serviced" and "VIN:"
    if (serviceHistory.length === 0) {
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
    }

    // ── Location: data-testid > "City, ST" regex
    let location = getVal([
      "[data-testid='dealer-address']",
      "[data-testid='dealer-location']",
      ".dealer-address",
    ]);
    if (!location) {
      const stateAbbrs = "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
      const locPattern = new RegExp(`([A-Z][a-z]+(?:\\s[A-Z][a-z]+)*),\\s*(${stateAbbrs})\\b`);
      const m = pageText.match(locPattern);
      if (m) location = `${m[1]}, ${m[2]}`;
    }

    // ── Value delta: data-testid > text patterns
    let valueDelta = getVal([
      "[data-testid='vdp-price-delta']",
      "[data-testid='value-badge']",
      ".value-label",
      ".price-delta",
    ]);
    if (!valueDelta) {
      const deltaPatterns = [
        /(\$[\d,]+\s+(?:below|above|under|over)\s+(?:.*?CARFAX\s+)?(?:Value|market))/i,
        /((?:great|good|fair)\s+(?:deal|price|value))/i,
        /(overpriced|high\s+price)/i,
      ];
      for (const p of deltaPatterns) {
        const m = pageText.match(p);
        if (m) { valueDelta = m[1]; break; }
      }
    }

    // ── Damage report from current page (baseline)
    const damageReportText = extractDamageReportFromPage(pageText);

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

  // ── Damage/Report Extraction from Page Text ────────────────────────

  function extractDamageReportFromPage(pageText) {
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
      return lines.slice(0, maxLines || 30).join("\n");
    }

    const accidentSection = extractSection(
      /Accident\s*\/?\s*Damage\s*History/i,
      ["Title History", "Additional History", "Ownership History", "Detailed History"],
      25
    );
    if (accidentSection) report.push("=== ACCIDENT / DAMAGE HISTORY ===\n" + accidentSection);

    const additionalSection = extractSection(
      /Additional\s*History/i,
      ["Title History", "Ownership History", "Detailed History"],
      30
    );
    if (additionalSection) report.push("=== ADDITIONAL HISTORY ===\n" + additionalSection);

    const titleSection = extractSection(
      /Title\s*History/i,
      ["Ownership History", "Detailed History", "GUARANTEED"],
      20
    );
    if (titleSection) report.push("=== TITLE HISTORY ===\n" + titleSection);

    const ownershipSection = extractSection(
      /Ownership\s*History/i,
      ["Detailed History", "Service History", "Last serviced"],
      20
    );
    if (ownershipSection) report.push("=== OWNERSHIP HISTORY ===\n" + ownershipSection);

    const detailedSection = extractSection(
      /Detailed\s*(?:History|Records)/i,
      ["View another", "Print this report", "Glossary"],
      80
    );
    if (detailedSection) report.push("=== DETAILED SERVICE RECORDS ===\n" + detailedSection);

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

    // Status flags
    const statusFlags = [];
    const checks = [
      [/no\s+total\s+loss/i, "No total loss reported", null],
      [/total\s+loss.*reported/i, "TOTAL LOSS REPORTED", /no\s+total\s+loss/i],
      [/no\s+(?:issues\s+)?(?:structural\s+damage|issues\s+reported)/i, "No structural damage", null],
      [/structural\s+damage/i, "STRUCTURAL DAMAGE", /no\s+(?:issues|structural)/i],
      [/no\s+airbag\s+deploy/i, "No airbag deployment", null],
      [/airbag\s+deploy/i, "AIRBAG DEPLOYED", /no\s+airbag/i],
      [/no\s+(?:indication|issues).*odometer/i, "No odometer issues", null],
      [/odometer\s+rollback/i, "ODOMETER ROLLBACK", /no\s+(?:indication|issues)/i],
      [/warranty\s+expired/i, "Warranty expired", null],
      [/guaranteed\s+no\s+problem/i, "Title: Guaranteed No Problem", null],
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
          <svg class="carlens-logo-icon" width="18" height="18" viewBox="0 0 24 24" fill="none">
            <rect x="2" y="6" width="20" height="14" rx="3" stroke="#fff" stroke-width="1.8"/>
            <circle cx="12" cy="13" r="4" stroke="#fff" stroke-width="1.8"/>
            <circle cx="12" cy="13" r="1.5" fill="#fff"/>
            <path d="M7 6V5a2 2 0 012-2h6a2 2 0 012 2v1" stroke="#fff" stroke-width="1.8"/>
            <circle cx="18" cy="9" r="1" fill="#4285f4"/>
          </svg>
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
          <div class="carlens-progress-steps">
            <div class="carlens-step" data-step="extract">
              <div class="carlens-step-icon"><div class="carlens-step-spinner"></div></div>
              <span>Reading listing data</span>
            </div>
            <div class="carlens-step" data-step="report">
              <div class="carlens-step-icon"><div class="carlens-step-spinner"></div></div>
              <span>Opening CARFAX report</span>
            </div>
            <div class="carlens-step" data-step="ai">
              <div class="carlens-step-icon"><div class="carlens-step-spinner"></div></div>
              <span>AI analyzing vehicle</span>
            </div>
          </div>
          <div class="carlens-car-animation">
            <div class="carlens-road"></div>
            <img class="carlens-car-sprite" src="${chrome.runtime.getURL("assets/cars/sedan_blue.png")}" alt="" />
            <img class="carlens-prop carlens-prop-1" src="${chrome.runtime.getURL("assets/props/light.png")}" alt="" />
            <img class="carlens-prop carlens-prop-2" src="${chrome.runtime.getURL("assets/props/sign_blue.png")}" alt="" />
          </div>
          <div class="carlens-fun-fact">
            <span class="carlens-fact-label">Did you know?</span>
            <span class="carlens-fact-text"></span>
          </div>
        </div>
        <div id="carlens-results" style="display:none;"></div>
        <div id="carlens-error" style="display:none;"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Full-page aura + animated border
    const aura = document.createElement("div");
    aura.id = "carlens-aura";
    document.body.appendChild(aura);

    const auraBorder = document.createElement("div");
    auraBorder.id = "carlens-aura-border";
    document.body.appendChild(auraBorder);

    // Close button
    document.getElementById("carlens-close").addEventListener("click", () => {
      overlay.style.display = overlay.style.display === "none" ? "flex" : "none";
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

    // ── Draggable header ──
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
      let newW = startW, newH = startH, newLeft = startLeft, newTop = startTop;

      if (resizeDir.includes("e")) newW = Math.max(MIN_W, startW + dx);
      if (resizeDir.includes("w")) { newW = Math.max(MIN_W, startW - dx); newLeft = startLeft + (startW - newW); }
      if (resizeDir.includes("s")) newH = Math.max(MIN_H, startH + dy);
      if (resizeDir.includes("n")) { newH = Math.max(MIN_H, startH - dy); newTop = startTop + (startH - newH); }

      overlay.style.width = newW + "px";
      overlay.style.height = newH + "px";
      overlay.style.left = newLeft + "px";
      overlay.style.top = newTop + "px";
      overlay.style.right = "auto";
      overlay.style.maxHeight = "none";
    });

    document.addEventListener("mouseup", () => { isResizing = false; });
  }

  // ── Reset / Navigation ──────────────────────────────────────────────

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
    const ab = document.getElementById("carlens-aura-border");
    if (ab) ab.classList.remove("active");
    overlay.classList.remove("carlens-analyzing");
    overlay.style.display = "flex";
    // Reset any manual resize so panel auto-sizes to content
    overlay.style.height = "";
    overlay.style.maxHeight = "";
  }

  function watchForNavigation() {
    // Intercept pushState/replaceState for SPA navigation detection
    const origPushState = history.pushState;
    const origReplaceState = history.replaceState;

    history.pushState = function () {
      origPushState.apply(this, arguments);
      onUrlChange();
    };
    history.replaceState = function () {
      origReplaceState.apply(this, arguments);
      onUrlChange();
    };

    window.addEventListener("popstate", () => setTimeout(onUrlChange, 100));

    // Fallback polling for any missed navigations
    setInterval(() => {
      if (window.location.href !== lastUrl) onUrlChange();
    }, 2000);

    function onUrlChange() {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        console.log("[CarLens] Page navigated, resetting overlay.");
        resetOverlay();
      }
    }
  }

  // ── Verdict badge helper ──

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

    const cardSprites = {
      strengths: "suv.png",
      risks: "sports_red.png",
      intel: "sedan_blue.png",
      damage: "truck.png",
      market: "taxi.png",
      costs: "van.png",
      summary: "convertible.png",
    };

    function makeCard(id, title, bodyHTML, collapsed, count) {
      const countBadge = count !== undefined ? `<span style="margin-left:auto;font-size:11px;color:#999;font-weight:400;">${count}</span>` : "";
      const sprite = cardSprites[id] || "sedan.png";
      const spriteUrl = chrome.runtime.getURL("assets/cars/" + sprite);
      return `
        <div class="carlens-card carlens-card-${id}${collapsed ? " collapsed" : ""}">
          <button class="carlens-card-header" onclick="this.parentElement.classList.toggle('collapsed')">
            <img class="carlens-card-sprite" src="${spriteUrl}" alt="" />
            ${title}
            ${countBadge}
            <span class="carlens-card-chevron">&#9660;</span>
          </button>
          <div class="carlens-card-body">${bodyHTML}</div>
        </div>
      `;
    }

    let cardsHTML = "";

    // Summary FIRST — lead with the takeaway, not buried at the bottom
    if (data.summary) {
      cardsHTML += `<div class="carlens-tldr"><p>${data.summary}</p></div>`;
    }

    // Strengths & Risks — open by default
    if (data.positives && data.positives.length > 0) {
      cardsHTML += makeCard("strengths", "Strengths",
        `<ul class="carlens-list carlens-positive-list">${data.positives.map((p) => `<li>${p}</li>`).join("")}</ul>`, false, data.positives.length);
    }

    if (data.risks && data.risks.length > 0) {
      cardsHTML += makeCard("risks", "Risks",
        `<ul class="carlens-list carlens-risk-list">${data.risks.map((r) => `<li>${r}</li>`).join("")}</ul>`, false, data.risks.length);
    }

    // Detailed sections — collapsed by default
    if (isDetailed) {
      if (data.damage_analysis) {
        cardsHTML += makeCard("damage", "Damage Analysis",
          `<p class="carlens-summary">${data.damage_analysis}</p>`, true);
      }
      if (data.market_comparison) {
        cardsHTML += makeCard("market", "Market Comparison",
          `<p class="carlens-summary">${data.market_comparison}</p>`, true);
      }
      if (data.ownership_costs) {
        cardsHTML += makeCard("costs", "Ownership Costs",
          `<p class="carlens-summary">${data.ownership_costs}</p>`, true);
      }
    }

    if (data.car_specific_notes && data.car_specific_notes.length > 0) {
      cardsHTML += makeCard("intel", "Model Intel",
        `<ul class="carlens-list carlens-intel-list">${data.car_specific_notes.map((n) => `<li>${n}</li>`).join("")}</ul>`, true, data.car_specific_notes.length);
    }

    resultsDiv.innerHTML = `
      <div id="carlens-verdict">
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
              AI confidence in data completeness — not a buy/sell recommendation.
            </div>
          </div>
        </div>
      </div>
      ${cardsHTML}
      ${data._reportStatus && data._reportStatus !== "full_report" ? `
        <div class="carlens-report-notice">
          ${data._reportStatus === "no_link"
            ? "No CARFAX report link found. Analysis based on listing data only."
            : "Could not load full CARFAX report. Try opening the report tab first."}
        </div>
      ` : ""}
      <button id="carlens-reanalyze-btn">Re-analyze</button>
    `;

    document.getElementById("carlens-reanalyze-btn").addEventListener("click", resetOverlay);
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

  // ── Find CARFAX Report Link ────────────────────────────────────────

  function findReportLink() {
    const allLinks = document.querySelectorAll("a");

    // A real report URL contains "vehiclehistory/ccl/" (the encoded report link)
    // or "/VHR/" — NOT generic pages like "/vehicle-history-reports/"
    function isActualReportUrl(href) {
      if (!href) return false;
      return (
        href.includes("vehiclehistory/ccl/") ||
        href.includes("/VHR/") ||
        href.includes("vehiclehistory/ar/") ||
        // Report URLs are very long encoded strings
        (href.includes("carfax.com/vehiclehistory") && href.length > 80)
      );
    }

    // Priority 1: Any link on the page that points to an actual report URL
    for (const link of allLinks) {
      if (isActualReportUrl(link.href)) {
        console.log("[CarLens] Found report link (direct URL match):", link.href);
        return link.href;
      }
    }

    // Priority 2: "View FREE CARFAX Report" / "See Damage Report" buttons that
    // might use onclick/JS navigation instead of a real href.
    // Look for links with report-related text AND a real report URL.
    for (const link of allLinks) {
      const text = link.textContent.trim().toLowerCase();
      if (
        (text.includes("free carfax") || text.includes("carfax report") ||
         text.includes("damage report") || text.includes("see report") ||
         text.includes("view report")) &&
        link.href &&
        link.href.includes("carfax.com") &&
        !link.href.includes("vehicle-history-reports") && // exclude marketing page
        !link.href.endsWith("carfax.com/") &&
        link.href !== window.location.href
      ) {
        console.log("[CarLens] Found report link (text match):", link.href);
        return link.href;
      }
    }

    // Priority 3: Buttons that wrap or contain report links
    const allButtons = document.querySelectorAll("button, [role='button']");
    for (const btn of allButtons) {
      const text = btn.textContent.trim().toLowerCase();
      if (text.includes("carfax report") || text.includes("free carfax")) {
        const innerLink = btn.querySelector("a");
        if (innerLink && isActualReportUrl(innerLink.href)) return innerLink.href;
        const parentLink = btn.closest("a");
        if (parentLink && isActualReportUrl(parentLink.href)) return parentLink.href;
      }
    }

    // Priority 4: Look for report URL in data attributes or onclick handlers
    const allElements = document.querySelectorAll("[data-href], [data-url], [data-link]");
    for (const el of allElements) {
      const href = el.dataset.href || el.dataset.url || el.dataset.link;
      if (isActualReportUrl(href)) {
        console.log("[CarLens] Found report link (data attribute):", href);
        return href;
      }
    }

    console.log("[CarLens] No report link found. All links on page:");
    for (const link of allLinks) {
      if (link.href && link.href.includes("carfax")) {
        console.log("  -", link.textContent.trim().substring(0, 50), "→", link.href.substring(0, 100));
      }
    }

    return null;
  }

  // ── Fetch CARFAX Report via Background Tab (Deep Dive) ────────────
  // Opens the report in a real browser tab so React can render the data,
  // then extracts from the live DOM and closes the tab.

  async function fetchReportData(reportUrl) {
    console.log("[CarLens] Requesting background tab for report:", reportUrl);

    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "FETCH_REPORT", url: reportUrl },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn("[CarLens] Background message error:", chrome.runtime.lastError.message);
            resolve({ data: null, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response || { data: null, error: "No response from background" });
        }
      );
    });
  }

  // ── Analysis Logic ──────────────────────────────────────────────────────

  // Fun facts to show during loading
  const CAR_FACTS = [
    "The average American spends about 18 days a year in their car.",
    "A new car loses ~20% of its value the moment you drive it off the lot.",
    "The world's first speeding ticket was issued in 1902 — for going 45 mph.",
    "About 80% of a car's value depends on its maintenance history.",
    "CARFAX checks over 130,000 data sources for vehicle history.",
    "Cars with regular oil changes last 2x longer on average.",
    "A pre-purchase inspection can save you thousands in hidden repairs.",
    "The color of your car can affect resale value — white and black hold value best.",
    "Over 1 in 3 used cars has a hidden problem that only shows up in a history report.",
    "The VIN number can tell you the exact factory a car was built in.",
    "Certified Pre-Owned vehicles go through a 100+ point inspection.",
    "Flood-damaged cars can look perfect but have corrosion hiding inside the wiring.",
  ];

  const LOADING_CAR_SPRITES = [
    "sedan_blue.png", "sports_red.png", "suv.png", "convertible.png",
    "taxi.png", "sedan.png", "truck.png", "van.png",
  ];

  function startFunFacts() {
    const factEl = document.querySelector(".carlens-fact-text");
    if (!factEl) return;

    let idx = Math.floor(Math.random() * CAR_FACTS.length);
    factEl.textContent = CAR_FACTS[idx];
    factEl.style.opacity = "1";

    // Cycle through different pixel car sprites
    const carSprite = document.querySelector(".carlens-car-sprite");
    let carIdx = 0;

    return setInterval(() => {
      factEl.style.opacity = "0";
      setTimeout(() => {
        idx = (idx + 1) % CAR_FACTS.length;
        factEl.textContent = CAR_FACTS[idx];
        factEl.style.opacity = "1";
      }, 400);

      // Swap car sprite
      if (carSprite) {
        carIdx = (carIdx + 1) % LOADING_CAR_SPRITES.length;
        carSprite.src = chrome.runtime.getURL("assets/cars/" + LOADING_CAR_SPRITES[carIdx]);
      }
    }, 5000);
  }

  function setStep(stepName, state) {
    // state: "active", "done", "pending", "hidden"
    const step = document.querySelector(`.carlens-step[data-step="${stepName}"]`);
    if (!step) return;
    step.className = "carlens-step";
    if (state !== "hidden") {
      step.classList.add(`carlens-step-${state}`);
      step.style.display = "flex";
    } else {
      step.style.display = "none";
    }
  }

  async function analyzeListing() {
    const btn = document.getElementById("carlens-analyze-btn");
    const loading = document.getElementById("carlens-loading");
    const results = document.getElementById("carlens-results");
    const errorDiv = document.getElementById("carlens-error");
    const aura = document.getElementById("carlens-aura");
    const overlay = document.getElementById("carlens-overlay");

    const activeMode = overlay.querySelector(".carlens-mode-btn.active");
    const mode = activeMode ? activeMode.dataset.mode : "brief";

    btn.style.display = "none";
    loading.style.display = "flex";
    results.style.display = "none";
    errorDiv.style.display = "none";
    aura.classList.add("active");
    const auraBorder = document.getElementById("carlens-aura-border");
    if (auraBorder) auraBorder.classList.add("active");
    overlay.classList.add("carlens-analyzing");

    let reportStatus = null;

    // Set up progress steps based on mode
    setStep("extract", "active");
    setStep("report", mode === "detailed" ? "pending" : "hidden");
    setStep("ai", "pending");

    // Start cycling fun facts
    const factInterval = startFunFacts();

    try {
      expandDropdowns();
      await new Promise((r) => setTimeout(r, 800));

      const carData = await extractCarData();
      carData.mode = mode;
      setStep("extract", "done");

      console.log("[CarLens] Analyzing VIN:", carData.vin);

      // Deep Dive: fetch full CARFAX report page
      if (mode === "detailed") {
        setStep("report", "active");

        const reportLink = findReportLink();
        if (reportLink) {
          const { data: reportData, error: reportError } = await fetchReportData(reportLink);
          if (reportData) {
            carData.damage_report = reportData;
            reportStatus = "full_report";
            console.log("[CarLens] Enriched with full CARFAX report data");
          } else {
            reportStatus = "fetch_failed";
            console.warn("[CarLens] Report fetch issue:", reportError);
            if (!carData.damage_report) {
              carData.damage_report = "No detailed report data available — the full CARFAX report could not be loaded. DO NOT invent or assume any damage, structural issues, airbag deployment, or odometer problems. Only analyze based on the basic listing data provided above.";
            }
          }
        } else {
          reportStatus = "no_link";
          console.log("[CarLens] No report link found on page");
          if (!carData.damage_report) {
            carData.damage_report = "No detailed report data available — no CARFAX report link was found on the listing page. DO NOT invent or assume any damage, structural issues, airbag deployment, or odometer problems. Only analyze based on the basic listing data provided above.";
          }
        }

        setStep("report", "done");
      }

      setStep("ai", "active");

      console.log("[CarLens] Extracted data:", carData);
      console.log("[CarLens] Mode:", mode);

      const response = await fetch(BACKEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(carData),
      });

      if (!response.ok) {
        throw new Error(`Backend returned HTTP ${response.status}`);
      }

      const result = await response.json();
      result._reportStatus = reportStatus;
      console.log("[CarLens] Backend response:", result);
      renderResults(result);
    } catch (err) {
      console.error("[CarLens] Error:", err);
      errorDiv.textContent = `Error: ${err.message}. Make sure the CarLens backend is running.`;
      errorDiv.style.display = "block";
      btn.style.display = "block";
    } finally {
      clearInterval(factInterval);
      loading.style.display = "none";
      aura.classList.remove("active");
      const ab = document.getElementById("carlens-aura-border");
      if (ab) ab.classList.remove("active");
      overlay.classList.remove("carlens-analyzing");
    }
  }

  // ── Init ────────────────────────────────────────────────────────────────

  createOverlay();
  watchForNavigation();
})();
