// content/ui.js
// Overlay UI creation, rendering results, resize/drag handling.
// Exposes: createOverlay, renderResults, resetOverlay, getVerdictClass, makeCard

"use strict";

// ── Overlay Creation ────────────────────────────────────────────────

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
          <div class="carlens-step" data-step="comps">
            <div class="carlens-step-icon"><div class="carlens-step-spinner"></div></div>
            <span>Finding similar listings</span>
          </div>
          <div class="carlens-step" data-step="ai">
            <div class="carlens-step-icon"><div class="carlens-step-spinner"></div></div>
            <span>AI analyzing vehicle</span>
          </div>
        </div>
        <div class="carlens-game-container">
          <canvas id="carlens-game" width="380" height="100"></canvas>
          <div class="carlens-game-hint">W/S or Arrow Keys to dodge</div>
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

  // analyzeListing is defined in main.js — bind via deferred lookup
  document.getElementById("carlens-analyze-btn").addEventListener("click", () => {
    if (window._carlensAnalyze) window._carlensAnalyze();
  });

  // Mode toggle
  const modeButtons = overlay.querySelectorAll(".carlens-mode-btn");
  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      modeButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  // Draggable header
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

// ── Reset Overlay ───────────────────────────────────────────────────

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
  overlay.style.height = "";
  overlay.style.maxHeight = "";
}

// ── Verdict Badge Helper ────────────────────────────────────────────

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
    comps: "taxi.png",
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

  // Summary first
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

  // Comparable prices card — open by default
  if (data._comps && data._comps.count >= 2) {
    const c = data._comps;
    const tierLabel = c.tier > 1 ? ` <span style="color:#999;font-weight:400;">(${c.tier_label})</span>` : "";
    let compsBody = `<p class="carlens-summary">
      Found <strong>${c.count}</strong> similar listings${tierLabel}:<br/>
      Average: <strong>$${c.avg.toLocaleString()}</strong> &nbsp;|&nbsp;
      Range: $${c.min.toLocaleString()} &ndash; $${c.max.toLocaleString()}
    </p>`;
    if (c.listings && c.listings.length > 0) {
      compsBody += `<ul class="carlens-list carlens-intel-list">`;
      for (const l of c.listings.slice(0, 8)) {
        const yr = l.year || "";
        const mi = l.mileage ? ` / ${l.mileage.toLocaleString()} mi` : "";
        const link = l.url
          ? ` <a href="${l.url}" target="_blank" rel="noopener" class="carlens-comp-link">View</a>`
          : "";
        compsBody += `<li><strong>$${l.price.toLocaleString()}</strong> — ${yr}${mi}${link}</li>`;
      }
      compsBody += `</ul>`;
    }
    cardsHTML += makeCard("comps", "Price Comparison", compsBody, false, c.count);
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
