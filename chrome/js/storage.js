/* storage.js – auto-sync until quota hit                      */
/* if a write fails due to QUOTA_BYTES, fallback to local      */
const syncArea = chrome.storage.sync;
const localArea = chrome.storage.local;

/* choose preferred area */
function area() { return syncArea ? syncArea : localArea; }

/* ----- API ----- */
export async function getAll() {
    return await area().get(null);
}

export async function setAll(obj) {
    try {
        await area().set(obj);                 // try sync first
    } catch (e) {                            // quota or other error
        console.warn('[PDT] sync quota hit – falling back to local', e);
        await localArea.set(obj);
    }
}

export async function getKey(key, fallback) {
    const res = await area().get(key);
    return res[key] !== undefined ? res[key] : fallback;
}

export async function setKey(key, val) {
    try {
        await area().set({ [key]: val });
    } catch (e) {
        await localArea.set({ [key]: val });
    }
}
