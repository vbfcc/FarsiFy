// Use the source tab's current position, even after a file picker or disk read.
const AdjacentTabs = {
  async open(url, sourceTabId = null) {
    let source;
    if (sourceTabId != null) {
      try { source = await chrome.tabs.get(sourceTabId); }
      catch { /* The original tab may have been closed. */ }
    } else {
      source = await chrome.tabs.getCurrent();
    }
    if (!source) {
      [source] = await chrome.tabs.query({ active: true, currentWindow: true });
    }
    const options = { url, active: true };
    if (source) {
      options.windowId = source.windowId;
      options.index = source.index + 1;
      options.openerTabId = source.id;
    }
    return chrome.tabs.create(options);
  }
};
