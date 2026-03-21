// content.js
// Injected on CARFAX listing pages. Extracts car data from the DOM,
// sends it to the CarLens backend, and displays the verdict overlay.

(function () {
  "use strict";

  if (document.getElementById("carlens-overlay")) return;

  const BACKEND_URL = "http://localhost:5000/analyze";

  // ── Extraction Helpers ────────────────────────────────────────────────

  function extractNumber(text) {
    if (!text) return null;
    const cleaned = text.replace(/[^0-9.]/g, "");
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }

  // Try multiple selectors, return first match's text
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

    // Try JSON-LD (Schema.org) — most reliable if present
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

    // Try Open Graph / meta tags as fallback
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle && !data.title) data.title = ogTitle.content;

    return data;
  }

  // ── CARFAX Data Extraction ──────────────────────────────────────────

  function extractCarData() {
    const pageText = document.body.innerText;
    const structured = extractStructuredData();

    // ── VIN: from URL first (carfax.com/vehicle/{VIN}), then structured data, then page text
    let vin = null;
    const urlVinMatch = window.location.pathname.match(/\/vehicle\/([A-HJ-NPR-Z0-9]{17})/i);
    if (urlVinMatch) {
      vin = urlVinMatch[1].toUpperCase();
    } else if (structured.vin) {
      vin = structured.vin;
    } else {
      const vinMatch = pageText.match(/(?:VIN[:\s]*)?([A-HJ-NPR-Z0-9]{17})/i);
      if (vinMatch) vin = vinMatch[1].toUpperCase();
    }

    // ── Title / Year / Make / Model / Trim
    // Try structured data first, then DOM, then page text
    let titleText = structured.title || "";
    if (!titleText) {
      // Try common heading selectors
      titleText = textFromSelectors([
        "h1",
        "[data-testid*='ehicle']",  // matches vehicleTitle, VehicleName, etc.
        "[class*='ehicle'][class*='itle']",
        "[class*='ehicle'][class*='ame']",
      ]) || "";
    }

    // Find a year-make-model pattern anywhere in the title text
    let year = structured.year || null;
    let make = structured.make || null;
    let model = structured.model || null;
    let trim = null;

    // Pattern: "2019 BMW M3 Competition xDrive" or "Used 2019 BMW M3"
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
        // We have model from structured data, rest might be trim
        const trimText = rest.replace(model, "").trim();
        if (trimText) trim = trimText;
      }
    }

    // If still no year/make/model, search the full page text
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

    // ── Price: Target the CARFAX listing price element specifically
    let price = extractNumber(textFromSelectors([
      ".listing-price",
      "span.listing-price",
      "[data-testid='vdp-price-value']",
      ".primary-price",
    ])) || structured.price || null;
    if (!price) {
      const priceMatches = pageText.match(/\$\s?[\d,]+/g) || [];
      for (const pm of priceMatches) {
        const val = extractNumber(pm);
        if (val >= 5000 && val <= 500000) {
          price = val;
          break;
        }
      }
    }

    // ── Mileage: header summary first, then structured data, then page text
    let mileage = null;
    const headerEl = document.querySelector(".vdp-header-info");
    if (headerEl) {
      const milMatch = headerEl.innerText.match(/([\d,]+)\s*mi/i);
      if (milMatch) mileage = extractNumber(milMatch[1]);
    }
    if (!mileage) mileage = structured.mileage || null;
    if (!mileage) {
      const mileagePatterns = [
        /(?:mileage|odometer)[:\s]*([\d,]+)/i,
        /([\d,]+)\s*(?:miles|mi\b)/i,
      ];
      for (const pattern of mileagePatterns) {
        const match = pageText.match(pattern);
        if (match) {
          const val = extractNumber(match[1]);
          if (val && val < 1000000) {
            mileage = val;
            break;
          }
        }
      }
    }

    // ── Accident status
    let accidentStatus = "Unknown";
    if (pageText.match(/no\s+accident/i) || pageText.match(/0\s+accident/i)) {
      accidentStatus = "No accidents reported";
    } else if (pageText.match(/accident.*reported/i) || pageText.match(/\d+\s+accident/i)) {
      const accMatch = pageText.match(/(\d+)\s+accident/i);
      accidentStatus = accMatch ? `${accMatch[1]} accident(s) reported` : "Accident(s) reported";
    }

    // ── Number of owners
    let owners = null;
    const ownerPatterns = [
      /(\d+)[- ]owner/i,
      /owners?[:\s]*(\d+)/i,
    ];
    for (const pattern of ownerPatterns) {
      const match = pageText.match(pattern);
      if (match) {
        owners = parseInt(match[1]);
        break;
      }
    }

    // ── Commercial use
    let commercialUse = false;
    if (pageText.match(/commercial\s+use/i) || pageText.match(/fleet\s+(?:use|vehicle)/i)) {
      commercialUse = true;
    }

    // ── Service history: Scope to the vehicle history section only
    const serviceHistory = [];
    const seen = new Set();
    const serviceKeywords = [
      "changed", "replaced", "inspected", "checked", "repaired",
      "performed", "maintenance", "oil", "filter", "tire", "brake",
      "fluid", "serviced", "rotation",
    ];

    // Try the specific history summary first (CARFAX uses bullet separators)
    const historySection = document.querySelector(".service-history-summary") ||
                           document.querySelector("#vehicle-history-section") ||
                           document.querySelector(".vehicle-history-details");

    if (historySection) {
      // CARFAX separates records with bullet character
      const rawText = historySection.innerText;
      const records = rawText.split(/[•\n]/).map((s) => s.trim()).filter(Boolean);
      for (const record of records) {
        const lower = record.toLowerCase();
        if (
          record.length > 10 &&
          record.length < 200 &&
          serviceKeywords.some((kw) => lower.includes(kw)) &&
          !seen.has(record)
        ) {
          seen.add(record);
          serviceHistory.push(record);
        }
        if (serviceHistory.length >= 10) break;
      }

      // Also check li elements within the section
      if (serviceHistory.length === 0) {
        historySection.querySelectorAll("li, .history-item").forEach((el) => {
          const txt = el.textContent.trim().replace(/\s+/g, " ");
          const lower = txt.toLowerCase();
          if (
            txt.length > 10 &&
            serviceKeywords.some((kw) => lower.includes(kw)) &&
            !seen.has(txt)
          ) {
            seen.add(txt);
            serviceHistory.push(txt);
          }
        });
      }
    }

    // ── Location: Use schema tags, dealer info, or breadcrumbs
    let location = textFromSelectors([
      "span[itemprop='addressLocality']",
      ".dealer-address",
      ".location-info",
    ]);
    // Filter out legal/disclaimer text that sometimes matches
    if (location && location.includes("document")) location = null;
    if (!location) {
      const crumbs = document.querySelectorAll(".breadcrumb-item, .breadcrumbs li, .breadcrumbs a");
      if (crumbs.length > 0) {
        location = crumbs[crumbs.length - 1].textContent.trim();
      }
    }
    if (!location) {
      const locMatch = pageText.match(/(?:located|dealer|location)[:\s]*([A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s*[A-Z]{2})/i);
      if (locMatch) location = locMatch[1];
    }

    // ── Value delta
    let valueDelta = null;
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
    };
  }

  // ── Overlay UI ──────────────────────────────────────────────────────────

  function createOverlay() {
    const overlay = document.createElement("div");
    overlay.id = "carlens-overlay";
    overlay.innerHTML = `
      <div id="carlens-header">
        <span id="carlens-logo">CarLens</span>
        <button id="carlens-close">&times;</button>
      </div>
      <div id="carlens-body">
        <button id="carlens-analyze-btn">Analyze This Listing</button>
        <div id="carlens-loading" style="display:none;">
          <div class="carlens-spinner"></div>
          <span>Analyzing listing...</span>
        </div>
        <div id="carlens-results" style="display:none;"></div>
        <div id="carlens-error" style="display:none;"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById("carlens-close").addEventListener("click", () => {
      overlay.style.display = overlay.style.display === "none" ? "block" : "none";
    });

    document.getElementById("carlens-analyze-btn").addEventListener("click", analyzeListing);
  }

  function renderResults(data) {
    const resultsDiv = document.getElementById("carlens-results");

    const confidenceColor =
      data.confidence >= 70 ? "#34a853" : data.confidence >= 40 ? "#fbbc04" : "#ea4335";

    let positivesHTML = "";
    if (data.positives && data.positives.length > 0) {
      positivesHTML = `
        <div class="carlens-section">
          <div class="carlens-section-title carlens-positive-title">Positives</div>
          <ul class="carlens-list carlens-positive-list">
            ${data.positives.map((p) => `<li>${p}</li>`).join("")}
          </ul>
        </div>
      `;
    }

    let risksHTML = "";
    if (data.risks && data.risks.length > 0) {
      risksHTML = `
        <div class="carlens-section">
          <div class="carlens-section-title carlens-risk-title">Risks</div>
          <ul class="carlens-list carlens-risk-list">
            ${data.risks.map((r) => `<li>${r}</li>`).join("")}
          </ul>
        </div>
      `;
    }

    let notesHTML = "";
    if (data.car_specific_notes && data.car_specific_notes.length > 0) {
      notesHTML = `
        <div class="carlens-section">
          <div class="carlens-section-title">Car-Specific Notes</div>
          <ul class="carlens-list">
            ${data.car_specific_notes.map((n) => `<li>${n}</li>`).join("")}
          </ul>
        </div>
      `;
    }

    resultsDiv.innerHTML = `
      <div id="carlens-verdict">
        <div class="carlens-verdict-label">Verdict</div>
        <div class="carlens-verdict-text">${data.verdict}</div>
        <div class="carlens-confidence">
          <div class="carlens-confidence-bar">
            <div class="carlens-confidence-fill" style="width:${data.confidence}%;background:${confidenceColor};"></div>
          </div>
          <span class="carlens-confidence-label">${data.confidence}% confidence</span>
        </div>
      </div>
      ${positivesHTML}
      ${risksHTML}
      ${notesHTML}
      <div class="carlens-section">
        <div class="carlens-section-title">Summary</div>
        <p class="carlens-summary">${data.summary}</p>
      </div>
    `;

    resultsDiv.style.display = "block";
  }

  // ── Analysis Logic ──────────────────────────────────────────────────────

  async function analyzeListing() {
    const btn = document.getElementById("carlens-analyze-btn");
    const loading = document.getElementById("carlens-loading");
    const results = document.getElementById("carlens-results");
    const errorDiv = document.getElementById("carlens-error");

    btn.style.display = "none";
    loading.style.display = "flex";
    results.style.display = "none";
    errorDiv.style.display = "none";

    try {
      const carData = extractCarData();
      console.log("[CarLens] Extracted data:", carData);

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
    }
  }

  // ── Init ────────────────────────────────────────────────────────────────

  createOverlay();
})();
