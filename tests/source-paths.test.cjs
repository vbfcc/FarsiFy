const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = vm.createContext({ URL, URLSearchParams });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../source-paths.js'), 'utf8') + '\nglobalThis.paths = SourcePaths;', context);
const paths = context.paths;

test('Windows and UNC paths preserve Unicode, spaces, # and percent characters', () => {
  assert.equal(paths.inputUrl('E:\\docs\\نام #1 50%.md').href, 'file:///E:/docs/%D9%86%D8%A7%D9%85%20%231%2050%25.md');
  assert.equal(paths.inputUrl('\\\\server\\share\\my doc.md').href, 'file://server/share/my%20doc.md');
});

test('Windows paths accept one extra slash before the drive letter', () => {
  for (const input of [
    '/E:/factorland_localhost/docs/ideas/ai-assistant/INDEX.md',
    '  /E:\\factorland_localhost\\docs\\ideas\\ai-assistant\\INDEX.md  '
  ]) {
    const expected = 'file:///E:/factorland_localhost/docs/ideas/ai-assistant/INDEX.md';
    assert.equal(paths.inputUrl(input).href, expected);
    for (const source of [{}, { url: 'https://example.org/docs/qa.md' }, { rootId: 'root', entry: 'docs/qa.md' }]) {
      const result = paths.resolve(input, source);
      assert.equal(result.kind, 'url');
      assert.equal(result.url, expected);
      assert.equal(new URLSearchParams(paths.viewerParams(result)).get('src'), expected);
    }
  }
  assert.equal(paths.inputUrl('/e:/docs/نام #1 50%.md').href, 'file:///e:/docs/%D9%86%D8%A7%D9%85%20%231%2050%25.md');
  const ref = paths.resolve('/E:/docs/INDEX.md#L12-L20');
  assert.equal(ref.url, 'file:///E:/docs/INDEX.md');
  assert.equal(ref.line, 12);
  assert.equal(ref.endLine, 20);
});

test('relative URLs resolve against the source document', () => {
  const result = paths.resolve('../assets/test.png', { url: 'file:///E:/project/docs/qa.md' });
  assert.equal(result.url, 'file:///E:/project/assets/test.png');
  assert.equal(paths.resolve('image_name.png', { url: 'https://example.org/docs/qa.md' }).url, 'https://example.org/docs/image_name.png');
  assert.equal(paths.resolve('/docs/INDEX.md', { url: 'https://example.org/nested/qa.md' }).url, 'https://example.org/docs/INDEX.md');
});

test('line, line range, and column syntax survives viewer navigation', () => {
  for (const value of ['../app/Shop.php:273:5', '../app/Shop.php#L273:5']) {
    const result = paths.resolve(value, { rootId: 'root', entry: 'docs/qa.md' });
    assert.equal(result.entry, 'app/Shop.php');
    const params = new URLSearchParams(paths.viewerParams(result));
    assert.equal(params.get('line'), '273');
    assert.equal(params.get('column'), '5');
  }
  const range = paths.resolve('test.js#L12-L20', { url: 'http://localhost:8002/docs/qa.md' });
  assert.equal(range.line, 12);
  assert.equal(range.endLine, 20);
  assert.equal(range.url, 'http://localhost:8002/docs/test.js');
  assert.equal(paths.parseReference('http://localhost:8002').line, null);
});

test('folder paths handle encoded names and refuse access above selected root', () => {
  assert.equal(paths.folderPath('../assets/image%20one.png', 'docs/qa.md'), 'assets/image one.png');
  assert.equal(paths.folderPath('/docs/other.md', 'nested/qa.md'), 'docs/other.md');
  assert.equal(paths.folderPath('/docs/50%20.md', '', false), 'docs/50%20.md');
  assert.equal(paths.folderPath('/docs/why?.md', '', false), 'docs/why?.md');
  assert.throws(() => paths.folderPath('../../private.txt', 'docs/qa.md'));
  assert.throws(() => paths.folderPath('%2e%2e/%2e%2e/private.txt', 'docs/qa.md'));
});

test('heading target survives restoring and rewriting the viewer address', () => {
  const params = new URLSearchParams(paths.viewerParams({ kind: 'folder', rootId: 'root', rootKind: 'dir', entry: 'docs/other.md', anchor: 'target-heading' }));
  assert.equal(params.get('anchor'), 'target-heading');
});

test('active document schemes are rejected', () => {
  for (const input of ['javascript:alert(1)', 'data:text/html,test', 'blob:https://test/id', 'vbscript:test']) {
    assert.equal(paths.resolve(input), null);
  }
  assert.equal(paths.resolve('chrome://settings'), null);
  assert.equal(paths.resolve('#section').kind, 'anchor');
});
