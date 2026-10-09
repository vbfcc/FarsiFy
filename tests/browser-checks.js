(async () => {
  const results = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    results.push(message);
  };
  const waitUntil = async (condition) => {
    for (let i = 0; i < 120; i++) {
      if (condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Timed out waiting for rendered images');
  };
  try {
    if (location.protocol === 'file:') {
      check(preview.classList.contains('visible') && content.classList.contains('hidden'), 'Pasted text opens directly in Markdown reading mode');
    }
    DocumentResources.set({});
    content.textContent = window.pastedStory;
    setPreviewMode(true);
    await document.fonts.ready;
    check(preview.querySelectorAll('h2').length === 2 && !preview.textContent.includes('##'), 'Persian headings render without Markdown markers');
    check(preview.querySelector('strong')?.textContent === 'قدم ۱: مشکل.' && !preview.textContent.includes('**'), 'Persian emphasis renders as bold without asterisks');
    check(getComputedStyle(preview.querySelector('strong')).fontWeight === '700', 'Emphasized text uses the bold font weight');
    const questions = preview.querySelector('ol');
    check(questions.children.length === 6 && questions.children[5].textContent.includes('اطلاعیه'), 'Multiline answers retain a single numbered list from 1 to 6');
    check(questions.children[4].querySelectorAll('ul > li').length === 2 && questions.children[4].textContent.includes('یادداشت'), 'Nested bullets and a continuation paragraph remain inside question 5');
    previewBtn.click();
    check(content.innerText === window.pastedStory && !content.classList.contains('hidden'), 'Editing preserves the original Markdown text');
    previewBtn.click();
    check(preview.querySelector('ol').children.length === 6, 'Returning to reading mode restores formatted text');
    preview.innerHTML = renderMarkdown('3. Third\n\n4. Fourth\n   - Nested\n     1. Deep\n\nParagraph\n\n> **Quote**\n> - item\n\n| A | B |\n|---|---|\n| x | y |');
    check(preview.querySelector('ol').start === 3 && preview.querySelector('ol').children.length === 2 && preview.querySelector('ol ul ol li')?.textContent === 'Deep', 'Numbered list starts and multiple nesting levels survive blank lines');
    check(preview.querySelector('blockquote strong')?.textContent === 'Quote' && preview.querySelector('table td')?.textContent === 'x', 'Quotes and tables still render alongside lists');
    // Real Chromium DOM and image decoder, using the production viewer scripts.
    DocumentResources.set({ url: 'file:///E:/project/docs/qa.md', name: 'qa.md' });
    let html = renderMarkdown('[code](../app/Shop.php#L273-L280)\n\n![image](assets/my_image.png "title")\n\n[photo](assets/screen.png)');
    preview.innerHTML = html;
    check(preview.querySelectorAll('img').length === 2, 'Markdown images and ordinary image links render as images');
    let link = preview.querySelector('a');
    let params = new URL(link.href).searchParams;
    check(params.get('src') === 'file:///E:/project/app/Shop.php' && params.get('line') === '273' && params.get('endLine') === '280', 'File links keep resolved source, line and range in the new tab URL');
    check(link.target === '_blank' && link.rel.includes('noopener'), 'Document links open in a new tab');
    check(preview.querySelector('img').dataset.source === 'assets/my_image.png', 'Underscores in image paths survive formatting');
    html = renderMarkdown('`[literal](bad.md)`\n\n[unsafe](javascript:alert(1))\n\n<img src=x onerror=alert(1)>\n\n[spaces](<other doc.md>)\n\n[parens](test(1).md)');
    preview.innerHTML = html;
    check(preview.querySelector('code').textContent === '[literal](bad.md)', 'Inline code stays literal');
    check(!preview.querySelector('img') && !preview.querySelector('a[href^="javascript:"]'), 'Raw HTML and unsafe schemes cannot execute');
    check(preview.querySelector('a[data-reference="other doc.md"]') && preview.querySelector('a[data-reference="test(1).md"]'), 'Space-containing and parenthesized link destinations render');
    preview.innerHTML = renderMarkdown('```html\n<div dir="rtl">\nexample\n</div>\n```');
    check(preview.querySelector('pre code').textContent.includes('<div dir="rtl">'), 'RTL direction wrappers inside code examples remain literal');

    const entries = [
      { path: 'docs/qa.md', file: new File(['# Sample\n\n[photo](../assets/screen.svg)\n\n[code](../app/test.js:3)\n\n[doc](other.md#target-heading)'], 'qa.md') },
      { path: 'docs/other.md', file: new File(['# Target heading\n\ntext'], 'other.md') },
      { path: 'assets/screen.svg', file: new File(['<svg xmlns="http://www.w3.org/2000/svg" width="40" height="60"><rect width="40" height="60" fill="blue"/></svg>'], 'screen.svg', { type: 'image/svg+xml' }) },
      { path: 'app/test.js', file: new File(['first\nsecond\nthird\nfourth'], 'test.js') }
    ];
    await saveHandle('test-bundle', entries);
    await loadFolderBundle(entries, 'test-bundle', { entry: 'docs/qa.md' });
    await waitUntil(() => preview.querySelector('img')?.naturalWidth === 40);
    check(preview.querySelector('img').src.startsWith('blob:'), 'Selected folder image files display through blob URLs');
    link = preview.querySelector('a[data-reference="../app/test.js:3"]');
    params = new URL(link.href).searchParams;
    check(params.get('kind') === 'bundle' && params.get('handle') === 'test-bundle' && params.get('entry') === 'app/test.js' && params.get('line') === '3', 'Folder source context and source line survive new tab navigation');
    const restored = await loadHandle(params.get('handle'));
    await loadFolderBundle(restored, 'test-bundle', { entry: params.get('entry'), target: { line: params.get('line') } });
    await waitUntil(() => preview.querySelector('#L3.selected-line'));
    check(preview.querySelector('#L3.selected-line > span').textContent === 'third', 'Source viewer highlights the exact requested line');
    check(preview.querySelectorAll('.source-line').length === 4, 'Source file displays line numbers');
    await loadFolderBundle(entries, 'test-bundle', { entry: 'docs/other.md', target: { anchor: 'target-heading' } });
    check(preview.querySelector('#target-heading')?.textContent === 'Target heading', 'Linked Markdown headings have usable anchors');
    check(new URLSearchParams(location.search).get('anchor') === 'target-heading', 'Heading target survives refresh address updates');

    // A directory handle exposes only its selected subtree. No native picker is automated.
    const makeDir = (children) => ({
      kind: 'directory',
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      async *entries() { for (const pair of Object.entries(children)) yield pair; },
      async getDirectoryHandle(name) { if (children[name]?.kind !== 'directory') throw new Error('Missing directory'); return children[name]; },
      async getFileHandle(name) { if (children[name]?.kind !== 'file') throw new Error('Missing file'); return children[name]; }
    });
    const root = makeDir({ docs: makeDir({ 'qa.md': { kind: 'file', getFile: async () => entries[0].file } }), app: makeDir({ 'test.js': { kind: 'file', getFile: async () => entries[3].file } }), assets: makeDir({ 'screen.svg': { kind: 'file', getFile: async () => entries[2].file } }) });
    await loadLocalFolderHandle(root, 'mock-directory', { activateLabel: 'app/test.js', target: { line: '2' } });
    check(preview.querySelector('#L2.selected-line > span').textContent === 'second', 'Directory links can open non-Markdown files outside the Markdown index');
    await loadLocalFolderHandle(root, 'mock-directory', { activateLabel: 'docs/qa.md' });
    await waitUntil(() => preview.querySelector('img')?.naturalWidth === 40);
    check(preview.querySelector('img').naturalHeight === 60, 'Directory images load relative to the document');

    DocumentResources.set({ fileHandle: { name: 'qa.md' }, name: 'qa.md' });
    content.textContent = await entries[0].file.text();
    setPreviewMode(true);
    await waitUntil(() => preview.querySelector('.image-placeholder button'));
    check(!document.getElementById('attachResourceFolderBtn').hidden, 'Single-file selection explains missing folder access');
    check(!preview.querySelector('img') && preview.querySelector('.image-placeholder button'), 'Unavailable sibling images show an inline folder-selection action instead of a broken image');
    const anchor = preview.querySelector('a[data-reference="other.md#target-heading"]');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);
    check(event.defaultPrevented, 'Unresolved relative links cannot navigate to an extension resource');

    // Exercise recovery from the inline image action with the browser's real File blobs.
    const originalPicker = window.showDirectoryPicker;
    root.resolve = async () => ['docs', 'qa.md'];
    window.showDirectoryPicker = async () => root;
    // FileSystemHandle is structured-cloneable; this lightweight directory fixture contains functions.
    // Persist its ID with a temporary stub only for the directory-picker recovery check.
    const originalSaveHandle = saveHandle;
    let savedRoot = null;
    saveHandle = async (id, handle) => { savedRoot = handle; };
    preview.querySelector('.image-placeholder button').click();
    await waitUntil(() => preview.querySelector('img')?.naturalWidth === 40);
    check(savedRoot === root && new URLSearchParams(location.search).get('entry') === 'docs/qa.md', 'Selecting the source folder recovers the current document images and source context');
    saveHandle = originalSaveHandle;
    window.showDirectoryPicker = originalPicker;

    if (window.sampleDocumentUrl) {
      await fetchAndLoadUrl(window.sampleDocumentUrl);
      preview.querySelectorAll('img').forEach((img) => { img.loading = 'eager'; });
      await waitUntil(() => preview.querySelectorAll('img').length > 0 && Array.from(preview.querySelectorAll('img')).every((img) => img.complete && img.naturalWidth > 0));
      check(preview.querySelectorAll('img').length === 15, 'All 15 real QA document image links load from their original files');
      check(!preview.textContent.includes('<div dir="rtl">'), 'Common RTL wrapper does not show as literal document text');
    }
    document.getElementById('testResult').textContent = JSON.stringify({ passed: true, checks: results });
  } catch (err) {
    document.getElementById('testResult').textContent = JSON.stringify({ passed: false, checks: results, error: err.stack });
  }
})();
