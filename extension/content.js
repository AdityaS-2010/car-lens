// content.js
// Injected into every page by the CarLens extension.
// Renders a floating badge and sends mock car data to the local backend.

(function () {
  "use strict";

  // ── Badge ──────────────────────────────────────────────────────────────────

  // Avoid injecting twice (e.g. on SPA navigation events)
  if (document.getElementById("carlens-badge")) return;

  const badge = document.createElement("div");
  badge.id = "carlens-badge";
  badge.textContent = "CarLens Active";
  document.body.appendChild(badge);

  // ── Analyze button ─────────────────────────────────────────────────────────

  const btn = document.createElement("button");
  btn.id = "carlens-analyze-btn";
  btn.textContent = "Analyze Listing";
  document.body.appendChild(btn);

  // ── Mock car data ──────────────────────────────────────────────────────────

  // Replace this with real DOM-scraped data in a future iteration.
  const mockCarData = {
    make: "Toyota",
    model: "Camry",
    year: 2019,
    mileage: 45000,
    price: 18500,
    vin: "4T1BF1FK5KU123456",
    condition: "Good",
    source_url: window.location.href,
  };

  // ── Send to backend ────────────────────────────────────────────────────────

  async function analyzeListing() {
    const BACKEND_URL = "http://localhost:5000/analyze";

    // Visual feedback while the request is in flight
    btn.textContent = "Analyzing…";
    btn.disabled = true;

    try {
      const response = await fetch(BACKEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mockCarData),
      });

      if (!response.ok) {
        throw new Error(`Backend returned HTTP ${response.status}`);
      }

      const result = await response.json();
      console.log("[CarLens] Backend response:", result);

      // Show a brief summary in the badge
      badge.textContent = `CarLens: ${result.verdict ?? "See console"}`;
    } catch (err) {
      console.error("[CarLens] Error contacting backend:", err);
      badge.textContent = "CarLens: Error (see console)";
    } finally {
      btn.textContent = "Analyze Listing";
      btn.disabled = false;
    }
  }

  btn.addEventListener("click", analyzeListing);
})();
