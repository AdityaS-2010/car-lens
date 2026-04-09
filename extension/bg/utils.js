// bg/utils.js — Shared utility functions for the background service worker.

function waitForTabLoad(tabId, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Tab load timeout"));
    }, timeout);

    function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);

    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }).catch(() => {});
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeCloseTab(tabId) {
  try {
    await chrome.tabs.remove(tabId);
  } catch (e) {
    // Tab may already be closed
  }
}
