const fontToggle = document.getElementById("fontToggle");
const rtlToggle = document.getElementById("rtlToggle");
const fontSelect = document.getElementById("fontSelect");
const pageStatus = document.getElementById("pageStatus");
const pasteArea = document.getElementById("pasteArea");
const openViewerBtn = document.getElementById("openViewer");
const mdUrlInput = document.getElementById("mdUrlInput");
const loadMdUrlBtn = document.getElementById("loadMdUrl");
const mdFileInput = document.getElementById("mdFileInput");
const loadMdFileBtn = document.getElementById("loadMdFile");
const mdFolderInput = document.getElementById("mdFolderInput");
const loadMdFolderBtn = document.getElementById("loadMdFolder");

const DEFAULTS = {
  fontEnabled: false,
  rtlEnabled: false,
  selectedFont: "Vazirmatn"
};

// این تنظیمات باید فقط روی تب فعال فعلی اثر بذاره، نه تب‌های دیگه
let activeTabId = null;

function storageKey() {
  return `tabSettings_${activeTabId}`;
}

function saveTabSettings() {
  if (activeTabId == null) return;
  const settings = {
    fontEnabled: fontToggle.checked,
    rtlEnabled: rtlToggle.checked,
    selectedFont: fontSelect.value
  };
  // برای ماندگاری بین رفرش‌های همون تب
  chrome.storage.local.set({ [storageKey()]: settings });
  // برای اعمال فوری روی صفحه، بدون نیاز به match شدن کلید storage توی content script
  chrome.tabs.sendMessage(activeTabId, { type: "APPLY_SETTINGS", settings }, () => {
    void chrome.runtime.lastError; // اگه صفحه content script نداشت (مثلا chrome://) بی‌خیالش شو
  });
}

// ---------- خوندن تنظیمات تب فعال ----------
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (!tabs[0]) return;
  activeTabId = tabs[0].id;
  chrome.storage.local.get({ [storageKey()]: DEFAULTS }, (data) => {
    const settings = data[storageKey()];
    fontToggle.checked = settings.fontEnabled;
    rtlToggle.checked = settings.rtlEnabled;
    fontSelect.value = settings.selectedFont;
  });
});

// ---------- وضعیت صفحه فعلی ----------
function updatePageStatus() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: "GET_STATUS" }, (response) => {
      if (chrome.runtime.lastError || !response) {
        pageStatus.textContent = "صفحه پشتیبانی نمی‌شود";
        return;
      }
      pageStatus.textContent = response.isPersianDetected
        ? "🟢 صفحه فارسی"
        : "🟡 فارسی نیست";
    });
  });
}
updatePageStatus();

// ---------- ذخیره تنظیمات (بدون رفرش صفحه، فقط روی همین تب) ----------
// content script خودش با storage.onChanged فورا اعمال می‌کنه

fontToggle.addEventListener("change", saveTabSettings);
rtlToggle.addEventListener("change", saveTabSettings);
fontSelect.addEventListener("change", saveTabSettings);

// ---------- باز کردن متن در تب جدید ----------
openViewerBtn.addEventListener("click", () => {
  const text = pasteArea.value.trim();
  chrome.storage.local.set({ viewerText: text }, () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
  });
});

// دکمه Enter + Ctrl هم کار کنه
pasteArea.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    openViewerBtn.click();
  }
});

// ---------- بارگذاری فایل md از آدرس ----------
function loadMdFromUrl() {
  const raw = mdUrlInput.value.trim();
  if (!raw) return;

  // مسیرهای فایل ویندوزی مثل E:\... یا \\server\share\... یا file:///
  const isWindowsPath = /^[a-zA-Z]:[\\/]/.test(raw) || /^\\\\/.test(raw);
  if (isWindowsPath || raw.startsWith("file:")) {
    mdUrlInput.title = "مسیر فایل سیستم پشتیبانی نمی‌شه؛ آدرس رو در ویوئر باز کن و از اونجا امتحان کن، یا محتوا رو کپی/پیست کن";
    mdUrlInput.reportValidity?.();
    alert("مسیر فایل سیستم پشتیبانی نمی‌شه؛ محتوای فایل رو کپی و پیست کن یا از یک آدرس http(s) استفاده کن ❌");
    return;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    alert("آدرس نامعتبره ❌");
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    alert("فقط آدرس‌های http:// و https:// پشتیبانی می‌شن ❌");
    return;
  }

  // خودِ فچ رو به تب ویوئر می‌سپریم (با src= توی آدرس) تا هم اسم فایل توی آدرس‌بار
  // اون تب معلوم باشه، هم با رفرش کردن همون تب، آخرین نسخه دوباره از همون آدرس بیاد
  const viewerUrl = chrome.runtime.getURL("viewer.html") + "?src=" + encodeURIComponent(parsed.href);
  chrome.tabs.create({ url: viewerUrl });
}

loadMdUrlBtn.addEventListener("click", loadMdFromUrl);
mdUrlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadMdFromUrl();
});

// ============================================
// اگه مرورگر File System Access API رو پشتیبانی کنه، هندلِ فایل/پوشه رو توی
// همون IndexedDB ای که viewer.js می‌خونه ذخیره می‌کنیم (هر دو زمینه‌ی اکستنشن
// روی یک origin ان، پس این DB بینشون مشترکه). این‌جوری تبِ ویوئر با رفرش هم
// می‌تونه دوباره از روی همون فایل/پوشه‌ی روی دیسک بخونه، نه فقط یک بار
// ============================================
const supportsFsAccess = "showOpenFilePicker" in window && "showDirectoryPicker" in window;
const HANDLE_DB_NAME = "farsify-file-handles";
const HANDLE_STORE = "handles";

function openHandleDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(HANDLE_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveHandle(id, handle) {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readwrite");
    tx.objectStore(HANDLE_STORE).put(handle, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function genHandleId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---------- بارگذاری فایل md از سیستم (فایل‌های لوکال) ----------
loadMdFileBtn.addEventListener("click", () => {
  if (supportsFsAccess) pickAndOpenFile();
  else mdFileInput.click();
});

async function pickAndOpenFile() {
  let handles;
  try {
    handles = await window.showOpenFilePicker({
      multiple: false,
      types: [{ description: "Markdown", accept: { "text/markdown": [".md", ".markdown"] } }]
    });
  } catch {
    return; // کاربر لغو کرد
  }
  const handle = handles[0];
  try {
    const id = genHandleId();
    await saveHandle(id, handle);
    const viewerUrl =
      chrome.runtime.getURL("viewer.html") +
      `?kind=file&handle=${encodeURIComponent(id)}&name=${encodeURIComponent(handle.name)}`;
    chrome.tabs.create({ url: viewerUrl });
  } catch (err) {
    alert(`باز کردن فایل ناموفق بود ❌ (${err.message || "خطای ناشناخته"})`);
  }
}

mdFileInput.addEventListener("change", async () => {
  const file = mdFileInput.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    chrome.storage.local.set({ viewerText: text, viewerPreview: true, viewerFileName: file.name }, () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
    });
  } catch (err) {
    alert(`خواندن فایل ناموفق بود ❌ (${err.message || "خطای ناشناخته"})`);
  } finally {
    mdFileInput.value = "";
  }
});

// ---------- انتخاب یک پوشه: فقط انتخاب، فهرست و نمایش در هدر تب ویوئر انجام میشه ----------
loadMdFolderBtn.addEventListener("click", () => {
  if (supportsFsAccess) pickAndOpenFolder();
  else mdFolderInput.click();
});

async function pickAndOpenFolder() {
  let dirHandle;
  try {
    dirHandle = await window.showDirectoryPicker();
  } catch {
    return; // کاربر لغو کرد
  }
  try {
    const id = genHandleId();
    await saveHandle(id, dirHandle);
    const viewerUrl = chrome.runtime.getURL("viewer.html") + `?kind=dir&handle=${encodeURIComponent(id)}`;
    chrome.tabs.create({ url: viewerUrl });
  } catch (err) {
    alert(`باز کردن پوشه ناموفق بود ❌ (${err.message || "خطای ناشناخته"})`);
  }
}

mdFolderInput.addEventListener("change", async () => {
  const all = Array.from(mdFolderInput.files || []);
  const mdFiles = all.filter((f) => /\.(md|markdown)$/i.test(f.name));
  mdFolderInput.value = "";

  if (!mdFiles.length) {
    alert("هیچ فایل .md ای در این پوشه پیدا نشد ❌");
    return;
  }

  mdFiles.sort((a, b) =>
    (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, "fa")
  );

  const originalLabel = loadMdFolderBtn.textContent;
  loadMdFolderBtn.disabled = true;
  loadMdFolderBtn.textContent = "⏳ در حال خواندن فایل‌ها...";

  try {
    const entries = await Promise.all(
      mdFiles.map(async (file) => {
        const rel = file.webkitRelativePath || file.name;
        const slashIdx = rel.indexOf("/");
        const label = slashIdx !== -1 ? rel.slice(slashIdx + 1) : rel;
        return { label, text: await file.text() };
      })
    );
    chrome.storage.local.set({ pendingFolderFiles: entries }, () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
    });
  } catch (err) {
    alert(`خواندن فایل‌ها ناموفق بود ❌ (${err.message || "خطای ناشناخته"})`);
  } finally {
    loadMdFolderBtn.disabled = false;
    loadMdFolderBtn.textContent = originalLabel;
  }
});
