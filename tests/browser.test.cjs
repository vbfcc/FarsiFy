// Dependency-free Chromium integration check. Native pickers and Chrome's file permission switch remain manual checks.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const story = fs.readFileSync(path.join(__dirname, 'fixtures/persian-story.md'), 'utf8');
const extensionMode = process.argv.includes('--extension');
const samplePath = process.argv.slice(2).find((arg) => arg !== '--extension');
const browser = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'farsify-browser-test-'));
let child;
(async () => {
try {
  const mock = `<script>
    window.addEventListener('error', (event) => { document.getElementById('testResult').textContent = JSON.stringify({ passed: false, error: event.message + ' at ' + event.filename + ':' + event.lineno }); });
    window.addEventListener('unhandledrejection', (event) => { document.getElementById('testResult').textContent = JSON.stringify({ passed: false, error: String(event.reason) }); });
    window.showDirectoryPicker = async () => { throw new DOMException('Cancelled', 'AbortError'); };
    window.chrome = { runtime: { getURL: (name) => ${JSON.stringify(pathToFileURL(root + path.sep).href)} + name },
      extension: { isAllowedFileSchemeAccess: async () => true },
      tabs: { create: () => {} },
      storage: { local: { get: (defaults, callback) => queueMicrotask(() => callback('viewerText' in defaults ? { ...defaults, viewerText: ${JSON.stringify(story)}, viewerPreview: true } : defaults)), set: () => {}, remove: () => {} }, onChanged: { addListener: () => {} } } };
    window.pastedStory = ${JSON.stringify(story)};
    window.sampleDocumentUrl = ${JSON.stringify(samplePath ? pathToFileURL(path.resolve(samplePath)).href : null)};
  </script>`;
  let html = fs.readFileSync(path.join(root, 'viewer.html'), 'utf8');
  html = html.replace('<script src="source-paths.js">', mock + '<script src="source-paths.js">');
  html = html.replace(/src="([^"/]+\.js)"/g, (_, name) => `src="${pathToFileURL(path.join(root, name)).href}"`);
  html = html.replace('</body>', `<pre id="testResult">pending</pre><script src="${pathToFileURL(path.join(__dirname, 'browser-checks.js')).href}"></script></body>`);
  const fixture = path.join(temporary, 'viewer-test.html');
  fs.writeFileSync(fixture, html);
  child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', ...(extensionMode ? ['--enable-unsafe-extension-debugging'] : ['--allow-file-access-from-files']), `--user-data-dir=${path.join(temporary, 'profile')}`, '--remote-debugging-pipe'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  let sequence = 0;
  let buffer = '';
  let stderr = '';
  const pending = new Map();
  const events = [];
  child.stderr.on('data', (data) => { stderr += data; });
  child.stdio[4].on('data', (data) => {
    buffer += data.toString();
    let index;
    while ((index = buffer.indexOf('\0')) !== -1) {
      const message = JSON.parse(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject, timer } = pending.get(message.id);
        clearTimeout(timer);
        pending.delete(message.id);
        message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
      } else events.push(message);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser timeout: ${method}\n${stderr}`)); }, 30000);
    pending.set(id, { resolve, reject, timer });
    child.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
  });
  let extensionId;
  if (extensionMode) {
    extensionId = (await send('Extensions.loadUnpacked', { path: root })).id;
    console.log('Loaded real extension:', extensionId);
  }
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Page.navigate', { url: extensionMode ? `chrome-extension://${extensionId}/viewer.html` : pathToFileURL(fixture).href }, sessionId);
  for (let i = 0; i < 100 && !events.some((event) => event.method === 'Page.loadEventFired' && event.sessionId === sessionId); i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (extensionMode) {
    const permission = await send('Runtime.evaluate', { expression: 'chrome.extension.isAllowedFileSchemeAccess()', awaitPromise: true, returnByValue: true }, sessionId);
    console.log('Real file URL permission:', permission.result.value);
    if (!permission.result.value && samplePath) throw new Error('Isolated test extension does not have file URL permission.');
    await send('Runtime.evaluate', { expression: `window.pastedStory = ${JSON.stringify(story)}; window.sampleDocumentUrl = ${JSON.stringify(samplePath ? pathToFileURL(path.resolve(samplePath)).href : null)}; window.showDirectoryPicker = async () => { throw new DOMException('Cancelled', 'AbortError'); }; const result = document.createElement('pre'); result.id = 'testResult'; result.textContent = 'pending'; document.body.appendChild(result);`, returnByValue: true }, sessionId);
    await send('Runtime.evaluate', { expression: fs.readFileSync(path.join(__dirname, 'browser-checks.js'), 'utf8'), returnByValue: true }, sessionId);
  }
  const evaluation = await send('Runtime.evaluate', {
    expression: `new Promise((resolve) => { const timer = setInterval(() => { const value = document.getElementById('testResult')?.textContent; if (value && value !== 'pending') { clearInterval(timer); resolve(JSON.parse(value)); } }, 50); })`,
    awaitPromise: true, returnByValue: true
  }, sessionId);
  const report = evaluation.result.value;
  console.log(JSON.stringify(report, null, 2));
  assert.equal(report.passed, true, report.error);
  if (extensionMode) {
    // Load the popup as an inactive extension page, with trailing tabs already open.
    // Its invocation tab is still captured through the real Chrome tabs API.
    const setup = await send('Runtime.evaluate', {
      expression: `(async () => {
        const origin = await chrome.tabs.getCurrent();
        await chrome.tabs.update(origin.id, { active: true });
        await chrome.tabs.create({ url: 'about:blank', active: false });
        const popup = await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html'), active: false });
        return { origin, popupUrl: popup.url || popup.pendingUrl };
      })()`, awaitPromise: true, returnByValue: true
    }, sessionId);
    assert.ok(!setup.exceptionDetails, JSON.stringify(setup.exceptionDetails));
    const { origin, popupUrl } = setup.result.value;
    const targets = await send('Target.getTargets');
    const popupTarget = targets.targetInfos.find((target) => target.url === popupUrl);
    assert.ok(popupTarget, 'Popup target exists');
    const attached = await send('Target.attachToTarget', { targetId: popupTarget.targetId, flatten: true });
    const popupSession = attached.sessionId;
    const opened = await send('Runtime.evaluate', {
      expression: `(async () => {
        while (document.readyState !== 'complete') await new Promise((resolve) => setTimeout(resolve, 20));
        await sourceTabReady;
        pasteArea.value = ${JSON.stringify(story)};
        openViewerBtn.click();
        for (let i = 0; i < 100; i++) {
          const tabs = await chrome.tabs.query({ windowId: ${origin.windowId} });
          const result = tabs.find((tab) => tab.openerTabId === ${origin.id} && tab.url?.startsWith(chrome.runtime.getURL('viewer.html') + '?draft='));
          if (result) return { result, origin: await chrome.tabs.get(${origin.id}) };
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error('Popup did not open a viewer tab');
      })()`, awaitPromise: true, returnByValue: true
    }, popupSession);
    assert.ok(!opened.exceptionDetails, JSON.stringify(opened.exceptionDetails));
    const tabResult = opened.result.value;
    assert.equal(tabResult.result.index, tabResult.origin.index + 1, 'Viewer opens immediately beside origin, before trailing tabs');
    assert.equal(tabResult.result.windowId, tabResult.origin.windowId);
    const newTargets = await send('Target.getTargets');
    const viewerTarget = newTargets.targetInfos.find((target) => target.url === tabResult.result.url && target.targetId !== targetId);
    assert.ok(viewerTarget, 'Result viewer target exists');
    const viewerSession = (await send('Target.attachToTarget', { targetId: viewerTarget.targetId, flatten: true })).sessionId;
    const rendered = await send('Runtime.evaluate', {
      expression: `(async () => {
        for (let i = 0; i < 100; i++) {
          if (document.querySelector('#preview.visible strong')) return {
            heading: document.querySelector('#preview h2').textContent,
            questions: document.querySelector('#preview ol').children.length,
            rawHidden: document.querySelector('#content').classList.contains('hidden')
          };
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error('Pasted text did not open in reading mode');
      })()`, awaitPromise: true, returnByValue: true
    }, viewerSession);
    assert.ok(!rendered.exceptionDetails, JSON.stringify(rendered.exceptionDetails));
    assert.equal(rendered.result.value.heading, 'داستان از این قراره');
    assert.equal(rendered.result.value.questions, 6);
    assert.equal(rendered.result.value.rawHidden, true);
    console.log('Real popup: adjacent tab placement and automatic Persian Markdown rendering passed.');

    const edit = await send('Runtime.evaluate', {
      expression: `(async () => {
        await viewerReady;
        content.textContent += '\\n\\n- [ ] یادآوری';
        await setPreviewMode(true);
        preview.querySelector('.task-checkbox').click();
        await ReaderTools.flush();
        fontSelect.value = 'Shabnam';
        fontSelect.dispatchEvent(new Event('change'));
        sizeRange.value = '22';
        sizeRange.dispatchEvent(new Event('input'));
        content.textContent += '\\n\\nحفظ فوری';
        content.dispatchEvent(new InputEvent('input', { bubbles: true }));
        return content.innerText;
      })()`, awaitPromise: true, returnByValue: true
    }, viewerSession);
    assert.ok(!edit.exceptionDetails, JSON.stringify(edit.exceptionDetails));
    const editedText = edit.result.value;
    await send('Page.reload', {}, viewerSession);
    const waitForViewer = async (session) => {
      for (let i = 0; i < 100; i++) {
        try {
          const ready = await send('Runtime.evaluate', { expression: 'typeof viewerReady !== "undefined" && document.readyState === "complete"', returnByValue: true }, session);
          if (ready.result?.value) {
            const result = await send('Runtime.evaluate', { expression: '(async () => { await viewerReady; return { text: content.innerText, checked: preview.querySelector(".task-checkbox")?.checked, font: fontSelect.value, size: sizeRange.value, url: location.href }; })()', awaitPromise: true, returnByValue: true }, session);
            assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
            return result.result.value;
          }
        } catch (error) { if (i === 99) throw error; }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error('Viewer did not initialize');
    };
    const restored = await waitForViewer(viewerSession);
    assert.equal(restored.text, editedText, 'Immediate reload keeps the latest text edit');
    assert.equal(restored.checked, true, 'Reload keeps checklist state');
    assert.equal(restored.font, 'Shabnam');
    assert.equal(restored.size, '22');
    const second = await send('Runtime.evaluate', {
      expression: `(async () => {
        const url = await ViewerDrafts.create({ text: '# متن دوم\\n\\nمستقل', preview: true, name: '' });
        const tab = await chrome.tabs.create({ url, active: false });
        return { url, id: tab.id };
      })()`, awaitPromise: true, returnByValue: true
    }, sessionId);
    assert.ok(!second.exceptionDetails, JSON.stringify(second.exceptionDetails));
    const secondTarget = (await send('Target.getTargets')).targetInfos.find((target) => target.url === second.result.value.url);
    const secondSession = (await send('Target.attachToTarget', { targetId: secondTarget.targetId, flatten: true })).sessionId;
    const independent = await waitForViewer(secondSession);
    assert.equal(independent.text, '# متن دوم\n\nمستقل');
    assert.notEqual(independent.url, restored.url);
    assert.equal((await waitForViewer(viewerSession)).text, editedText, 'Opening a second document does not replace the first document');
    await send('Target.closeTarget', { targetId: viewerTarget.targetId });
    const reopened = await send('Target.createTarget', { url: restored.url });
    const reopenedSession = (await send('Target.attachToTarget', { targetId: reopened.targetId, flatten: true })).sessionId;
    assert.equal((await waitForViewer(reopenedSession)).text, editedText, 'A closed viewer can reopen its saved document');
    console.log('Drafts: immediate reload, checklist and font settings, independent tabs, and closed-tab recovery passed.');
  }

  const exported = await send('Runtime.evaluate', { expression: 'window.exportedTestHtml', returnByValue: true }, sessionId);
  assert.ok(exported.result.value, 'Standalone export was built');
  const standalonePath = path.join(temporary, 'standalone.html');
  fs.writeFileSync(standalonePath, exported.result.value);
  // A separate browser context prevents the installed extension's content
  // stylesheet from injecting additional font faces into the standalone page.
  const standaloneContext = await send('Target.createBrowserContext');
  const standalone = await send('Target.createTarget', { url: 'about:blank', browserContextId: standaloneContext.browserContextId });
  const standaloneSession = (await send('Target.attachToTarget', { targetId: standalone.targetId, flatten: true })).sessionId;
  await send('Network.enable', {}, standaloneSession);
  await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*', 'chrome-extension://*'] }, standaloneSession);
  await send('Page.navigate', { url: pathToFileURL(standalonePath).href }, standaloneSession);
  const offline = await send('Runtime.evaluate', {
    expression: `(async () => {
      for (let i = 0; i < 100; i++) {
        if (document.querySelector('#preview img')?.naturalWidth === 40) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await document.fonts.ready;
      return {
        image: document.querySelector('#preview img')?.naturalWidth,
        heading: document.querySelector('#preview h1')?.textContent,
        font: document.fonts.check('18px Vazirmatn'),
        loadedFaces: Array.from(document.fonts).filter((font) => font.status === 'loaded').length,
        checked: document.querySelector('.task-checkbox')?.checked,
        scripts: document.querySelectorAll('script').length
      };
    })()`, awaitPromise: true, returnByValue: true
  }, standaloneSession);
  assert.ok(!offline.exceptionDetails, JSON.stringify(offline.exceptionDetails));
  assert.equal(offline.result.value.image, 40, 'Exported image loads without extension or network resources');
  assert.equal(offline.result.value.heading, 'Sample');
  assert.equal(offline.result.value.font, true);
  assert.ok(offline.result.value.loadedFaces >= 1, 'Embedded Persian font loads offline');
  assert.equal(offline.result.value.checked, true);
  assert.equal(offline.result.value.scripts, 0);
  console.log('Standalone HTML: embedded images, Persian fonts, checklist state, and script-free reading passed offline.');
  await send('Browser.close');
  await new Promise((resolve) => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); });
} finally {
  if (child && child.exitCode === null) child.kill();
  // Only remove the exact temporary directory created by this process.
  fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
})().catch((err) => { console.error(err); process.exitCode = 1; });
