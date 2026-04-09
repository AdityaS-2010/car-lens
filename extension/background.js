// background.js — Service worker entry point (Manifest V3).
// Thin message router. All logic lives in bg/ modules.

importScripts("bg/utils.js", "bg/report.js", "bg/comps.js");

chrome.runtime.onInstalled.addListener(() => {
  console.log("[CarLens] Extension installed / updated.");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
    handleFetchComparablePrices(message.make, message.model, message.year, message.location, message.price, message.mileage)
      .then((result) => sendResponse(result))
      .catch((err) => {
        console.warn("[CarLens Comps] Error:", err.message);
        sendResponse(null);
      });
    return true;
  }
});
