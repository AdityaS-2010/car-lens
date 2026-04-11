// content/main.js
// Analysis flow, navigation detection, initialization.
// Depends on: extract.js (extractCarData, expandDropdowns, findReportLink,
//             fetchReportData, fetchComparablePrices)
//             ui.js (createOverlay, renderResults, resetOverlay, setStep)

"use strict";

(function () {
  if (document.getElementById("carlens-overlay")) return;

  const LOCAL_BACKEND = "http://localhost:5000";
  const DEPLOYED_BACKEND = "https://car-lens.onrender.com";

  // Resolved once per page load. Prefers localhost (for dev), falls back to deployed.
  let _backendBasePromise = null;
  function resolveBackendBase() {
    if (_backendBasePromise) return _backendBasePromise;
    _backendBasePromise = (async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1500);
        const res = await fetch(`${LOCAL_BACKEND}/health`, { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) {
          console.log("[CarLens] Using local backend");
          return LOCAL_BACKEND;
        }
      } catch (e) {
        // localhost unreachable — fall through
      }
      console.log("[CarLens] Using deployed backend");
      return DEPLOYED_BACKEND;
    })();
    return _backendBasePromise;
  }

  // Track the current URL for SPA navigation detection
  let lastUrl = window.location.href;

  // ── Fun Facts & Loading Animation ───────────────────────────────────

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

  function startFunFacts() {
    const factEl = document.querySelector(".carlens-fact-text");
    if (!factEl) return;

    let idx = Math.floor(Math.random() * CAR_FACTS.length);
    factEl.textContent = CAR_FACTS[idx];
    factEl.style.opacity = "1";

    return setInterval(() => {
      factEl.style.opacity = "0";
      setTimeout(() => {
        idx = (idx + 1) % CAR_FACTS.length;
        factEl.textContent = CAR_FACTS[idx];
        factEl.style.opacity = "1";
      }, 400);
    }, 5000);
  }

  function setStep(stepName, state) {
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

  // ── Analysis Flow ─────────────────────────────────────────────────

  async function analyzeListing() {
    const btn = document.getElementById("carlens-analyze-btn");
    const labBtn = document.getElementById("carlens-comps-lab-btn");
    const loading = document.getElementById("carlens-loading");
    const results = document.getElementById("carlens-results");
    const errorDiv = document.getElementById("carlens-error");
    const aura = document.getElementById("carlens-aura");
    const overlay = document.getElementById("carlens-overlay");

    const activeMode = overlay.querySelector(".carlens-mode-btn.active");
    const mode = activeMode ? activeMode.dataset.mode : "brief";

    btn.style.display = "none";
    if (labBtn) labBtn.style.display = "none";
    loading.style.display = "flex";
    results.style.display = "none";
    errorDiv.style.display = "none";
    aura.classList.add("active");
    const auraBorder = document.getElementById("carlens-aura-border");
    if (auraBorder) auraBorder.classList.add("active");
    overlay.classList.add("carlens-analyzing");

    let reportStatus = null;
    let compsData = null;

    // Progress steps
    setStep("extract", "active");
    setStep("report", "pending");
    setStep("comps", mode === "detailed" ? "pending" : "hidden");
    setStep("ai", "pending");

    const factInterval = startFunFacts();
    CarLensGame.start();

    try {
      expandDropdowns();
      await new Promise((r) => setTimeout(r, 800));

      const carData = await extractCarData();
      carData.mode = mode;
      setStep("extract", "done");

      console.log("[CarLens] Analyzing VIN:", carData.vin);

      // Both modes: fetch full CARFAX report page
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

      // Deep Dive only: find & scrape comparable listings
      if (mode === "detailed" && carData.make && carData.model) {
        setStep("comps", "active");
        try {
          compsData = await fetchComparablePrices(
            carData.make, carData.model, carData.year, carData.location,
            carData.price, carData.mileage, carData.vin, carData.trim
          );
          if (compsData && compsData.count >= 2) {
            carData.comparable_prices = compsData;
            console.log("[CarLens] Found", compsData.count, "comparable listings (Tier", compsData.tier + ")");
          }
        } catch (err) {
          console.warn("[CarLens] Comparable prices failed:", err.message);
        }
        setStep("comps", "done");
      }

      setStep("ai", "active");

      console.log("[CarLens] Extracted data:", carData);
      console.log("[CarLens] Mode:", mode);

      const backendBase = await resolveBackendBase();
      const response = await fetch(`${backendBase}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(carData),
      });

      if (!response.ok) {
        throw new Error(`Backend returned HTTP ${response.status}`);
      }

      const result = await response.json();
      result._reportStatus = reportStatus;
      result._comps = compsData;
      console.log("[CarLens] Backend response:", result);
      renderResults(result);
    } catch (err) {
      console.error("[CarLens] Error:", err);
      errorDiv.textContent = `Error: ${err.message}. The CarLens backend may be unreachable.`;
      errorDiv.style.display = "block";
      btn.style.display = "block";
      if (labBtn) labBtn.style.display = "none";
    } finally {
      clearInterval(factInterval);
      CarLensGame.stop();
      loading.style.display = "none";
      aura.classList.remove("active");
      const ab = document.getElementById("carlens-aura-border");
      if (ab) ab.classList.remove("active");
      overlay.classList.remove("carlens-analyzing");
    }
  }

  async function testComparableListings() {
    const analyzeBtn = document.getElementById("carlens-analyze-btn");
    const labBtn = document.getElementById("carlens-comps-lab-btn");
    const loading = document.getElementById("carlens-loading");
    const results = document.getElementById("carlens-results");
    const errorDiv = document.getElementById("carlens-error");

    analyzeBtn.style.display = "none";
    if (labBtn) labBtn.style.display = "none";
    loading.style.display = "flex";
    results.style.display = "none";
    errorDiv.style.display = "none";

    setStep("extract", "active");
    setStep("report", "hidden");
    setStep("comps", "pending");
    setStep("ai", "hidden");

    try {
      expandDropdowns();
      await new Promise((r) => setTimeout(r, 800));

      const carData = await extractCarData();
      console.log("[CarLens Lab] Extracted data:", carData);
      setStep("extract", "done");

      setStep("comps", "active");
      const labResult = await fetchComparablePricesLab(carData);
      setStep("comps", "done");

      console.log("[CarLens Lab] Comparable listings test result:", labResult);
      if (labResult && labResult.result && labResult.result.listings) {
        console.table(labResult.result.listings.map((l) => ({
          title: l.title,
          price: l.price,
          year: l.year,
          mileage: l.mileage,
          url: l.url,
        })));
      }

      results.innerHTML = `
        <div class="carlens-tldr">
          <p>Similar listings test finished. Check DevTools for the extracted input, raw result, and listing table.</p>
        </div>
        <button id="carlens-reanalyze-btn">Back</button>
      `;
      document.getElementById("carlens-reanalyze-btn").addEventListener("click", resetOverlay);
      results.style.display = "block";
    } catch (err) {
      console.error("[CarLens Lab] Error:", err);
      errorDiv.textContent = `Comps lab error: ${err.message}`;
      errorDiv.style.display = "block";
      analyzeBtn.style.display = "block";
      if (labBtn) labBtn.style.display = "none";
    } finally {
      loading.style.display = "none";
    }
  }

  // Make analyzeListing available to ui.js event listener
  window._carlensAnalyze = analyzeListing;
  window._carlensTestComps = testComparableListings;

  // ── SPA Navigation Detection ──────────────────────────────────────

  function watchForNavigation() {
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

  // ── Init ──────────────────────────────────────────────────────────

  createOverlay();
  // Warm up the backend early — resolveBackendBase pings localhost,
  // and if it falls through to the deployed URL, fire a /health ping
  // to wake the Render free-tier instance before the user clicks Analyze.
  resolveBackendBase().then((base) => {
    if (base === DEPLOYED_BACKEND) {
      fetch(`${base}/health`).catch(() => {});
    }
  });
  watchForNavigation();
})();
