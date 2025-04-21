/* Prevent Duplicate Tabs – MV3 Service Worker
 * https://github.com/brcontainer/prevent-duplicate-tabs
 * Copyright (c) 2025 Guilherme Nascimento
 * Released under the MIT license
 *
 * Major Changes:
 * - Remove window dependency
 * - Use chrome.* API
 * - Fully utilize chrome.storage.local
 */

'use strict';

/* ---------- Utils ---------- */
const storage = chrome.storage.local;

// Promise-based read/write
const getStorage = async (key, fallback) => {
  const res = await storage.get(key);
  return res[key] !== undefined ? res[key] : fallback;
};
const setStorage = (key, value) => storage.set({ [key]: value });

/* ---------- Default Configurations ---------- */
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

const LEGACY_CONFIG_KEYS = Object.keys(DEFAULT_CONFIGS);

/* ---------- Regular Expressions & Variables ---------- */
const isHttpRE     = /^https?:\/\/\w/i;
const isNewTabRE   = /^(about:blank|chrome:\/+?(newtab|startpageshared)\/?)$/i;
const removeHashRE = /#[\s\S]+?$/;
const removeQueryRE = /\?[\s\S]+?$/;

let configs   = { ...DEFAULT_CONFIGS };
let ignoreds  = { urls: [], hosts: [] };
let timeoutId = null;

/* ---------- Main Process Entry ---------- */
(async function init() {
  await loadConfigs();
  await loadIgnored();

  // Immediate self-check on first launch
  setTimeout(checkTabs, 100, 'start');

  /* ------ Event Listeners ------ */
  chrome.tabs.onAttached.addListener(createEvent('attach', 500));
  chrome.tabs.onCreated .addListener(createEvent('create', 10));
  chrome.tabs.onReplaced.addListener(createEvent('replace', 10));
  chrome.tabs.onUpdated .addListener(createEvent('update', 10));

  chrome.tabs.onActivated.addListener(({ tabId }) => toggleIgnoreIcon(tabId));

  chrome.runtime.onMessage.addListener(onRuntimeMessage);
})();

/* ---------- Core Functions ---------- */
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
  const group = {};
  const onlyHttp        = configs.http;
  const ignoreHash      = !configs.hash;
  const ignoreQuery     = !configs.query;
  const ignoreIncog     = !configs.incognito;
  const diffWindows     = configs.windows;
  const diffContainers  = configs.containers;

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

    let prefix;
    if (tab.incognito)               prefix = 'incognito';
    else if (diffContainers && tab.cookieStoreId) prefix = String(tab.cookieStoreId);
    else                              prefix = 'normal';

    const key = diffWindows ? `${prefix}::${tab.windowId}::${url}`
                            : `${prefix}::${url}`;

    (group[key] ||= []).push({ id: tab.id, active: tab.active });
  }

  for (const key in group) closeDuplicates(group[key]);
}

function closeDuplicates(tabs) {
  if (tabs.length < 2) return;
  tabs.sort(sortTabs);           // Original logic: active first / old later
  for (let i = 1; i < tabs.length; i++) {
    chrome.tabs.remove(tabs[i].id);
  }
}

function sortTabs(a, b) {
  if (configs.active && (a.active || b.active)) return a.active ? -1 : 1;
  return configs.old && a.id < b.id ? 1 : -1;
}

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

/* ---------- Ignore Logic & Icon ---------- */
function isIgnored(url) {
  return ignoreds.urls.includes(url) || ignoreds.hosts.includes(new URL(url).host);
}

async function loadIgnored() {
  ignoreds.urls  = await getStorage('urls',  []);
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

  const iconPath = isDisabled() || isIgnored(url)
    ? '/images/disabled.png'
    : '/images/icon.png';

  chrome.action.setIcon({ tabId, path: iconPath });
}

function updateCurrentIcon(tabs) {
  if (tabs?.[0]) toggleIgnoreIcon(tabs[0].id, tabs[0].url);
}

/* ---------- Message Processing ---------- */
async function onRuntimeMessage(request, sender, sendResponse) {
  if (request.ignore !== undefined) {
    toggleIgnoreData(request.type, request.ignore, request.value);
    toggleIgnoreIcon(request.tabId, request.url);
  } else if (request.setup) {
    configs[request.setup] = request.enable;
    await setStorage(request.setup, request.enable);
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    updateCurrentIcon(tabs);
  } else if (request.data) {
    await setStorage(`data:${request.data}`, request.value);
  } else if (request.extra) {
    const all = await storage.get(null);
    const data = Object.entries(all)
                       .filter(([k]) => k.startsWith('data:'))
                       .map(([k, v]) => ({ id: k.slice(5), value: v }));
    sendResponse(data);
  } else if (request.configs) {
    sendResponse(await loadConfigs());
  } else if (request.ignored) {
    sendResponse(ignoreds);
  }

  if ((request.setup !== undefined) || (request.ignore !== undefined)) {
    if (configs.datachange) setTimeout(checkTabs, 10, 'datachange');
  }

  return true; // 表示异步 sendResponse
}

/* ---------- Configuration & Data ---------- */
async function loadConfigs() {
  const stored = await storage.get(null);

  // First installation: write default values
  if (Object.keys(stored).length === 0) {
    await storage.set(DEFAULT_CONFIGS);
    configs = { ...DEFAULT_CONFIGS };
  } else {
    configs = { ...DEFAULT_CONFIGS, ...pick(stored, LEGACY_CONFIG_KEYS) };
  }
  return configs;
}

async function toggleIgnoreData(type, ignore, value) {
  const key = `${type}s`;
  const list = await getStorage(key, []);

  const idx = list.indexOf(value);
  if (ignore && idx === -1)        list.push(value);
  else if (!ignore && idx !== -1)  list.splice(idx, 1);
  else return;                     // No change

  ignoreds[key] = list;
  await setStorage(key, list);
}

/* ---------- Utility Functions ---------- */
function pick(obj, keys) {
  const out = {};
  keys.forEach(k => { if (k in obj) out[k] = obj[k]; });
  return out;
}
