/*************************************************************************
 * storage.js – local ⇆ sync bridge  (by extension-ID single key)
 *************************************************************************/
const local = chrome.storage.local;
const sync = chrome.storage.sync;
const KEY = chrome.runtime.id;              // 顶层键 = 扩展 ID

/* ---------- util ---------- */
const now = () => Date.now();
const incVersion = v => (typeof v === 'number' ? v + 1 : 1);
export const snapshotLocal = () => local.get(null);

/* ---------- 启动：云端较新则落地 ---------- */
(async () => {
    const cloud = (await sync.get(KEY))[KEY];
    if (await cloudNewerThanLocal(cloud)) await restoreToLocal(cloud);
})();

/* ---------- 云端 → local 实时镜像 ---------- */
chrome.storage.onChanged.addListener(({ [KEY]: ch }, area) => {
    if (area !== 'sync' || !ch || !ch.newValue) return;
    restoreToLocal(ch.newValue);
});

/* ---------- helpers ---------- */
async function cloudNewerThanLocal(cloud) {
    if (!cloud) return false;
    const { mtime: lm = 0 } = await local.get('mtime');
    return (cloud.mtime || 0) > lm;
}
export async function restoreToLocal(obj) {
    await local.clear();      // 保证完全一致
    await local.set(obj);
}

/* ---------- 手动上传 / 下载 ---------- */
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