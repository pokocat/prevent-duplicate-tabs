/* backend.js – Data Manager + manual sync */

import {
    snapshotLocal,
    restoreToLocal,
    pushToSync,
    pullFromSync
} from './storage.js';

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
const statusMsg = $('statusMsg'); // ← 页面上的状态提示区域

/* ---------- Helpers ---------- */
async function refreshJson() {
    const data = await snapshotLocal();
    jsonView.textContent = JSON.stringify(data, null, 2);

    const enabled = data.syncEnabled ?? true;
    syncSwitch.checked = enabled;
    syncMsg.style.display = enabled ? 'block' : 'none';
}

function showStatus(message, type = 'info') {
    if (!statusMsg) return;
    statusMsg.textContent = message;
    statusMsg.className = `status ${type}`;
    statusMsg.style.display = 'block';
    setTimeout(() => {
        statusMsg.style.display = 'none';
    }, 3000);
}

/* ---------- Initial load ---------- */
document.addEventListener('DOMContentLoaded', async () => {
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
    if (!file) return showStatus('请选择文件', 'warn');
    try {
        const obj = JSON.parse(await file.text());
        await restoreToLocal(obj);
        await refreshJson();
        showStatus('已导入并覆盖本地配置', 'success');
    } catch (e) {
        console.error(e);
        showStatus('JSON 格式不正确', 'error');
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
        showStatus('请先勾选启用同步', 'warn');
        return;
    }

    const ok = await pushToSync();

    if (ok) {
        await pullFromSync(true);  // 强制用刚刚上传的云端数据覆盖本地
        await refreshJson();
        showStatus('☁️ Uploaded to the cloud! ', 'success');
    } else {
        showStatus('Upload failed: Quota exceeded or you are not logged in', 'error');
    }
});
