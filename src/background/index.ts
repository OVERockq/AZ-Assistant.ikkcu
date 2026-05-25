const PANEL_PATH = "src/sidepanel/index.html";
const ACTIVE_TAB_KEY = "activeSidePanelTabId";
const LAST_FOCUSED_TAB_KEY = "lastFocusedTabId";

const getActivePanelTabId = async (): Promise<number | null> => {
  const result = await chrome.storage.session.get(ACTIVE_TAB_KEY);
  return typeof result[ACTIVE_TAB_KEY] === "number" ? result[ACTIVE_TAB_KEY] : null;
};

const setActivePanelTabId = async (tabId: number | null): Promise<void> => {
  await chrome.storage.session.set({ [ACTIVE_TAB_KEY]: tabId });
};

const setLastFocusedTabId = async (tabId: number | null): Promise<void> => {
  await chrome.storage.session.set({ [LAST_FOCUSED_TAB_KEY]: tabId });
};

const disablePanelForTab = async (tabId: number | null): Promise<void> => {
  if (typeof tabId !== "number") return;
  await chrome.sidePanel.setOptions({ tabId, enabled: false }).catch(() => undefined);
};

const preparePanelForTab = async (tabId: number): Promise<void> => {
  await chrome.sidePanel.setOptions({
    tabId,
    path: PANEL_PATH,
    enabled: true
  });
};

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => undefined);
  await chrome.sidePanel.setOptions({ enabled: false }).catch(() => undefined);
  await setActivePanelTabId(null);
  await setLastFocusedTabId(null);
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => undefined);
  await chrome.sidePanel.setOptions({ enabled: false }).catch(() => undefined);
  await setActivePanelTabId(null);
  await setLastFocusedTabId(null);
});

const openPanelForTab = async (tabId: number): Promise<void> => {
  await chrome.sidePanel.open({ tabId });
};

const rememberActivePanelTab = async (tabId: number): Promise<void> => {
  const previousTabId = await getActivePanelTabId();
  await setActivePanelTabId(tabId);
  if (previousTabId !== tabId) {
    await disablePanelForTab(previousTabId);
  }
};

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;

  preparePanelForTab(tab.id)
    .then(() => openPanelForTab(tab.id!))
    .then(() => rememberActivePanelTab(tab.id!))
    .catch((error) => console.error("Failed to open side panel", error));
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const activeTabId = await getActivePanelTabId();
  if (activeTabId === tabId) {
    await setActivePanelTabId(null);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const result = await chrome.storage.session.get(LAST_FOCUSED_TAB_KEY);
  const previousFocusedTabId =
    typeof result[LAST_FOCUSED_TAB_KEY] === "number" ? result[LAST_FOCUSED_TAB_KEY] : null;
  const activePanelTabId = await getActivePanelTabId();

  if (previousFocusedTabId !== activePanelTabId) {
    await disablePanelForTab(previousFocusedTabId);
  }

  await preparePanelForTab(tabId).catch(() => undefined);
  await setLastFocusedTabId(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    await preparePanelForTab(tabId).catch(() => undefined);
  }
});
