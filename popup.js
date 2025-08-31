const STORAGE_KEYS = {
  autoskip: 'autoskip_enabled',
  ua: 'ua_enabled',
};

async function getEnabled(key, defVal) {
  const data = await chrome.storage.local.get({ [key]: defVal });
  return Boolean(data[key]);
}

async function setEnabled(key, value) {
  await chrome.storage.local.set({ [key]: Boolean(value) });
}

function setUIAuto(on) {
  const toggle = document.getElementById('toggle');
  const hint = document.getElementById('stateHint');
  if (toggle) toggle.checked = !!on;
  if (hint) hint.textContent = on ? 'Увімкнено' : 'Вимкнено';
}

function setUIUa(on) {
  const toggle = document.getElementById('toggleUa');
  const hint = document.getElementById('uaHint');
  if (toggle) toggle.checked = !!on;
  if (hint) hint.textContent = on ? 'Увімкнено' : 'Вимкнено';
}

document.addEventListener('DOMContentLoaded', async () => {
  const [autoInit, uaInit] = await Promise.all([
    getEnabled(STORAGE_KEYS.autoskip, true),
    getEnabled(STORAGE_KEYS.ua, false),
  ]);

  setUIAuto(autoInit);
  setUIUa(uaInit);

  const toggle = document.getElementById('toggle');
  toggle?.addEventListener('change', async (e) => {
    const on = e.target.checked;
    setUIAuto(on);
    await setEnabled(STORAGE_KEYS.autoskip, on);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'AUTOSKIP_TOGGLE', enabled: on });
    } catch {}
  });

  const toggleUa = document.getElementById('toggleUa');
  toggleUa?.addEventListener('change', async (e) => {
    const on = e.target.checked;
    setUIUa(on);
    await setEnabled(STORAGE_KEYS.ua, on);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'UA_TOGGLE', enabled: on });
    } catch {}
  });
});
