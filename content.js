(() => {
  const SELECTOR = "button.btn.btn-lg.go-scan-button";
  const STORAGE_KEY = 'autoskip_enabled';
  const UA_STORAGE_KEY = 'ua_enabled';
  const UKR_URL = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
    ? chrome.runtime.getURL('ukrainizator.json')
    : null;
  let lastClick = 0;
  let enabled = true;
  let observer = null;
  let intervalId = null;
  let uaEnabled = false;
  let uaObserver = null;
  const uaOrigTextNodes = new WeakMap();
  let uaMap = [];

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      parseFloat(style.opacity || "1") > 0 &&
      el.offsetParent !== null
    );
  }

  function clickIfReady(btn) {
    if (!btn) return false;
    if (btn.dataset.autoskipClicked === "1") return false;
    if (btn.disabled) return false;
    if (!isVisible(btn)) return false;

    const now = Date.now();
    if (now - lastClick < 1000) return false; // throttle

    setTimeout(() => {
      if (!document.contains(btn)) return;
      if (btn.disabled || !isVisible(btn)) return;

      btn.dataset.autoskipClicked = "1";
      btn.click();
      lastClick = Date.now();
      console.log("[AutoSkipper] Clicked", btn);
    }, 250);

    return true;
  }

  function scan() {
    if (!enabled) return;
    const btn = document.querySelector(SELECTOR);
    if (btn) clickIfReady(btn);
  }

  function ensureObserver() {
    if (observer) return;
    observer = new MutationObserver((mutations) => {
      if (!enabled) return;
      for (const m of mutations) {
        if (m.type === "childList") {
          for (const node of m.addedNodes) {
            if (!(node instanceof HTMLElement)) continue;
            if (node.matches && node.matches(SELECTOR)) {
              clickIfReady(node);
            } else {
              const inner = node.querySelector && node.querySelector(SELECTOR);
              if (inner) clickIfReady(inner);
            }
          }
        } else if (m.type === "attributes") {
          const target = m.target;
          if (target instanceof HTMLElement && target.matches(SELECTOR)) {
            clickIfReady(target);
          }
        }
      }
    });
  }

  function start() {
    if (intervalId || observer) stop();
    ensureObserver();
    try {
      observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style", "disabled", "hidden", "aria-hidden"],
      });
    } catch {}
    scan();
    intervalId = setInterval(scan, 2000);
    console.log("[AutoSkipper] Enabled. Watching for", SELECTOR);
  }

  function stop() {
    try { observer && observer.disconnect(); } catch {}
    observer = null;
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
    console.log("[AutoSkipper] Disabled");
  }

  async function readEnabled() {
    try {
      const data = await chrome.storage?.local?.get?.({ [STORAGE_KEY]: true });
      return Boolean(data?.[STORAGE_KEY] ?? true);
    } catch {
      return true;
    }
  }

  async function applyState(newState) {
    enabled = !!newState;
    if (enabled) start(); else stop();
  }

  // Listen to storage changes and direct messages from popup
  try {
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area !== 'local') return;
      if ('autoskip_enabled' in changes) {
        applyState(Boolean(changes.autoskip_enabled.newValue));
      }
      if ('ua_enabled' in changes) {
        applyUa(Boolean(changes.ua_enabled.newValue));
      }
    });
  } catch {}

  try {
    chrome.runtime?.onMessage?.addListener((msg) => {
      if (msg && msg.type === 'AUTOSKIP_TOGGLE') {
        applyState(!!msg.enabled);
      }
      if (msg && msg.type === 'UA_TOGGLE') {
        applyUa(!!msg.enabled);
      }
    });
  } catch {}

  // UA translator
  // (legacy UA rules removed)

  // ===== Ukrainizator: simple RU->UA block/text replacement =====
  const TAG_EXCLUDE = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE'];
  const BLOCK_TAGS = new Set(['DIV','P','SECTION','ARTICLE','MAIN','ASIDE','HEADER','FOOTER','SPAN']);

  function normalize(str) {
    return String(str || '')
      .replace(/[\u2010-\u2015]/g, '-') // dashes to hyphen
      .replace(/[\u201C\u201D\u2033]/g, '"') // curly/prime quotes to straight quote
      .replace(/\s+/g, ' ') // collapse whitespace
      .trim();
  }

  async function ensureUkrLoaded() {
    if (uaMap && uaMap.length) return;
    try {
      const fromStorage = await chrome.storage?.local?.get?.({ ukrainizator: null });
      if (fromStorage?.ukrainizator && Array.isArray(fromStorage.ukrainizator)) {
        uaMap = fromStorage.ukrainizator;
      }
    } catch {}
    if (!uaMap || !uaMap.length) {
      try {
        if (UKR_URL) {
          const res = await fetch(UKR_URL);
          if (res.ok) uaMap = await res.json();
        }
      } catch {}
    }
    uaMap = (uaMap || []).map(r => {
      const mode = (r.mode === 'contains' || r.mode === 'regex') ? r.mode : 'equals';
      let re = null;
      if (mode === 'regex') {
        try { re = new RegExp(r.ru, r.flags || 'g'); } catch {}
      }
      return {
        ru: r.ru || '',
        ua: r.ua || '',
        mode,
        ruNorm: normalize(r.ru || ''),
        uaOut: r.ua || '',
        re,
        flags: r.flags || 'g'
      };
    });
  }

  function replaceTextNodeIfMatches(node) {
    const text = node.nodeValue;
    if (!text || !text.trim()) return;
    const norm = normalize(text);
    for (const r of uaMap) {
      if (r.mode === 'equals' && norm === r.ruNorm) {
        if (!uaOrigTextNodes.has(node)) uaOrigTextNodes.set(node, text);
        node.nodeValue = r.uaOut;
        return; // one match per node
      }
      if (r.mode === 'contains' && norm.includes(r.ruNorm)) {
        if (!uaOrigTextNodes.has(node)) uaOrigTextNodes.set(node, text);
        // best effort: simple replace in original string
        node.nodeValue = text.replace(new RegExp(r.ru.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), r.uaOut);
        return;
      }
      if (r.mode === 'regex' && r.re) {
        const replaced = text.replace(r.re, r.uaOut);
        if (replaced !== text) {
          if (!uaOrigTextNodes.has(node)) uaOrigTextNodes.set(node, text);
          node.nodeValue = replaced;
          return;
        }
      }
    }
  }

  function walkAndApplyText(root) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const p = n.parentElement; if (!p) return NodeFilter.FILTER_REJECT;
        if (TAG_EXCLUDE.includes(p.tagName)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node; while ((node = tw.nextNode())) replaceTextNodeIfMatches(node);
  }

  function walkAndApplyBlocks(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (el) => TAG_EXCLUDE.includes(el.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    let el;
    while ((el = walker.nextNode())) {
      if (!BLOCK_TAGS.has(el.tagName)) continue;
      const inner = el.innerText ? normalize(el.innerText) : '';
      if (!inner) continue;
      for (const r of uaMap) {
        if (r.mode === 'equals' && inner === r.ruNorm) {
          el.setAttribute('data-ua-block-orig', el.textContent || '');
          el.textContent = r.uaOut;
          break;
        }
      }
    }
  }

  // (legacy restore helpers removed)

  function startUaObserver() {
    if (uaObserver) return;
    let scheduled = false;
    uaObserver = new MutationObserver(() => {
      if (!uaEnabled) return;
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        try { walkAndApplyText(document.body); walkAndApplyBlocks(document.body); } catch {}
      }, 100);
    });
    try { uaObserver.observe(document.documentElement || document.body, { childList: true, subtree: true }); } catch {}
  }

  function stopUaObserver() {
    try { uaObserver && uaObserver.disconnect(); } catch {}
    uaObserver = null;
  }

  async function applyUa(state) {
    uaEnabled = !!state;
    if (uaEnabled) {
      try { await ensureUkrLoaded(); walkAndApplyText(document.body); walkAndApplyBlocks(document.body); } catch {}
      startUaObserver();
      console.log('[UA] Enabled');
    } else {
      stopUaObserver();
      try {
        // restore text nodes
        const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let n; while ((n = tw.nextNode())) {
          if (uaOrigTextNodes.has(n)) { n.nodeValue = uaOrigTextNodes.get(n); uaOrigTextNodes.delete(n); }
        }
        // restore block elements
        document.querySelectorAll('[data-ua-block-orig]').forEach((el) => {
          el.textContent = el.getAttribute('data-ua-block-orig');
          el.removeAttribute('data-ua-block-orig');
        });
      } catch {}
      console.log('[UA] Disabled');
    }
  }
  // remove old advanced Ukrainizer/custom-rules logic; keep only simple mapping

  async function init() {
    try {
      const data = await chrome.storage?.local?.get?.({ [STORAGE_KEY]: true, [UA_STORAGE_KEY]: false });
      await applyState(Boolean(data?.[STORAGE_KEY] ?? true));
      await applyUa(Boolean(data?.[UA_STORAGE_KEY] ?? false));
    } catch {
      await applyState(true);
      await applyUa(false);
    }
    window.addEventListener("beforeunload", () => stop());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
