const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../task-lists.js'), 'utf8') + '\nglobalThis.tasks = TaskLists;', context);
const tasks = context.tasks;

test('task offsets identify nested, quoted, and repeated tasks in the original source', () => {
  const raw = '# عنوان\r\n\r\n- [ ] یکسان\r\n  - [x] یکسان\r\n> - [X] نقل‌قول\r\n1. [ ] شماره';
  const tokens = Array.from(tasks.prepare(raw).matchAll(/\x00TASK(\d+):([01])\x00/g));
  assert.equal(tokens.length, 4);
  assert.deepEqual(tokens.map((token) => token[2]), ['0', '1', '1', '0']);
  const offset = Number(tokens[1][1]);
  assert.equal(tasks.toggle(raw, offset, false), raw.replace('  - [x]', '  - [ ]'));
});

test('task syntax inside fenced code stays literal and cannot shift following offsets', () => {
  const raw = '- [ ] First\n\n```md\n- [ ] example\n```\n\n- [x] Last';
  const prepared = tasks.prepare(raw);
  assert.ok(prepared.includes('```md\n- [ ] example\n```'));
  const tokens = Array.from(prepared.matchAll(/\x00TASK(\d+):([01])\x00/g));
  assert.equal(tokens.length, 2);
  assert.equal(tasks.toggle(raw, Number(tokens[1][1]), false), raw.replace('- [x] Last', '- [ ] Last'));
});

test('ordinary brackets stay unchanged and stale offsets are rejected', () => {
  assert.equal(tasks.prepare('- [link](test.md)\nText [ ]\n- [q] text'), '- [link](test.md)\nText [ ]\n- [q] text');
  assert.throws(() => tasks.toggle('changed', 4, true));
});
