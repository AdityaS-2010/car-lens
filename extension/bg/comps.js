// bg/comps.js — Comparable listings search.
// Navigates to CARFAX cars-for-sale, fills the search form via React-compatible
// native setter + event dispatch, then scrapes and filters results.

async function handleFetchComparablePrices(make, model, _year, location, currentPrice, currentMileage) {
  if (!make || !model) return null;

  console.log("[CarLens Comps] Starting search:", make, model, "near", location);

  // Step 1: Open the CARFAX search page
  let tab;
  try {
    tab = await chrome.tabs.create({ url: "https://www.carfax.com/cars-for-sale", active: false });
  } catch (err) {
    console.warn("[CarLens Comps] Could not open tab:", err.message);
    return null;
  }

  try {
    await waitForTabLoad(tab.id, 15000);
  } catch (err) {
    await safeCloseTab(tab.id);
    return null;
  }

  // Wait for React to hydrate
  await sleep(3000);

  // Step 2: Fill the make dropdown
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fillMakeDropdown,
      args: [make],
    });
  } catch (err) {
    console.warn("[CarLens Comps] Make fill failed:", err.message);
    await safeCloseTab(tab.id);
    return null;
  }

  // Wait for React to populate model dropdown after make selection
  await sleep(2000);

  // Step 3: Fill the model dropdown
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fillModelDropdown,
      args: [model],
    });
  } catch (err) {
    console.warn("[CarLens Comps] Model fill failed:", err.message);
  }

  await sleep(1000);

  // Step 4: Fill zip code if we have location info
  if (location) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: fillZipCode,
        args: [location],
      });
    } catch (err) {
      console.warn("[CarLens Comps] Zip fill failed:", err.message);
    }
    await sleep(500);
  }

  // Step 5: Click "Next" button, then "Show Me Results"
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: clickNextButton,
    });
  } catch (err) {
    console.warn("[CarLens Comps] Next button click failed:", err.message);
  }

  await sleep(2000);

  // Click "Show Me X Results" button
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: clickShowResultsButton,
    });
  } catch (err) {
    console.warn("[CarLens Comps] Show Results click failed:", err.message);
  }

  // Wait for results page to load
  try {
    await waitForTabLoad(tab.id, 15000);
  } catch (err) {
    // May already be loaded
  }

  await sleep(4000);

  // Verify we got to a results page
  var tabInfo = await chrome.tabs.get(tab.id);
  console.log("[CarLens Comps] Results URL:", tabInfo.url);

  // Scroll to trigger lazy loading
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: function () {
        window.scrollTo(0, document.body.scrollHeight / 3);
        setTimeout(function () { window.scrollTo(0, document.body.scrollHeight * 2 / 3); }, 400);
        setTimeout(function () { window.scrollTo(0, document.body.scrollHeight); }, 800);
        setTimeout(function () { window.scrollTo(0, 0); }, 1200);
      },
    });
  } catch (e) { /* ignore */ }

  await sleep(2000);

  // Step 6: Scrape listings
  var listings = [];
  try {
    var results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeListings,
    });
    listings = results?.[0]?.result || [];
  } catch (err) {
    console.warn("[CarLens Comps] Scrape failed:", err.message);
  }

  await safeCloseTab(tab.id);

  console.log("[CarLens Comps] Raw scrape:", listings.length, "listings");

  // Filter to keep only similar vehicles
  listings = filterAndSortListings(listings, _year, currentPrice, currentMileage);

  console.log("[CarLens Comps] Final:", listings.length, "listings");

  if (listings.length >= 2) {
    var prices = listings.map(function (l) { return l.price; });
    return {
      tier: 1,
      tier_label: location || "nearby",
      count: listings.length,
      avg: Math.round(prices.reduce(function (a, b) { return a + b; }, 0) / prices.length),
      min: Math.min.apply(null, prices),
      max: Math.max.apply(null, prices),
      listings: listings,
    };
  }

  return { count: 0, tier: 0, tier_label: "none", avg: 0, min: 0, max: 0, listings: [] };
}

// ── Injected form-fill functions (each fully self-contained) ───────

function fillMakeDropdown(make) {
  // There are duplicate forms (mobile + desktop). In background tabs offsetParent
  // is null for everything, so we just fill ALL matching selects to be safe.
  var selects = document.querySelectorAll('#undefined-make-input');
  var nativeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  console.log("[CarLens Comps] Make selects found:", selects.length);

  for (var i = 0; i < selects.length; i++) {
    var s = selects[i];
    var options = s.querySelectorAll('option');

    // Find best matching option
    var bestMatch = null;
    for (var j = 0; j < options.length; j++) {
      if (options[j].value.toLowerCase() === make.toLowerCase()) {
        bestMatch = options[j].value;
        break;
      }
    }
    // Partial match fallback
    if (!bestMatch) {
      for (var j = 0; j < options.length; j++) {
        if (options[j].value.toLowerCase().includes(make.toLowerCase()) ||
            make.toLowerCase().includes(options[j].value.toLowerCase())) {
          bestMatch = options[j].value;
          break;
        }
      }
    }

    if (bestMatch) {
      nativeSetter.call(s, bestMatch);
      s.dispatchEvent(new Event('input', { bubbles: true }));
      s.dispatchEvent(new Event('change', { bubbles: true }));
      console.log("[CarLens Comps] Make selected on select", i, ":", bestMatch);
    } else {
      console.log("[CarLens Comps] No match for make:", make, "in select", i);
    }
  }
}

function fillModelDropdown(model) {
  var selects = document.querySelectorAll('#undefined-model-input');
  var nativeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  console.log("[CarLens Comps] Model selects found:", selects.length);

  for (var i = 0; i < selects.length; i++) {
    var s = selects[i];
    var options = s.querySelectorAll('option');
    console.log("[CarLens Comps] Model options in select", i, ":", options.length);

    if (options.length <= 1) {
      console.log("[CarLens Comps] Model dropdown", i, "not populated yet");
      continue;
    }

    // Exact match
    var bestMatch = null;
    for (var j = 0; j < options.length; j++) {
      if (options[j].value.toLowerCase() === model.toLowerCase()) {
        bestMatch = options[j].value;
        break;
      }
    }
    // Partial match
    if (!bestMatch) {
      for (var j = 0; j < options.length; j++) {
        if (options[j].value.toLowerCase().includes(model.toLowerCase()) ||
            model.toLowerCase().includes(options[j].value.toLowerCase())) {
          bestMatch = options[j].value;
          break;
        }
      }
    }

    if (bestMatch) {
      nativeSetter.call(s, bestMatch);
      s.dispatchEvent(new Event('input', { bubbles: true }));
      s.dispatchEvent(new Event('change', { bubbles: true }));
      console.log("[CarLens Comps] Model selected on select", i, ":", bestMatch);
    } else {
      console.log("[CarLens Comps] No matching model for:", model, "in select", i);
    }
  }
}

function fillZipCode(location) {
  // Try to extract a zip code from the location string, or use the city/state
  var zipMatch = location.match(/\b(\d{5})\b/);
  var zip = zipMatch ? zipMatch[1] : null;

  if (!zip) {
    console.log("[CarLens Comps] No zip code in location:", location);
    return;
  }

  // Look for zip/location input field
  var inputs = document.querySelectorAll('input[type="text"], input[type="tel"], input[placeholder*="zip" i], input[placeholder*="ZIP"], input[aria-label*="zip" i], input[name*="zip" i], input[id*="zip" i]');
  var nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;

  for (var i = 0; i < inputs.length; i++) {
    var inp = inputs[i];
    if (inp.offsetParent === null) continue;
    var placeholder = (inp.placeholder || '').toLowerCase();
    var label = (inp.getAttribute('aria-label') || '').toLowerCase();
    var name = (inp.name || '').toLowerCase();
    var id = (inp.id || '').toLowerCase();

    if (placeholder.includes('zip') || label.includes('zip') || name.includes('zip') || id.includes('zip')) {
      nativeSetter.call(inp, zip);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      console.log("[CarLens Comps] Zip code set:", zip);
      return;
    }
  }

  // Broader fallback: any short numeric input that might be zip
  var allInputs = document.querySelectorAll('input[type="text"], input[type="tel"], input[type="number"]');
  for (var i = 0; i < allInputs.length; i++) {
    var inp = allInputs[i];
    var maxLen = parseInt(inp.getAttribute('maxlength') || '0');
    if (maxLen === 5 || (inp.pattern && inp.pattern.includes('\\d{5}'))) {
      nativeSetter.call(inp, zip);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      console.log("[CarLens Comps] Zip code set (fallback):", zip);
      return;
    }
  }
  console.log("[CarLens Comps] No zip input found");
}

function clickNextButton() {
  var buttons = document.querySelectorAll('button, a[role="button"], [type="submit"]');
  console.log("[CarLens Comps] Total buttons on page:", buttons.length);
  for (var i = 0; i < buttons.length; i++) {
    var btn = buttons[i];
    var text = (btn.textContent || '').trim().toLowerCase();
    if (text === 'next' || text.includes('next step') || text.includes('next:')) {
      btn.click();
      console.log("[CarLens Comps] Clicked Next button:", btn.textContent.trim());
      return;
    }
  }
  console.log("[CarLens Comps] No Next button found");
}

function clickShowResultsButton() {
  var buttons = document.querySelectorAll('button, a[role="button"], [type="submit"]');
  for (var i = 0; i < buttons.length; i++) {
    var btn = buttons[i];
    var text = (btn.textContent || '').trim().toLowerCase();
    if (text.includes('show me') || text.includes('show result') || text.includes('search')) {
      btn.click();
      console.log("[CarLens Comps] Clicked Show Results button:", btn.textContent.trim());
      return;
    }
  }
  // Fallback: try submitting a form
  var forms = document.querySelectorAll('form');
  for (var i = 0; i < forms.length; i++) {
    forms[i].submit();
    console.log("[CarLens Comps] Submitted form as fallback");
    return;
  }
  console.log("[CarLens Comps] No Show Results button found");
}

// ── Filtering ──────────────────────────────────────────────────────

function filterAndSortListings(listings, year, price, mileage) {
  var refYear = parseInt(year) || 0;
  var refPrice = parseInt(price) || 0;

  if (refYear > 0 || refPrice > 0) {
    var filtered = listings.filter(function (l) {
      if (refYear > 0 && l.year && Math.abs(l.year - refYear) > 3) return false;
      if (refPrice > 0 && l.price && (l.price < refPrice * 0.5 || l.price > refPrice * 1.5)) return false;
      return true;
    });
    console.log("[CarLens Comps] Filtered:", filtered.length, "of", listings.length,
      "(ref year:", refYear, "price:", refPrice + ")");
    if (filtered.length >= 2) {
      listings = filtered;
    }
  }

  // Sort by similarity to reference car
  if (refYear > 0 || refPrice > 0) {
    listings.sort(function (a, b) {
      var sa = 0, sb = 0;
      if (refYear > 0) { sa += Math.abs((a.year || refYear) - refYear); sb += Math.abs((b.year || refYear) - refYear); }
      if (refPrice > 0) { sa += Math.abs((a.price || refPrice) - refPrice) / refPrice * 3; sb += Math.abs((b.price || refPrice) - refPrice) / refPrice * 3; }
      return sa - sb;
    });
  }

  return listings.slice(0, 10);
}

// ── Injected into results page (fully self-contained) ──────────────

function scrapeListings() {
  console.log("[CarLens Scraper] URL:", window.location.href);

  var vehicleLinks = document.querySelectorAll("a[href*='/vehicle/']");
  console.log("[CarLens Scraper] Vehicle links:", vehicleLinks.length);

  if (vehicleLinks.length === 0) {
    console.log("[CarLens Scraper] No vehicle links found");
    return [];
  }

  var listings = [];
  var seen = {};

  for (var i = 0; i < vehicleLinks.length; i++) {
    var link = vehicleLinks[i];
    var linkUrl = link.href;

    // Dedupe by VIN from URL
    var vin = linkUrl.match(/\/vehicle\/([A-Z0-9]+)/i);
    var vinKey = vin ? vin[1] : linkUrl;
    if (seen[vinKey]) continue;

    // Walk up to find the listing card container
    var container = link;
    var foundPrice = false;
    for (var up = 0; up < 8; up++) {
      if (!container.parentElement) break;
      container = container.parentElement;
      var ct = container.innerText || "";
      if (/\$[\d,]{4,}/.test(ct) && ct.length > 30 && ct.length < 2000) {
        foundPrice = true;
        break;
      }
    }
    if (!foundPrice) continue;

    var text = container.innerText || "";

    // Extract LISTING price — skip CARFAX Value, monthly payments, delta amounts
    var price = 0;
    var lines = text.split("\n");
    for (var li = 0; li < lines.length; li++) {
      var m = lines[li].match(/\$([\d,]{4,})/);
      if (!m) continue;
      var val = parseInt(m[1].replace(/,/g, ""));
      if (val < 3000 || val > 500000) continue;
      var lower = lines[li].toLowerCase();
      if (lower.includes("carfax value")) continue;
      if (lower.includes("/mo") || lower.includes("per month")) continue;
      if (lower.includes("below") || lower.includes("above")) continue;
      price = val;
      break;
    }
    if (price < 3000) continue;

    var yearMatch = text.match(/\b(20[0-2]\d)\b/);
    var year = yearMatch ? parseInt(yearMatch[1]) : null;

    var mileageMatch = text.match(/([\d,]+)\s*(?:mi|miles)/i);
    var mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, "")) : null;

    var titleMatch = text.match(/(20[0-2]\d\s+[A-Za-z][A-Za-z\-]+(?:\s+[A-Za-z][A-Za-z\-]+){0,3})/);
    var title = titleMatch ? titleMatch[1].trim() : null;

    seen[vinKey] = true;
    listings.push({ price: price, year: year, mileage: mileage, url: linkUrl, title: title });
    if (listings.length >= 15) break;
  }

  console.log("[CarLens Scraper] Found:", listings.length, "listings");
  return listings;
}
