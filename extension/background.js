// background.js
// Service worker for the CarLens extension (Manifest V3).
// Acts as the extension's event hub; currently a minimal scaffold.

chrome.runtime.onInstalled.addListener(() => {
  console.log("[CarLens] Extension installed / updated.");
});

// Example: listen for messages forwarded from content.js if needed later.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CARLENS_LOG") {
    console.log("[CarLens background] Message from content script:", message.payload);
    sendResponse({ status: "received" });
  }
  // Return true to keep the message channel open for async responses.
  return true;
});
