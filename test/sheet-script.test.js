// 用假的 SpreadsheetApp 跑 sheet-script.gs，確認讀寫邏輯
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function load() {
  const rows = [];
  const sheet = {
    getRange: (a, col, nr, nc) => ({
      setValues: (v) => { if (typeof a === 'number') rows[a - 1] = v[0]; else rows[0] = v[0]; return { setFontWeight() {} }; },
      setNumberFormat() {},
    }),
    setFrozenRows() {},
    getDataRange: () => ({ getValues: () => rows.map((r) => r.slice()) }),
    appendRow: (r) => rows.push(r),
    getLastRow: () => rows.length,
  };
  let created = false;
  const ctx = {
    SpreadsheetApp: { getActive: () => ({ getSheetByName: () => (created ? sheet : null), insertSheet: () => { created = true; return sheet; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => JSON.parse(s) }) },
  };
  const src = fs.readFileSync(path.join(__dirname, '..', 'sheet-script.gs'), 'utf8').replace('__KEY__', 'k1');
  vm.runInNewContext(src, ctx);
  const post = (body) => ctx.doPost({ postData: { contents: JSON.stringify(body) } });
  return { post, rows };
}

test('暗號不對就拒絕', () => {
  const { post } = load();
  assert.deepStrictEqual(post({ key: 'x', action: 'list' }), { ok: false, error: '暗號不對' });
});

test('存了再讀回來，同一個帳號會更新同一列', () => {
  const { post, rows } = load();
  assert.deepStrictEqual(post({ key: 'k1', action: 'list' }), { ok: true, profiles: {} });
  post({ key: 'k1', action: 'save', profiles: [{ login: 'Fan01', display: '粉絲', species: 'whale', color: 'rainbow', size: 1.2, unlocked: ['whale'] }] });
  post({ key: 'k1', action: 'save', profiles: [{ login: 'fan01', display: '粉絲', species: 'koi', color: null, size: 1.3, unlocked: ['whale', 'koi'] }, { login: 'b', species: 'clown', size: 1, unlocked: [] }] });
  assert.strictEqual(rows.length, 3); // 標題 + 2 個人
  const j = post({ key: 'k1', action: 'list' });
  assert.deepStrictEqual(j.profiles.fan01, { display: '粉絲', species: 'koi', color: null, size: 1.3, unlocked: ['whale', 'koi'] });
  assert.strictEqual(j.profiles.b.species, 'clown');
});
