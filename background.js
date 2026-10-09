// ============================================
// سرویس ورکر پس‌زمینه
// کارش: ساختن منوی راست‌کلیک برای باز کردن متن انتخاب‌شده به صورت راست‌چین
// ============================================

importScripts("adjacent-tabs.js", "viewer-drafts.js");

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "open-rtl-viewer",
    title: "نمایش راست‌چین «%s»",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "open-rtl-viewer" && info.selectionText) {
    // متن انتخاب‌شده رو ذخیره کن و صفحه نمایش رو باز کن
    try {
      const url = await ViewerDrafts.create({ text: info.selectionText, preview: true, name: "" });
      await AdjacentTabs.open(url, tab?.id);
    } catch (error) { console.error("Could not save and open selected text:", error); }
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
