const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function setup({ current, active, get } = {}) {
  const created = [];
  const elements = new Map();
  const saved = {};
  const documents = [];
  const context = vm.createContext({
    URL, URLSearchParams, console,
    window: {},
    ViewerDrafts: { create: async (document) => {
      documents.push(document);
      return `chrome-extension://test/viewer.html?draft=${documents.length}`;
    } },
    document: { getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        value: '', files: [], textContent: '',
        listeners: {},
        addEventListener(event, callback) { this.listeners[event] = callback; },
        click() { return this.listeners.click?.({}); }
      });
      return elements.get(id);
    } },
    chrome: {
      runtime: { getURL: (name) => `chrome-extension://test/${name}` },
      tabs: {
        get: get || (async () => active),
        getCurrent: async () => current,
        query: async (options, callback) => { const tabs = active ? [active] : []; callback?.(tabs); return tabs; },
        create: async (options) => { created.push(options); return options; },
        sendMessage: (id, message, callback) => callback?.({})
      },
      storage: { local: {
        get: (defaults, callback) => callback(defaults),
        set: (values, callback) => { Object.assign(saved, values); callback?.(); }
      } }
    },
    alert: (message) => { throw new Error(message); }
  });
  for (const name of ['adjacent-tabs.js', 'source-paths.js']) vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), context);
  return { context, created, elements, saved, documents };
}

test('source ID uses its latest position, even when another tab becomes active', async () => {
  const state = setup({ active: { id: 99, index: 12, windowId: 5 }, get: async (id) => {
    assert.equal(id, 42);
    return { id, index: 3, windowId: 8 };
  } });
  await vm.runInContext('AdjacentTabs.open("viewer", 42)', state.context);
  assert.deepEqual({ ...state.created[0] }, { url: 'viewer', active: true, windowId: 8, index: 4, openerTabId: 42 });
});

test('viewer actions open next to their own tab, including background viewers', async () => {
  const state = setup({ current: { id: 2, index: 1, windowId: 7 }, active: { id: 9, index: 8, windowId: 7 } });
  await vm.runInContext('AdjacentTabs.open("viewer")', state.context);
  assert.equal(state.created[0].index, 2);
  assert.equal(state.created[0].openerTabId, 2);
});

test('closed source tabs fall back to the current active tab', async () => {
  const state = setup({ active: { id: 9, index: 8, windowId: 7 }, get: async () => { throw new Error('Closed tab'); } });
  await vm.runInContext('AdjacentTabs.open("viewer", 42)', state.context);
  assert.equal(state.created[0].index, 9);
});

test('popup text, URL, file and folder flows all open beside the invocation tab', async () => {
  const state = setup({ active: { id: 42, index: 2, windowId: 8 } });
  vm.runInContext(fs.readFileSync(path.join(root, 'popup.js'), 'utf8'), state.context);
  // Only persistence and native OS pickers are substituted; run the production handlers.
  vm.runInContext('saveHandle = async () => {};', state.context);
  state.elements.get('pasteArea').value = '## عنوان\n\n**بولد**';
  await state.elements.get('openViewer').click();
  state.elements.get('mdUrlInput').value = 'E:\\docs\\story.md';
  state.elements.get('loadMdUrl').click();
  state.elements.get('mdFileInput').files = [{ name: 'story.md', text: async () => '**متن**' }];
  await state.elements.get('mdFileInput').listeners.change();
  state.elements.get('mdFolderInput').files = [{ name: 'story.md', webkitRelativePath: 'docs/story.md' }];
  await state.elements.get('mdFolderInput').listeners.change();
  state.context.window.showOpenFilePicker = async () => [{ name: 'native.md' }];
  state.context.window.showDirectoryPicker = async () => ({ name: 'docs' });
  await vm.runInContext('pickAndOpenFile()', state.context);
  await vm.runInContext('pickAndOpenFolder()', state.context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.created.length, 6);
  for (const options of state.created) {
    assert.equal(options.index, 3);
    assert.equal(options.windowId, 8);
    assert.equal(options.openerTabId, 42);
  }
  assert.equal(state.documents[0].preview, true);
  assert.equal(state.documents[0].text, '## عنوان\n\n**بولد**');
  assert.equal(state.documents[1].name, 'story.md');
});
