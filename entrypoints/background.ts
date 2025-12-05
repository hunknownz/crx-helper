export default defineBackground(() => {
  // Click the extension icon to capture the current page
  chrome.action.onClicked.addListener(async (tab) => {
    if (!tab.id) return;
    console.log("[crx-helper/bg] action.onClicked on tab", tab.id, tab.url);
    try {
      // Open the in-page toolbox so user can choose an action
      await chrome.tabs.sendMessage(tab.id, { type: "OPEN_TOOLBOX" });
      console.log("[crx-helper/bg] OPEN_TOOLBOX sent to tab", tab.id);
    } catch (err) {
      // If content script isn't injected/matching, ignore
      console.warn("[crx-helper/bg] OPEN_TOOLBOX sendMessage failed:", err);
    }
  });

  // Optional: receive captured HTML for logging/diagnostics
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (!msg || typeof msg !== "object") return;
    if (msg?.type === "PAGE_HTML") {
      const url = msg?.meta?.url ?? sender.tab?.url;
      console.log("[crx-helper/bg] Captured HTML:", {
        url,
        title: msg?.meta?.title,
        length: msg?.html?.length ?? 0,
        tabId: sender.tab?.id,
      });
    }
    if (msg?.type === "ANALYSIS_DONE") {
      console.log("[crx-helper/bg] Analysis export complete:", {
        url: msg?.meta?.url,
        analysisBytes: msg?.meta?.analysisBytes,
        htmlBytes: msg?.meta?.htmlBytes,
      });
    }
    if (msg?.type === "DOWNLOAD_FILE") {
      const { filename, data, mime } = msg as { filename: string; data: string; mime?: string };
      console.log("[crx-helper/bg] DOWNLOAD_FILE request", {
        fromTab: sender.tab?.id,
        filename,
        mime,
        size: typeof data === "string" ? data.length : undefined,
      });
      try {
        // Use data URL for robust MV3 worker compatibility
        const safeMime = mime || "application/octet-stream";
        const dataUrl = `data:${safeMime},${encodeURIComponent(data)}`;
        chrome.downloads.download({ url: dataUrl, filename, saveAs: true }, (downloadId) => {
          if (chrome.runtime.lastError) {
            console.warn("[crx-helper/bg] downloads.download failed:", chrome.runtime.lastError.message);
            return;
          }
          console.log("[crx-helper/bg] downloads.download ok", downloadId);
        });
      } catch (e) {
        console.warn("[crx-helper/bg] DOWNLOAD_FILE error", e);
      }
    }
  });
});
