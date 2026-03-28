// content/extract.js
// Data extraction from CARFAX listing pages.
// Exposes: extractCarData, extractStructuredData, extractDamageReportFromPage,
//          extractNumber, getVal, waitForElement, expandDropdowns, findReportLink,
//          fetchReportData

"use strict";

// ── Helpers ──────────────────────────────────────────────────────────

function extractNumber(text) {
  if (!text) return null;
  const cleaned = text.replace(/[^0-9.]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function getVal(selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim()) return el.innerText.trim();
  }
  return null;
}

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

// ── JSON-LD / Schema.org Extraction ─────────────────────────────────

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

// ── Main Data Extraction ────────────────────────────────────────────

async function extractCarData() {
  const structured = extractStructuredData();

  await waitForElement(
    "[data-testid='vdp-price-value'], [data-testid='vdp-mileage-value'], h1, .listing-price",
    3000
  );

  const pageText = document.body.innerText;

  // VIN: URL > data-testid > JSON-LD > page text
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

  // Price: data-testid > JSON-LD > combined pattern > near-title fallback
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

  // Mileage: data-testid > JSON-LD > combined pattern > text fallback
  let mileage = extractNumber(
    getVal(["[data-testid='vdp-mileage-value']", "[data-testid='mileage-value']", ".vehicle-mileage"])
  );
  if (!mileage) mileage = structured.mileage || null;
  if (!mileage) {
    const combined = pageText.match(/\$([\d,]+)\s*[•·]\s*([\d,]+)\s*mi/i);
    if (combined) mileage = extractNumber(combined[2]);
  }
  if (!mileage) {
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

  // Title / Year / Make / Model / Trim
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

  // Accident status
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

  const damageLocation = getVal([
    "[data-testid='damage-location-value']",
    ".damage-details",
    ".damage-location",
  ]);
  if (damageLocation) {
    accidentStatus += ` (Location: ${damageLocation})`;
  }

  // Owners
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

  // Commercial use
  let commercialUse = false;
  if (/commercial\s+use/i.test(pageText) || /fleet\s+(?:use|vehicle)/i.test(pageText)) {
    commercialUse = true;
  }
  const ownerType = getVal(["[data-testid='owner-type']", ".owner-type"]);
  if (ownerType && /commercial|fleet|rental|lease/i.test(ownerType)) {
    commercialUse = true;
  }

  // Service history
  const serviceHistory = [];
  const seen = new Set();

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

  // Location
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

  // Value delta
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

// ── Damage/Report Extraction from Page Text ─────────────────────────

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

// ── Expand Dropdowns ────────────────────────────────────────────────

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

// ── Find CARFAX Report Link ─────────────────────────────────────────

function findReportLink() {
  const allLinks = document.querySelectorAll("a");

  function isActualReportUrl(href) {
    if (!href) return false;
    return (
      href.includes("vehiclehistory/ccl/") ||
      href.includes("/VHR/") ||
      href.includes("vehiclehistory/ar/") ||
      (href.includes("carfax.com/vehiclehistory") && href.length > 80)
    );
  }

  for (const link of allLinks) {
    if (isActualReportUrl(link.href)) {
      console.log("[CarLens] Found report link (direct URL match):", link.href);
      return link.href;
    }
  }

  for (const link of allLinks) {
    const text = link.textContent.trim().toLowerCase();
    if (
      (text.includes("free carfax") || text.includes("carfax report") ||
       text.includes("damage report") || text.includes("see report") ||
       text.includes("view report")) &&
      link.href &&
      link.href.includes("carfax.com") &&
      !link.href.includes("vehicle-history-reports") &&
      !link.href.endsWith("carfax.com/") &&
      link.href !== window.location.href
    ) {
      console.log("[CarLens] Found report link (text match):", link.href);
      return link.href;
    }
  }

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

  const allElements = document.querySelectorAll("[data-href], [data-url], [data-link]");
  for (const el of allElements) {
    const href = el.dataset.href || el.dataset.url || el.dataset.link;
    if (isActualReportUrl(href)) {
      console.log("[CarLens] Found report link (data attribute):", href);
      return href;
    }
  }

  console.log("[CarLens] No report link found. All CARFAX links on page:");
  for (const link of allLinks) {
    if (link.href && link.href.includes("carfax")) {
      console.log("  -", link.textContent.trim().substring(0, 50), "→", link.href.substring(0, 100));
    }
  }

  return null;
}

// ── Fetch CARFAX Report via Background Tab ──────────────────────────

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

// ── Fetch Comparable Prices via Background Tab ──────────────────────

async function fetchComparablePrices(make, model, year, location) {
  console.log("[CarLens] Requesting comparable prices:", { make, model, year, location });

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "FETCH_COMPARABLE_PRICES", make, model, year, location },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn("[CarLens] Comps message error:", chrome.runtime.lastError.message);
          resolve(null);
          return;
        }
        resolve(response || null);
      }
    );
  });
}
