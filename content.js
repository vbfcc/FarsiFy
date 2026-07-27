// ============================================
// این اسکریپت روی همه صفحات اجرا میشه
// کارش: تشخیص فارسی بودن صفحه + اعمال فونت و راست‌چین
// ============================================

(function () {
  let isPersianDetected = false;
  let debounceTimer = null;
  let tabId = null;
  let tabIdReady = null;

  const DEFAULTS = {
    fontEnabled: false,
    rtlEnabled: false,
    selectedFont: "Vazirmatn"
  };

  // تنظیمات باید فقط روی همین تب اثر بذاره، نه تب‌های دیگه.
  // این آی‌دی فقط برای «ماندگاری تنظیمات این تب بین رفرش‌ها» لازمه؛
  // اعمال زنده‌ی تاگل از پاپ‌آپ مستقیم پیام می‌گیره و منتظر این نمی‌مونه.
  function getTabId() {
    if (!tabIdReady) {
      tabIdReady = new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ type: "GET_TAB_ID" }, (res) => {
            if (chrome.runtime.lastError) {
              resolve(null);
              return;
            }
            tabId = res && res.tabId != null ? res.tabId : null;
            resolve(tabId);
          });
        } catch {
          resolve(null);
        }
      });
    }
    return tabIdReady;
  }

  function storageKey() {
    return `tabSettings_${tabId}`;
  }

  // چک سریع: اگه صفحه خودش گفته فارسیه (lang یا dir)
  function quickCheck() {
    const lang = (document.documentElement.lang || "").toLowerCase();
    const dir = (document.documentElement.dir || "").toLowerCase();
    if (lang.startsWith("fa") || dir === "rtl") return true;
    return null;
  }

  // چک دقیق: شمردن حروف فارسی/عربی توی متن صفحه
  function deepCheck() {
    const text = document.body ? document.body.innerText : "";
    const matches = text.match(/[؀-ۿ]/g);
    return !!(matches && matches.length > 30);
  }

  function detectPersian() {
    return quickCheck() === true ? true : deepCheck();
  }

  // منطق واقعیِ اعمال روی DOM؛ هم از روی storage صدا زده میشه هم مستقیم از پیام پاپ‌آپ
  function applyToDom(settings) {
    isPersianDetected = detectPersian();
    const root = document.documentElement;

    // ۱) فونت: فقط اگه فعال باشه و صفحه فارسی باشه
    const applyFont = settings.fontEnabled && isPersianDetected && settings.selectedFont !== "system";
    root.classList.toggle("persian-font-active", applyFont);
    if (applyFont) {
      root.style.setProperty("--pf-selected-font", `'${settings.selectedFont}'`);
    }

    // ۲) راست‌چین: هر وقت کاربر روشنش کنه (مستقل از تشخیص فارسی)
    root.classList.toggle("persian-rtl-active", !!settings.rtlEnabled);
  }

  function applySettings() {
    getTabId().then(() => {
      chrome.storage.local.get({ [storageKey()]: DEFAULTS }, (data) => {
        applyToDom(data[storageKey()]);
      });
    });
  }

  // برای صفحات داینامیک: صبر کن تغییرات تموم بشه بعد چک کن (بهینه‌سازی)
  function scheduleApply() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applySettings, 300);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applySettings);
  } else {
    applySettings();
  }

  const observer = new MutationObserver(scheduleApply);
  function startObserver() {
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener("DOMContentLoaded", startObserver);
    }
  }
  startObserver();

  // *** تغییر زنده بدون رفرش، وقتی storage از جای دیگه‌ای (نه پاپ‌آپ فعلی) عوض میشه ***
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && tabId != null && changes[storageKey()]) {
      applyToDom(changes[storageKey()].newValue || DEFAULTS);
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "GET_STATUS") {
      sendResponse({ isPersianDetected });
      return;
    }
    // پاپ‌آپ مستقیماً تنظیمات جدید رو می‌فرسته تا فوراً روی همین تب اعمال بشه
    // (منتظر resolve شدن tabId یا رخداد storage.onChanged نمی‌مونه)
    if (msg.type === "APPLY_SETTINGS" && msg.settings) {
      applyToDom(msg.settings);
    }
  });
})();
