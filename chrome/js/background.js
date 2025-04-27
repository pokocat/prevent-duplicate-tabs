/* Prevent Duplicate Tabs – MV3 Service Worker
 * https://github.com/brcontainer/prevent-duplicate-tabs
 * Copyright (c) 2025 Guilherme Nascimento
 * Released under the MIT license
 *
 * Major Changes:
 * - Remove window dependency
 * - Use chrome.* API
 * - Fully utilize chrome.storage.local
 * origin from: https://github.com/your‑fork/prevent‑duplicate‑tabs
 */

'use strict';

/* ---------- Storage helpers ---------- */
const data = await storage.get(null);
const getStorage = async (key, fallback) => {
  const res = await storage.get(key);
  return res[key] !== undefined ? res[key] : fallback;
};
const setStorage = (key, value) => storage.set({ [key]: value });

/* ---------- Default configs ---------- */
const DEFAULT_CONFIGS = {
  turnoff: false,
  old: true,
  active: true,
  start: true,
  replace: true,
  update: true,
  create: true,
  attach: true,
  datachange: true,
  http: true,
  query: true,
  hash: false,
  incognito: false,
  windows: true,
  containers: true
};
const LEGACY_KEYS = Object.keys(DEFAULT_CONFIGS);

/* ---------- RegExps ---------- */
const isHttpRE      = /^https?:\/\/\w/i;
const isNewTabRE    = /^(about:blank|chrome:\/+?(newtab|startpageshared)\/?)$/i;
const removeHashRE  = /#[\s\S]+?$/;
const removeQueryRE = /\?[\s\S]+?$/;

/* ---------- State ---------- */
let configs  = { ...DEFAULT_CONFIGS };
let ignoreds = { urls: [], hosts: [] };
let timeout  = null;

/* ---------- Init ---------- */
(async function init() {
  try {
    await loadConfigs();
    await loadIgnored();

    /* -- First run check -- */
    setTimeout(checkTabs, 100, 'start');

    /* -- Event listeners (registered only after configs are ready) -- */
    chrome.tabs.onAttached.addListener(createEvent('attach', 500));
    chrome.tabs.onCreated .addListener(createEvent('create', 10));
    chrome.tabs.onReplaced.addListener(createEvent('replace', 10));
    chrome.tabs.onUpdated .addListener(createEvent('update', 10));

    chrome.tabs.onActivated.addListener(({ tabId }) => toggleIgnoreIcon(tabId));

    chrome.runtime.onMessage.addListener(onMessageHandler);
  } catch (e) {
    console.error('[PDT] init error', e);
  }
})();

/* ---------- Helpers ---------- */
function isDisabled() {
  return configs.turnoff || (
    !configs.start     &&
    !configs.replace   &&
    !configs.update    &&
    !configs.create    &&
    !configs.attach    &&
    !configs.datachange
  );
}

async function safeRemove(id) {
  try { await chrome.tabs.remove(id); }
  catch (e) { /* tab already closed – ignore */ }
}

/* ---------- Duplicate‑tab logic ---------- */
function createEvent(type, delay) {
  return tab => {
    setTimeout(checkTabs, delay, type);
    setTimeout(toggleIgnoreIcon, 100, tab.id || tab.tabId || tab, tab.url);
  };
}

async function checkTabs(trigger) {
  if (configs[trigger] === false || isDisabled()) return;
  const query = configs.windows ? { lastFocusedWindow: true } : {};
  const tabs  = await chrome.tabs.query(query);
  groupAndClose(tabs);
}

function groupAndClose(tabs) {
  const groups = {};
  const onlyHttp       = configs.http;
  const ignoreHash     = !configs.hash;
  const ignoreQuery    = !configs.query;
  const ignoreIncog    = !configs.incognito;
  const diffWindows    = configs.windows;
  const diffContainers = configs.containers;

  for (const tab of tabs) {
    let url = tab.url || '';

    if (
      tab.pinned ||
      url === '' ||
      isNewTabRE.test(url) ||
      (ignoreIncog && tab.incognito) ||
      (onlyHttp && !isHttpRE.test(url)) ||
      isIgnored(url)
    ) continue;

    if (ignoreHash)  url = url.replace(removeHashRE, '');
    if (ignoreQuery) url = url.replace(removeQueryRE, '');

    let prefix = 'normal';
    if (tab.incognito) prefix = 'incognito';
    else if (diffContainers && tab.cookieStoreId) prefix = String(tab.cookieStoreId);

    const key = diffWindows ? `${prefix}::${tab.windowId}::${url}`
                            : `${prefix}::${url}`;

    (groups[key] ||= []).push({ id: tab.id, active: tab.active });
  }

  for (const key in groups) closeDuplicates(groups[key]);
}

function closeDuplicates(tabs) {
  if (tabs.length < 2) return;
  tabs.sort(sortTabs);
  for (let i = 1; i < tabs.length; i++) safeRemove(tabs[i].id);
}

function sortTabs(a, b) {
  if (configs.active && (a.active || b.active)) return a.active ? -1 : 1;
  return (configs.old && a.id < b.id) ? 1 : -1;
}

/* ---------- Ignore list & icon ---------- */
function isIgnored(url) {
  return ignoreds.urls.includes(url) || ignoreds.hosts.includes(new URL(url).host);
}

async function loadIgnored() {
  ignoreds.urls  = await getStorage('urls', []);
  ignoreds.hosts = await getStorage('hosts', []);
}

function toggleIgnoreIcon(tabId, url) {
  if (!url) {
    chrome.tabs.get(tabId, t => {
      const u = t?.url || t?.pendingUrl;
      setTimeout(toggleIgnoreIcon, u ? 0 : 500, tabId, u);
    });
    return;
  }

  const path = (isDisabled() || isIgnored(url))
    ? '/images/disabled.png'
    : '/images/icon.png';

  chrome.action.setIcon({ tabId, path }).catch(() => {});
}

async function updateCurrentIcon() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) toggleIgnoreIcon(tab.id, tab.url);
}

/* ---------- Message handler ---------- */
function onMessageHandler(request, sender, sendResponse) {
  (async () => {
    /* toggle ignore (URL or host) */
    if (request.ignore !== undefined) {
      await toggleIgnoreData(request.type, request.ignore, request.value);
      toggleIgnoreIcon(request.tabId, request.url);
      sendResponse(true);

    /* toggle setup option */
    } else if (request.setup !== undefined) {
      configs[request.setup] = !!request.enable;
      await setStorage(request.setup, !!request.enable);
      await updateCurrentIcon();
      sendResponse(true);

    /* save extra data:key */
    } else if (request.data) {
      await setStorage(`data:${request.data}`, request.value);
      sendResponse(true);

    /* request extra list */
    } else if (request.extra) {
      const all = await storage.get(null);
      const data = Object.entries(all)
        .filter(([k]) => k.startsWith('data:'))
        .map(([k, v]) => ({ id: k.slice(5), value: v }));
      sendResponse(data);

    /* configs snapshot */
    } else if (request.configs) {
      sendResponse(configs);

    /* ignored list snapshot */
    } else if (request.ignored) {
      sendResponse(ignoreds);
    }

    /* trigger datachange scan */
    if ((request.setup !== undefined) || (request.ignore !== undefined)) {
      if (configs.datachange) setTimeout(checkTabs, 10, 'datachange');
    }
  })().catch(err => console.error('[PDT] message error', err));

  /* Keep the port open for async sendResponse */
  return true;
}

/* ---------- Config loader ---------- */
async function loadConfigs() {
  const stored = await storage.get(null);

  /* First install: write defaults */
  if (Object.keys(stored).length === 0) {
    await storage.set(DEFAULT_CONFIGS);
    configs = { ...DEFAULT_CONFIGS };
  } else {
    configs = { ...DEFAULT_CONFIGS, ...pick(stored, LEGACY_KEYS) };
  }
}

/* ---------- Ignore list toggle ---------- */
async function toggleIgnoreData(type, ignore, value) {
  if (value === undefined) return;
  const key = `${type}s`;
  const list = await getStorage(key, []);

  const idx = list.indexOf(value);
  if (ignore && idx === -1)        list.push(value);
  else if (!ignore && idx !== -1)  list.splice(idx, 1);
  else return;

  ignoreds[key] = list;
  await setStorage(key, list);
}

/* ---------- util ---------- */
const pick = (obj, keys) => {
  const out = {};
  keys.forEach(k => { if (k in obj) out[k] = obj[k]; });
  return out;
};
