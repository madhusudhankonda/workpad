const MAX_CAPTURE_LENGTH = 50_000;

function limit(value: string | undefined): string {
  return (value ?? "").slice(0, MAX_CAPTURE_LENGTH);
}

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "save-selection",
      title: "Save selection to Workpad",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({ id: "save-page-link", title: "Save page link to Workpad", contexts: ["page"] });
    chrome.contextMenus.create({ id: "open-workpad", title: "Open Workpad", contexts: ["page", "selection"] });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "open-workpad") {
    if (tab?.windowId) chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
    return;
  }
  if (info.menuItemId === "save-selection" || info.menuItemId === "save-page-link") {
    chrome.storage.local
      .set({
        pendingCapture: {
          kind: info.menuItemId,
          selection: limit(info.selectionText),
          url: limit(info.pageUrl ?? tab?.url),
          title: limit(tab?.title ?? "Untitled page"),
          capturedAt: new Date().toISOString()
        }
      })
      .then(() => {
        if (tab?.windowId) return chrome.sidePanel.open({ windowId: tab.windowId });
      })
      .catch(console.error);
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "open-workpad") chrome.windows.getLastFocused().then((window) => {
    if (window.id) chrome.sidePanel.open({ windowId: window.id }).catch(console.error);
  });
  else chrome.storage.local.set({ pendingCommand: command }).catch(console.error);
});
