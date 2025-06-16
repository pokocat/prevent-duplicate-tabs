/* background.js – MV3 service worker */
'use strict';

import {
  snapshotLocal,
  restoreToLocal,
  pushToSync,
  pullFromSync
} from './storage.js';

const storage = chrome.storage.local;

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

const isHttpRE = /^https?:\/\/\w/i;
const isNewTabRE = /^(about:blank|chrome:\/\/(?:newtab|startpageshared)\/?)/i;
const removeHashRE = /#[\s\S]+?$/;
const removeQueryRE = /\?[\s\S]+?$/;

let configs = { ...DEFAULT_CONFIGS };
let ignoreds = { urls: [], hosts: [] };

(async function init() {
  try {
    await pullFromSync();
    await loadConfigs();
    await loadIgnored();
    setTimeout(() => checkTabs('start'), 100);

    chrome.tabs.onAttached.addListener(createEvent('attach', 500));
    chrome.tabs.onCreated.addListener(createEvent('create', 10));
    chrome.tabs.onReplaced.addListener(createEvent('replace', 10));
    chrome.tabs.onUpdated.addListener(createEvent('update', 10));

    chrome.tabs.onActivated.addListener(({ tabId }) => toggleIgnoreIcon(tabId));
    chrome.runtime.onMessage.addListener(onMessageHandler);
  } catch (e) {
    console.error('[PDT] init error', e);
  }
})();

function isDisabled() {
  return configs.turnoff || (
    !configs.start &&
    !configs.replace &&
    !configs.update &&
    !configs.create &&
    !configs.attach &&
    !configs.datachange
  );
}

async function safeRemove(id) {
  try { await chrome.tabs.remove(id); } catch (_) {}
}

function createEvent(type, delay) {
  return tab => {
    setTimeout(() => checkTabs(type), delay);
    setTimeout(() => toggleIgnoreIcon(tab.id || tab.tabId || tab, tab.url), 100);
  };
}

async function checkTabs(trigger) {
  if (configs[trigger] === false || isDisabled()) return;
  const query = configs.windows ? { lastFocusedWindow: true } : {};
  const tabs = await chrome.tabs.query(query);
  groupAndClose(tabs);
}

function groupAndClose(tabs) {
  const groups = {};
  const onlyHttp = configs.http;
  const ignoreHash = !configs.hash;
  const ignoreQuery = !configs.query;
  const ignoreIncog = !configs.incognito;
  const diffWindows = configs.windows;
  const diffContainers = configs.containers;

  for (const tab of tabs) {
    let url = tab.url || '';

    if (
      tab.pinned || url === '' || isNewTabRE.test(url) ||
      (ignoreIncog && tab.incognito) ||
      (onlyHttp && !isHttpRE.test(url)) ||
      isIgnored(url)
    ) continue;

    if (ignoreHash) url = url.replace(removeHashRE, '');
    if (ignoreQuery) url = url.replace(removeQueryRE, '');

    let prefix = 'normal';
    if (tab.incognito) prefix = 'incognito';
    else if (diffContainers && tab.cookieStoreId) prefix = String(tab.cookieStoreId);

    const key = diffWindows ? `${prefix}::${tab.windowId}::${url}` : `${prefix}::${url}`;
    (groups[key] ||= []).push({ id: tab.id, active: tab.active });
  }

  for (const key in groups) closeDuplicates(groups[key]);
}

function closeDuplicates(tabs) {
  if (tabs.length < 2) return;
  tabs.sort((a, b) => {
    if (configs.active && (a.active || b.active)) return a.active ? -1 : 1;
    return configs.old && a.id < b.id ? 1 : -1;
  });
  for (let i = 1; i < tabs.length; i++) safeRemove(tabs[i].id);
}

function isIgnored(url) {
  try {
    return ignoreds.urls.includes(url) || ignoreds.hosts.includes(new URL(url).host);
  } catch {
    return false;
  }
}

async function loadIgnored() {
  ignoreds.urls = (await storage.get('urls')).urls || [];
  ignoreds.hosts = (await storage.get('hosts')).hosts || [];
}

function toggleIgnoreIcon(tabId, url) {
  if (!url) {
    chrome.tabs.get(tabId, t => {
      if (chrome.runtime.lastError || !t) return;
      const u = t.url || t.pendingUrl;
      setTimeout(() => toggleIgnoreIcon(tabId, u), u ? 0 : 500);
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

function onMessageHandler(request, sender, sendResponse) {
  (async () => {
    if (request.ignore !== undefined) {
      await toggleIgnoreData(request.type, request.ignore, request.value);
      toggleIgnoreIcon(request.tabId, request.url);
      sendResponse(true);
    } else if (request.setup !== undefined) {
      configs[request.setup] = !!request.enable;
      await storage.set({ [request.setup]: !!request.enable });
      await updateCurrentIcon();
      sendResponse(true);
    } else if (request.data) {
      await storage.set({ [`data:${request.data}`]: request.value });
      sendResponse(true);
    } else if (request.extra) {
      const all = await storage.get(null);
      const data = Object.entries(all)
        .filter(([k]) => k.startsWith('data:'))
        .map(([k, v]) => ({ id: k.slice(5), value: v }));
      sendResponse(data);
    } else if (request.configs) {
      sendResponse(configs);
    } else if (request.ignored) {
      sendResponse(ignoreds);
    }

    if ((request.setup !== undefined) || (request.ignore !== undefined)) {
      if (configs.datachange) setTimeout(() => checkTabs('datachange'), 10);
    }
  })().catch(err => console.error('[PDT] message error', err));
  return true;
}

async function loadConfigs() {
  const stored = await storage.get(null);
  configs = Object.keys(stored).length === 0
    ? { ...DEFAULT_CONFIGS }
    : { ...DEFAULT_CONFIGS, ...pick(stored, LEGACY_KEYS) };
}

async function toggleIgnoreData(type, ignore, value) {
  if (value === undefined) return;
  const key = `${type}s`;
  const list = (await storage.get(key))[key] || [];

  const idx = list.indexOf(value);
  if (ignore && idx === -1) list.push(value);
  else if (!ignore && idx !== -1) list.splice(idx, 1);
  else return;

  ignoreds[key] = list;
  await storage.set({ [key]: list });
}

function pick(obj, keys) {
  const out = {};
  keys.forEach(k => { if (k in obj) out[k] = obj[k]; });
  return out;
}
