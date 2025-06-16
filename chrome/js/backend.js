/* backend.js – Data Manager + manual sync */

import {
    snapshotLocal,
    restoreToLocal,
    pushToSync,
    pullFromSync
} from './store.js';

/* ---------- DOM refs ---------- */
const $ = id => document.getElementById(id);
const jsonView = $('jsonView');
const refreshBtn = $('refresh');
const exportBtn = $('export');
const fileInput = $('fileInput');
const importBtn = $('import');
const syncSwitch = $('syncSwitch');
const syncNowBtn = $('syncNowBtn');
const syncMsg = $('syncMsg');

/* ---------- Helpers ---------- */
async function refreshJson() {
    const data = await snapshotLocal();
    jsonView.textContent = JSON.stringify(data, null, 2);

    /* update switch status */
    const enabled = (await snapshotLocal()).syncEnabled ?? true;
    syncSwitch.checked = enabled;
    syncMsg.style.display = enabled ? 'block' : 'none';
}

/* ---------- Initial load ---------- */
document.addEventListener('DOMContentLoaded', async () => {
    /* auto-pull once if local is empty */
    const localEmpty = !Object.keys(await snapshotLocal()).length;
    if (localEmpty) await pullFromSync();
    await refreshJson();
});

/* ---------- Buttons ---------- */
refreshBtn.addEventListener('click', refreshJson);

exportBtn.addEventListener('click', async () => {
    const blob = new Blob(
        [JSON.stringify(await snapshotLocal(), null, 2)],
        { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    chrome.downloads.download(
        { url, filename: 'duplicate-tab-settings.json', saveAs: true },
        () => URL.revokeObjectURL(url)
    );
});

importBtn.addEventListener('click', async () => {
    const file = fileInput.files?.[0];
    if (!file) return alert('请选择文件');
    try {
        const obj = JSON.parse(await file.text());
        await restoreToLocal(obj);
        await refreshJson();
        alert('已导入并覆盖本地配置');
    } catch (e) {
        console.error(e);
        alert('JSON 格式不正确');
    }
});

/* sync switch */
syncSwitch.addEventListener('change', async e => {
    const all = await snapshotLocal();
    all.syncEnabled = e.target.checked;
    await restoreToLocal(all);
    syncMsg.style.display = e.target.checked ? 'block' : 'none';
});

/* manual push */
syncNowBtn.addEventListener('click', async () => {
    if (!syncSwitch.checked) {
        alert('请先勾选启用同步');
        return;
    }
    const ok = await pushToSync();
    alert(ok ? '已上传至云端！' : '上传失败：超出配额或未登录');
});
