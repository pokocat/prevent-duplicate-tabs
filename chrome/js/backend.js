/* js/backend.js – storage viewer / import / export */
const data = await storage.get(null);

/* helpers */
async function loadAll() { return await storage.get(null); }
async function saveAll(o) { await storage.clear(); await storage.set(o); }

/* DOM */
const $view = document.getElementById('jsonView');
const $ref = document.getElementById('refresh');
const $exp = document.getElementById('export');
const $file = document.getElementById('fileInput');
const $imp = document.getElementById('import');

async function refresh() {
    $view.textContent = 'loading…';
    try {
        const data = await loadAll();
        $view.textContent = JSON.stringify(data, null, 2);
    } catch (e) {
        console.error(e);
        $view.textContent = 'Error reading storage';
    }
}

document.addEventListener('DOMContentLoaded', refresh);
$ref.addEventListener('click', refresh);

$exp.addEventListener('click', async () => {
    const blob = new Blob(
        [JSON.stringify(await loadAll(), null, 2)],
        { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    chrome.downloads.download(
        { url, filename: 'duplicate-tab-settings.json', saveAs: true },
        () => URL.revokeObjectURL(url)
    );
});

$imp.addEventListener('click', async () => {
    const file = $file.files?.[0];
    if (!file) return alert('Select a file first');
    try {
        const json = JSON.parse(await file.text());
        await saveAll(json);
        await refresh();
        alert('Imported!');
    } catch (e) {
        alert('Invalid JSON');
    }
});
