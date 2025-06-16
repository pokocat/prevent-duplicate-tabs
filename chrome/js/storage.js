/*************************************************************************
 * storage.js – local ⇆ sync bridge  (by extension-ID single key)
 *************************************************************************/
const local = chrome.storage.local;
const sync = chrome.storage.sync;
const KEY = chrome.runtime.id;

const now = () => Date.now();
const incVersion = v => (typeof v === 'number' ? v + 1 : 1);
export const snapshotLocal = () => local.get(null);

(async () => {
    const cloud = (await sync.get(KEY))[KEY];
    if (await cloudNewerThanLocal(cloud)) await restoreToLocal(cloud);
})();

chrome.storage.onChanged.addListener(({ [KEY]: ch }, area) => {
    if (area !== 'sync' || !ch || !ch.newValue) return;
    restoreToLocal(ch.newValue);
});

async function cloudNewerThanLocal(cloud) {
    if (!cloud) return false;
    const { mtime: lm = 0 } = await local.get('mtime');
    return (cloud.mtime || 0) > lm;
}
export async function restoreToLocal(obj) {
    await local.clear();
    await local.set(obj);
}

export async function pushToSync() {
    const data = await snapshotLocal();
    data.version = incVersion(data.version);
    data.mtime = now();
    await sync.set({ [KEY]: data });
    return true;
}

export async function pullFromSync(force = false) {
    const cloud = (await sync.get(KEY))[KEY];
    if (!cloud) return false;
    if (!force && !(await cloudNewerThanLocal(cloud))) return 'same';
    await restoreToLocal(cloud);
    return true;
}
