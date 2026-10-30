// 用假的 SpreadsheetApp / DriveApp 跑 sheet-script.gs，確認讀寫邏輯
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function load({ oldHeader = false } = {}) {
  const rows = [];
  if (oldHeader) rows.push(['帳號', '顯示名稱', '魚種', '顏色', '大小', '解鎖的稀有魚種', '最後更新']);
  const sheet = {
    getRange: (a, col, nr, nc) => ({
      setValues: (v) => { if (typeof a === 'number') rows[a - 1] = v[0]; return { setFontWeight() {} }; },
      getValues: () => [(rows[(typeof a === 'number' ? a : 1) - 1] || []).slice()],
      setNumberFormat() {},
    }),
    setFrozenRows() {},
    getDataRange: () => ({ getValues: () => rows.map((r) => r.slice()) }),
    appendRow: (r) => rows.push(r),
    getLastRow: () => rows.length,
  };
  let created = oldHeader;
  const files = [];
  const ctx = {
    SpreadsheetApp: { getActive: () => ({ getSheetByName: () => (created ? sheet : null), insertSheet: () => { created = true; return sheet; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => JSON.parse(s) }) },
    Utilities: {
      base64Decode: (s) => [...Buffer.from(s, 'base64')],
      newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
    },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'link' }, Permission: { VIEW: 'view' },
      getFoldersByName: () => ({ hasNext: () => false }),
      createFolder: () => ({ createFile: (blob) => { const f = { id: 'f' + files.length, blob, sharing: null, getId() { return this.id; }, setSharing(a, p) { this.sharing = a + ':' + p; } }; files.push(f); return f; } }),
    },
  };
  const src = fs.readFileSync(path.join(__dirname, '..', 'sheet-script.gs'), 'utf8').replace('__KEY__', 'k1');
  vm.runInNewContext(src, ctx);
  const post = (body) => ctx.doPost({ postData: { contents: JSON.stringify(body) } });
  return { post, rows, files };
}

test('暗號不對就拒絕', () => {
  const { post } = load();
  assert.deepStrictEqual(post({ key: 'x', action: 'list' }), { ok: false, error: '暗號不對' });
});

test('存了再讀回來，同一個帳號會更新同一列，頭像也記得', () => {
  const { post, rows } = load();
  assert.deepStrictEqual(post({ key: 'k1', action: 'list' }), { ok: true, profiles: {} });
  post({ key: 'k1', action: 'save', profiles: [{ login: 'Fan01', display: '粉絲', species: 'whale', color: 'rainbow', size: 1.2, unlocked: ['whale'] }] });
  post({ key: 'k1', action: 'save', profiles: [
    { login: 'fan01', display: '粉絲', species: 'koi', color: null, size: 1.3, unlocked: ['whale', 'koi'], avatar: { kind: 'emote', url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0' }, wear: 'crown', pattern: 'spots', mine: 'https://i.example.com/me.png' },
    { login: 'b', species: 'clown', size: 1, unlocked: [] },
  ] });
  assert.strictEqual(rows.length, 3); // 標題 + 2 個人
  const j = post({ key: 'k1', action: 'list' });
  assert.deepStrictEqual(j.profiles.fan01, { display: '粉絲', species: 'koi', color: null, size: 1.3, unlocked: ['whale', 'koi'], avatar: { kind: 'emote', url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0' }, wear: 'crown', pattern: 'spots', mine: 'https://i.example.com/me.png' });
  assert.strictEqual(j.profiles.b.species, 'clown');
  assert.strictEqual(j.profiles.b.avatar, null);
});

test('舊版試算表（少了後面幾欄）會自動補上標題；不再有上傳圖片', () => {
  const { post, rows } = load({ oldHeader: true });
  post({ key: 'k1', action: 'list' });
  assert.strictEqual(rows[0][7], '頭像');
  assert.strictEqual(rows[0][10], '個人魚圖片');
  assert.deepStrictEqual(post({ key: 'k1', action: 'upload', mime: 'image/png', data: 'AAAA' }), { ok: false, error: '不認得的動作' });
});
