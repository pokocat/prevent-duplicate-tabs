/* store.js  ────────────────────────────────────────────────
   Flat-key storage helpers with manual sync clone
----------------------------------------------------------- */

const local = chrome.storage.local;
const sync = chrome.storage.sync;

/* Read all keys from local */
export async function snapshotLocal() {
    return await local.get(null);
}

/* Overwrite local with given object */
export async function restoreToLocal(obj) {
    await local.clear();
    await local.set(obj);
}

/* Push local → sync (manual) */
export async function pushToSync() {
    try {
        const data = await snapshotLocal();
        await sync.set(data);
        return true;
    } catch (e) {
        console.warn('[store] sync quota exceeded', e);
        return false;
    }
}

/* Pull sync → local if sync contains data */
export async function pullFromSync() {
    if (!sync) return false;                    // sync not available
    const cloud = await sync.get(null);
    if (!Object.keys(cloud).length) return false;
    await restoreToLocal(cloud);
    return true;
}
