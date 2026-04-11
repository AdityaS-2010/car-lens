// bg/comps.js — Comparable listings search.
// Navigates to CARFAX cars-for-sale, fills the search form via React-compatible
// native setter + event dispatch, then scrapes and filters results.

async function handleFetchComparablePrices(make, model, _year, location, currentPrice, currentMileage, currentVin, currentTrim, options) {
  if (!make || !model) return null;
  options = options || {};
  var maxPages = options.maxPages || 3;
  var minListingsBeforeStop = options.minListingsBeforeStop || 40;
  var crawlAllPages = !!options.crawlAllPages;
  var minExactTrimMatchesBeforeStop = options.minExactTrimMatchesBeforeStop || 0;

  // Keep the full model text until CARFAX tells us which model names are valid.
  // Some makes use multi-word base models ("3 Series", "MX-5 Miata", "F-150"),
  // while others put the trim right after a one-word model ("Charger R/T").
  var requestedModel = String(model).trim();
  var requestedTrim = (currentTrim || "").trim();
  var modelSearchText = (requestedModel + " " + requestedTrim).replace(/\s+/g, " ").trim();
  currentTrim = requestedTrim;

  console.log("[CarLens Comps] Starting search:", make, modelSearchText, "(trim:", (currentTrim || "N/A") + ")", "near", location, "(excluding VIN", currentVin + ")");

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
  await sleep(5000);

  // Step 2: Fill the make dropdown
  try {
    var makeResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fillMakeDropdown,
      args: [make],
    });
    console.log("[CarLens Comps] Make fill result:", JSON.stringify(makeResult?.[0]?.result));
  } catch (err) {
    console.warn("[CarLens Comps] Make fill failed:", err.message);
    await safeCloseTab(tab.id);
    return null;
  }

  // Wait for React to populate model dropdown after make selection, then retry if needed.
  // CARFAX sometimes needs a few attempts before the model options actually render.
  var modelFilled = false;
  for (var attempt = 0; attempt < 5; attempt++) {
    await sleep(1500);
    try {
      var modelResult = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: fillModelDropdown,
        args: [modelSearchText],
      });
      var r = modelResult?.[0]?.result;
      console.log("[CarLens Comps] Model fill attempt", attempt + 1, ":", JSON.stringify(r));
      // Check if any select actually had populated options and selected something
      var selectedModel = r && r.selections && r.selections.find(function (s) { return s.selected; });
      if (selectedModel) {
        model = selectedModel.selected;
        if (selectedModel.remainder) currentTrim = selectedModel.remainder;
        console.log("[CarLens Comps] Resolved model:", model, "(trim:", (currentTrim || "N/A") + ")");
        modelFilled = true;
        break;
      }
      // If not populated yet, re-fire the make change event on the tagged select to nudge React
      if (attempt < 4) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: function (m) {
            var sel = document.querySelector('select[data-carlens-target="true"]');
            if (sel) {
              var ns = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
              ns.call(sel, m);
              sel.dispatchEvent(new Event('input', { bubbles: true }));
              sel.dispatchEvent(new Event('change', { bubbles: true }));
            }
          },
          args: [make],
        });
      }
    } catch (err) {
      console.warn("[CarLens Comps] Model fill attempt", attempt + 1, "failed:", err.message);
    }
  }
  if (!modelFilled) {
    console.warn("[CarLens Comps] Model dropdown never populated after 5 attempts");
  }

  await sleep(1000);

  // Step 4: Fill zip code if we have location info
  if (location) {
    try {
      var zipResult = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: fillZipCode,
        args: [location],
      });
      console.log("[CarLens Comps] Zip fill result:", zipResult?.[0]?.result);
    } catch (err) {
      console.warn("[CarLens Comps] Zip fill failed:", err.message);
    }
    await sleep(500);
  }

  // Log URL right before clicking any buttons
  var preClickTab = await chrome.tabs.get(tab.id);
  console.log("[CarLens Comps] URL before button clicks:", preClickTab.url);

  // Log the current select values to see if they stuck
  try {
    var stateCheck = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: function () {
        var makes = document.querySelectorAll('#undefined-make-input');
        var models = document.querySelectorAll('#undefined-model-input');
        var result = { makes: [], models: [] };
        for (var i = 0; i < makes.length; i++) result.makes.push(makes[i].value);
        for (var i = 0; i < models.length; i++) result.models.push(models[i].value);
        return result;
      },
    });
    console.log("[CarLens Comps] Form state before clicks:", JSON.stringify(stateCheck?.[0]?.result));
  } catch (e) { /* ignore */ }

  // Step 5: Click "Next" button, then "Show Me Results"
  try {
    var nextResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: clickNextButton,
    });
    console.log("[CarLens Comps] Next click result:", JSON.stringify(nextResult?.[0]?.result));
  } catch (err) {
    console.warn("[CarLens Comps] Next button click failed:", err.message);
  }

  await sleep(2000);

  var postNextTab = await chrome.tabs.get(tab.id);
  console.log("[CarLens Comps] URL after Next click:", postNextTab.url);

  // Click "Show Me X Results" button
  try {
    var showResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: clickShowResultsButton,
    });
    console.log("[CarLens Comps] Show Results click result:", JSON.stringify(showResult?.[0]?.result));
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

  // Scroll incrementally to trigger lazy loading. Each scroll waits via the
  // background-side sleep, so we don't race against the scroll's own timing.
  // We do multiple full passes to make sure every card has been in the viewport.
  for (var scrollPass = 0; scrollPass < 6; scrollPass++) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: function (frac) {
          var h = document.body.scrollHeight;
          window.scrollTo(0, h * frac);
        },
        args: [(scrollPass + 1) / 6],
      });
    } catch (e) { /* ignore */ }
    await sleep(600);
  }
  // Final scroll to absolute bottom and wait for any final lazy loads
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: function () { window.scrollTo(0, document.body.scrollHeight); },
    });
  } catch (e) { /* ignore */ }
  await sleep(1500);

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
  console.log("[CarLens Comps] Page 1 scrape:", listings.length, "listings");

  // If page 1 didn't give us enough listings, try the next page(s).
  // Use a Set of seen VINs to avoid duplicates across pages.
  var seenVins = {};
  for (var li = 0; li < listings.length; li++) {
    var v = (listings[li].url || "").match(/\/vehicle\/([A-Z0-9]+)/i);
    if (v) seenVins[v[1]] = true;
  }

  for (var pageNum = 2; pageNum <= maxPages && (crawlAllPages || listings.length < minListingsBeforeStop); pageNum++) {
    var navigated = false;
    try {
      var navResult = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: clickNextPage,
      });
      navigated = !!navResult?.[0]?.result?.clicked;
      console.log("[CarLens Comps] Page", pageNum, "nav result:", JSON.stringify(navResult?.[0]?.result));
    } catch (e) {
      console.warn("[CarLens Comps] Page", pageNum, "nav failed:", e.message);
    }
    if (!navigated) break;

    // Wait for the next page to load
    try { await waitForTabLoad(tab.id, 10000); } catch (e) { /* ignore */ }
    await sleep(2000);

    // Scroll to load lazy content
    for (var sp = 0; sp < 6; sp++) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: function (frac) { window.scrollTo(0, document.body.scrollHeight * frac); },
          args: [(sp + 1) / 6],
        });
      } catch (e) { /* ignore */ }
      await sleep(500);
    }

    // Scrape this page
    try {
      var pageResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapeListings,
      });
      var pageListings = pageResults?.[0]?.result || [];
      var added = 0;
      for (var pi = 0; pi < pageListings.length; pi++) {
        var pv = (pageListings[pi].url || "").match(/\/vehicle\/([A-Z0-9]+)/i);
        var key = pv ? pv[1] : pageListings[pi].url;
        if (!seenVins[key]) {
          seenVins[key] = true;
          listings.push(pageListings[pi]);
          added++;
        }
      }
      if (options.labMode) {
        console.log("[CarLens Comps Lab] Page", pageNum, "titles:", JSON.stringify(pageListings.map(function (l) { return l.title + " ($" + l.price + ")"; })));
      }
      console.log("[CarLens Comps] Page", pageNum, "added:", added, "new listings, total:", listings.length);
      if (!crawlAllPages && minExactTrimMatchesBeforeStop > 0 && currentTrim) {
        var earlyTrimRegex = buildTrimRegex(currentTrim);
        var earlyTrimMatches = earlyTrimRegex
          ? listings.filter(function (l) { return earlyTrimRegex.test(l.title || ""); }).length
          : 0;
        if (earlyTrimMatches >= minExactTrimMatchesBeforeStop) {
          console.log("[CarLens Comps] Stopping pagination early after", earlyTrimMatches, "trim matches");
          break;
        }
      }
    } catch (err) {
      console.warn("[CarLens Comps] Page", pageNum, "scrape failed:", err.message);
    }
  }

  await safeCloseTab(tab.id);

  console.log("[CarLens Comps] Raw scrape:", listings.length, "listings");
  console.log("[CarLens Comps] Raw titles:", JSON.stringify(listings.map(function (l) { return l.title + " ($" + l.price + ")"; })));
  if (options.labMode && currentTrim) {
    var labTrimRegex = buildTrimRegex(currentTrim);
    var labTrimMatches = labTrimRegex
      ? listings.filter(function (l) { return labTrimRegex.test(l.title || ""); })
      : [];
    console.log("[CarLens Comps Lab] Raw trim matches for", currentTrim + ":", labTrimMatches.length,
      JSON.stringify(labTrimMatches.map(function (l) { return l.title + " ($" + l.price + ")"; })));
  }

  // Drop the original listing if it shows up in its own comps (match by VIN in URL)
  if (currentVin) {
    var beforeDedupe = listings.length;
    listings = listings.filter(function (l) {
      return !l.url || l.url.toUpperCase().indexOf(currentVin.toUpperCase()) === -1;
    });
    if (listings.length < beforeDedupe) {
      console.log("[CarLens Comps] Removed", beforeDedupe - listings.length, "self-match(es) by VIN");
    }
  }

  // Some sparse CARFAX result pages include recommended/sponsored listings for
  // other makes/models. If the model dropdown was selected, keep same make/model
  // results first, and only fall back to the broad scrape if that would leave too
  // few comps.
  if (modelFilled && model) {
    var beforeModelFilter = listings.length;
    var modelFiltered = listings.filter(function (l) {
      return listingMatchesMakeModel(l.title || "", make, model);
    });
    console.log("[CarLens Comps] Model-filtered:", modelFiltered.length, "of", beforeModelFilter,
      "(make:", make, "model:", model + ")");
    if (modelFiltered.length >= 2) {
      listings = modelFiltered;
    }
  }

  // Filter to keep only similar vehicles
  listings = filterAndSortListings(listings, _year, currentPrice, currentMileage, currentTrim);

  console.log("[CarLens Comps] Final:", listings.length, "listings");
  console.log("[CarLens Comps] Final titles:", JSON.stringify(listings.map(function (l) { return l.title + " ($" + l.price + ")"; })));

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
  // There are duplicate forms on the page (e.g. mobile vs desktop, hero vs sidebar).
  // We only want to fill the MAIN search form's dropdown — the one with the most
  // options (which is the full make list). Filling the smaller/wrong dropdown will
  // not trigger the model dropdown to populate.
  var selects = document.querySelectorAll('#undefined-make-input');
  var nativeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  var report = { selectsFound: selects.length, allCounts: [], selections: [], url: window.location.href };

  // Find the select with the most options — that's the canonical "All Makes" list
  var bestSelect = null;
  var bestCount = 0;
  var bestIndex = -1;
  for (var i = 0; i < selects.length; i++) {
    var count = selects[i].querySelectorAll('option').length;
    report.allCounts.push({ index: i, count: count });
    if (count > bestCount) {
      bestCount = count;
      bestSelect = selects[i];
      bestIndex = i;
    }
  }

  if (!bestSelect) {
    return report;
  }

  // Tag the chosen select so we can find its sibling model dropdown later
  bestSelect.setAttribute('data-carlens-target', 'true');

  var options = bestSelect.querySelectorAll('option');
  var bestMatch = null;
  for (var j = 0; j < options.length; j++) {
    if (options[j].value.toLowerCase() === make.toLowerCase()) {
      bestMatch = options[j].value;
      break;
    }
  }
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
    nativeSetter.call(bestSelect, bestMatch);
    bestSelect.dispatchEvent(new Event('input', { bubbles: true }));
    bestSelect.dispatchEvent(new Event('change', { bubbles: true }));
    report.selections.push({ index: bestIndex, optionsCount: bestCount, selected: bestMatch });
  } else {
    report.selections.push({ index: bestIndex, optionsCount: bestCount, selected: null, tried: make });
  }
  return report;
}

function fillModelDropdown(modelText) {
  var nativeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  var report = { selections: [] };

  // Find the make select we tagged earlier, then look for the model select in the same form/container.
  var taggedMake = document.querySelector('select[data-carlens-target="true"]');
  if (!taggedMake) {
    report.error = "no tagged make select";
    return report;
  }

  // Walk up the DOM looking for a model select that's a descendant of a shared ancestor.
  var modelSelect = null;
  var node = taggedMake.parentElement;
  for (var depth = 0; depth < 10 && node; depth++) {
    var candidate = node.querySelector('#undefined-model-input');
    if (candidate) {
      modelSelect = candidate;
      break;
    }
    node = node.parentElement;
  }

  if (!modelSelect) {
    report.error = "no model select found near tagged make";
    return report;
  }

  var options = modelSelect.querySelectorAll('option');
  if (options.length <= 1) {
    report.selections.push({ optionsCount: options.length, selected: null, reason: "not populated" });
    return report;
  }

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function score(searchText, optionText) {
    if (!searchText || !optionText) return 0;
    if (searchText === optionText) return 1000 + optionText.length;
    if (searchText.indexOf(optionText + " ") === 0) return 800 + optionText.length;
    if (optionText.indexOf(searchText + " ") === 0) return 500 + searchText.length;
    if (searchText.indexOf(optionText) !== -1) return 300 + optionText.length;
    if (optionText.indexOf(searchText) !== -1) return 100 + searchText.length;
    return 0;
  }

  function remainder(text, selected) {
    var normalizedText = normalize(text);
    var normalizedSelected = normalize(selected);
    if (!normalizedText || !normalizedSelected) return "";
    if (normalizedText === normalizedSelected) return "";
    if (normalizedText.indexOf(normalizedSelected + " ") !== 0) return "";

    var selectedTokens = String(selected || "").trim().split(/\s+/).length;
    return String(text || "").trim().split(/\s+/).slice(selectedTokens).join(" ");
  }

  var normalizedModel = normalize(modelText);
  var bestMatch = null;
  var bestScore = -1;
  for (var j = 0; j < options.length; j++) {
    var optionValue = options[j].value;
    if (!optionValue) continue;

    var optionScore = score(normalizedModel, normalize(optionValue));
    if (optionScore > bestScore) {
      bestScore = optionScore;
      bestMatch = optionValue;
    }
  }

  if (bestMatch && bestScore > 0) {
    nativeSetter.call(modelSelect, bestMatch);
    modelSelect.dispatchEvent(new Event('input', { bubbles: true }));
    modelSelect.dispatchEvent(new Event('change', { bubbles: true }));
    report.selections.push({
      optionsCount: options.length,
      selected: bestMatch,
      tried: modelText,
      score: bestScore,
      remainder: remainder(modelText, bestMatch)
    });
  } else {
    var availableOptions = [];
    for (var k = 0; k < options.length && k < 20; k++) availableOptions.push(options[k].value);
    report.selections.push({ optionsCount: options.length, selected: null, tried: modelText, available: availableOptions });
  }
  return report;
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
  for (var i = 0; i < buttons.length; i++) {
    var btn = buttons[i];
    var text = (btn.textContent || '').trim().toLowerCase();
    if (text === 'next' || text.includes('next step') || text.includes('next:')) {
      btn.click();
      return { clicked: btn.textContent.trim(), totalButtons: buttons.length };
    }
  }
  return { clicked: null, totalButtons: buttons.length };
}

function clickNextPage() {
  // Try common pagination patterns: aria-label, button text, link rel="next", arrow icons
  var candidates = [];

  // 1. aria-label or title containing "next"
  var aria = document.querySelectorAll('[aria-label*="next" i], [aria-label*="Next" i], [title*="next" i]');
  for (var i = 0; i < aria.length; i++) candidates.push(aria[i]);

  // 2. Link with rel="next"
  var relNext = document.querySelectorAll('a[rel="next"], link[rel="next"]');
  for (var i = 0; i < relNext.length; i++) candidates.push(relNext[i]);

  // 3. Buttons/links whose text is just "Next" or ">"
  var buttons = document.querySelectorAll('button, a');
  for (var i = 0; i < buttons.length; i++) {
    var t = (buttons[i].textContent || '').trim().toLowerCase();
    if (t === 'next' || t === '>' || t === 'next page' || t === 'next ›' || t === '›') {
      candidates.push(buttons[i]);
    }
  }

  // Click the first non-disabled candidate that looks clickable
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    if (c.disabled) continue;
    if (c.getAttribute && c.getAttribute('aria-disabled') === 'true') continue;
    var cls = (c.className || '').toString().toLowerCase();
    if (cls.indexOf('disabled') !== -1) continue;
    c.click();
    return { clicked: true, tag: c.tagName, text: (c.textContent || '').trim().substring(0, 30) };
  }
  return { clicked: false, candidatesFound: candidates.length };
}

function clickShowResultsButton() {
  var buttons = document.querySelectorAll('button, a[role="button"], [type="submit"]');
  for (var i = 0; i < buttons.length; i++) {
    var btn = buttons[i];
    var text = (btn.textContent || '').trim().toLowerCase();
    if (text.includes('show me') || text.includes('show result') || text.includes('search')) {
      btn.click();
      return { clicked: btn.textContent.trim(), method: "button" };
    }
  }
  // Fallback: try submitting a form
  var forms = document.querySelectorAll('form');
  for (var i = 0; i < forms.length; i++) {
    forms[i].submit();
    return { clicked: null, method: "form-submit-fallback" };
  }
  return { clicked: null, method: "none" };
}

// ── Filtering ──────────────────────────────────────────────────────

function filterAndSortListings(listings, year, price, mileage, trim) {
  var refYear = parseInt(year) || 0;
  var refPrice = parseInt(price) || 0;
  var refTrim = (trim || "").toLowerCase().trim();
  var trimRegex = refTrim ? buildTrimRegex(refTrim) : null;

  if (refYear > 0 || refPrice > 0) {
    // Default bounds: ±4 years, ±60% price (i.e., 40%..160% of ref price).
    // If a listing's trim matches the reference trim, widen bounds but keep them
    // bounded: ±6 years, ±80% price (i.e., 20%..180% of ref price).
    // This replaces the old *bypass* behavior so older same-trim cars still
    // respect reasonable limits and don't dominate comps.
    var trimMatches = 0;
    var filtered = listings.filter(function (l) {
      var isTrimMatch = trimRegex && trimRegex.test(l.title || "");
      if (isTrimMatch) trimMatches++;

      // Choose bounds based on whether trim matches
      var maxYearDelta = isTrimMatch ? 6 : 4;
      var minPriceFactor = isTrimMatch ? 0.20 : 0.40; // 20% or 40%
      var maxPriceFactor = isTrimMatch ? 1.80 : 1.60; // 180% or 160%

      // Year check
      if (refYear > 0 && l.year) {
        if (Math.abs(l.year - refYear) > maxYearDelta) return false;
      }

      // Price check
      if (refPrice > 0 && l.price) {
        if (l.price < refPrice * minPriceFactor || l.price > refPrice * maxPriceFactor) return false;
      }

      return true;
    });

    console.log("[CarLens Comps] Filtered:", filtered.length, "of", listings.length,
      "(ref year:", refYear, "price:", refPrice, "trim:", refTrim, "trim matches:", trimMatches + ")");

    if (filtered.length >= 2) {
      listings = filtered;
    }
  }

  // Sort: trim match is the strongest signal, then year proximity, then price proximity.
  // Lower score = more similar.
  if (refYear > 0 || refPrice > 0 || refTrim) {
    listings.sort(function (a, b) {
      var sa = 0, sb = 0;
      // 1) Trim match: HUGE penalty for not matching, so trim-matches always sort first
      if (trimRegex) {
        var at = (a.title || "");
        var bt = (b.title || "");
        if (!trimRegex.test(at)) sa += 100;
        if (!trimRegex.test(bt)) sb += 100;
      }
      // 2) Year proximity (each year off = 5 points)
      if (refYear > 0) {
        sa += Math.abs((a.year || refYear) - refYear) * 5;
        sb += Math.abs((b.year || refYear) - refYear) * 5;
      }
      // 3) Price proximity (each 10% off = 1 point)
      if (refPrice > 0) {
        sa += Math.abs((a.price || refPrice) - refPrice) / refPrice * 10;
        sb += Math.abs((b.price || refPrice) - refPrice) / refPrice * 10;
      }
      return sa - sb;
    });
  }

  return listings.slice(0, 10);
}

function listingMatchesMakeModel(title, make, model) {
  var normalizedTitle = normalizeVehicleText(title);
  var normalizedMake = normalizeVehicleText(make);
  var normalizedModel = normalizeVehicleText(model);
  if (!normalizedTitle || !normalizedModel) return false;
  if (normalizedMake && normalizedTitle.indexOf(normalizedMake) === -1) return false;
  return normalizedTitle.indexOf(normalizedModel) !== -1;
}

function normalizeVehicleText(value) {
  var normalized = String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? " " + normalized + " " : "";
}

// Build a case-insensitive word-boundary regex for matching a trim string in a title.
// This avoids false positives like "EX" matching "EX-L" — each token must be a whole word.
function buildTrimRegex(trim) {
  // Split trim into tokens (e.g. "TRD Pro" -> ["TRD", "Pro"]). Escape regex chars.
  var tokens = trim
    .split(/\s+/)
    .filter(function (t) { return t.length > 0; })
    .map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); });
  if (tokens.length === 0) return null;
  // Each token must appear as its own word (\b on both sides), in any order.
  // Use lookaheads so order doesn't matter.
  var lookaheads = tokens.map(function (t) { return "(?=.*\\b" + t + "\\b)"; }).join("");
  try {
    return new RegExp("^" + lookaheads, "i");
  } catch (e) {
    return null;
  }
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

    // Capture year + make + model + trim words. Each token after the year must
    // contain at least one letter (so we don't pull in pure numbers like mileage
    // "4,595" but still allow trims like "330i", "M340i", "EX-L", "R/T").
    var titleMatch = text.match(/(20[0-2]\d(?:\s+[A-Za-z0-9][A-Za-z0-9\-\/]*){1,7})/);
    var title = null;
    if (titleMatch) {
      // Trim: drop trailing tokens that are pure digits/punctuation (no letters).
      var parts = titleMatch[1].split(/\s+/);
      while (parts.length > 2 && !/[A-Za-z]/.test(parts[parts.length - 1])) {
        parts.pop();
      }
      title = parts.join(" ");
    }

    seen[vinKey] = true;
    listings.push({ price: price, year: year, mileage: mileage, url: linkUrl, title: title });
    if (listings.length >= 60) break;
  }

  console.log("[CarLens Scraper] Found:", listings.length, "listings");
  return listings;
}
