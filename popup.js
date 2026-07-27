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
async function loadMdFromUrl() {
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

  loadMdUrlBtn.disabled = true;
  const originalLabel = loadMdUrlBtn.textContent;
  loadMdUrlBtn.textContent = "⏳ در حال بارگذاری...";

  try {
    const res = await fetch(parsed.href, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    chrome.storage.local.set({ viewerText: text, viewerPreview: true }, () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
    });
  } catch (err) {
    alert(`بارگذاری ناموفق بود ❌ (${err.message || "خطای شبکه"})`);
  } finally {
    loadMdUrlBtn.disabled = false;
    loadMdUrlBtn.textContent = originalLabel;
  }
}

loadMdUrlBtn.addEventListener("click", loadMdFromUrl);
mdUrlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadMdFromUrl();
});

// ---------- بارگذاری فایل md از سیستم (فایل‌های لوکال) ----------
loadMdFileBtn.addEventListener("click", () => mdFileInput.click());

mdFileInput.addEventListener("change", async () => {
  const file = mdFileInput.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    chrome.storage.local.set({ viewerText: text, viewerPreview: true }, () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
    });
  } catch (err) {
    alert(`خواندن فایل ناموفق بود ❌ (${err.message || "خطای ناشناخته"})`);
  } finally {
    mdFileInput.value = "";
  }
});
