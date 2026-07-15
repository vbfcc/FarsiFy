// ============================================
// سرویس ورکر پس‌زمینه
// کارش: ساختن منوی راست‌کلیک برای باز کردن متن انتخاب‌شده به صورت راست‌چین
// ============================================

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "open-rtl-viewer",
    title: "نمایش راست‌چین «%s»",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === "open-rtl-viewer" && info.selectionText) {
    // متن انتخاب‌شده رو ذخیره کن و صفحه نمایش رو باز کن
    chrome.storage.local.set({ viewerText: info.selectionText }, () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
    });
  }
});

// ============================================
// تنظیمات فونت/راست‌چین باید فقط روی همون تب اثر بذاره
// content.js آی‌دی تب خودش رو نمی‌دونه، پس اینجا بهش می‌گیم
// ============================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_TAB_ID") {
    sendResponse({ tabId: sender.tab ? sender.tab.id : null });
  }
});

// وقتی تبی بسته میشه، تنظیمات مخصوص همون تب رو هم پاک کن
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.remove(`tabSettings_${tabId}`);
});
