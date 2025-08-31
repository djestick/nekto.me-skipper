// MV3 service worker: manage badge and default settings

const STORAGE_KEY = 'autoskip_enabled';

async function getEnabled() {
  const data = await chrome.storage.local.get({ [STORAGE_KEY]: true });
  return Boolean(data[STORAGE_KEY]);
}

async function setBadge(enabled) {
  try {
    await chrome.action.setBadgeText({ text: enabled ? 'ON' : '' });
    await chrome.action.setBadgeBackgroundColor({ color: enabled ? '#16a34a' : '#9ca3af' });
    await chrome.action.setTitle({ title: `Auto Skipper: ${enabled ? 'ON' : 'OFF'}` });
  } catch (e) {
    // no-op in older Chromium variants
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  // Initialize default if not set
  const current = await chrome.storage.local.get(STORAGE_KEY);
  if (!(STORAGE_KEY in current)) {
    await chrome.storage.local.set({ [STORAGE_KEY]: true });
  }
  const enabled = await getEnabled();
  await setBadge(enabled);
});

chrome.runtime.onStartup?.addListener(async () => {
  const enabled = await getEnabled();
  await setBadge(enabled);
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (STORAGE_KEY in changes) {
    const enabled = Boolean(changes[STORAGE_KEY].newValue);
    await setBadge(enabled);
  }
});

