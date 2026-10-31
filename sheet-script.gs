/**
 * 直播水族箱：把每位觀眾的魚（魚種、顏色、大小、解鎖的稀有魚種、頭像、配件、花紋、核准過的個人魚圖片）
 * 存在這份試算表，換電腦、換 OBS 都還記得。也可以直接在試算表改，水族箱每 10 分鐘會重讀一次。
 *
 * 安裝：試算表 → 擴充功能 → Apps Script → 整段貼上 → 部署 → 新增部署作業
 *       → 類型選「網頁應用程式」→ 執行身分「我」、存取權「所有人」→ 部署 → 複製網址貼回設定頁
 */
const KEY = '__KEY__'; // 設定頁複製時自動填入的暗號，OBS 網址裡要有同一組才能讀寫
const SHEET = '水族箱的魚';
const HEAD = ['帳號', '顯示名稱', '魚種', '顏色', '大小', '解鎖的稀有魚種', '最後更新', '頭像', '配件', '花紋', '個人魚圖片', '副色', '配件色', '體型', '名牌', '表情'];

function doGet() {
  return out_({ ok: true, hello: '直播水族箱' });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: '格式錯誤' }); }
  if (body.key !== KEY) return out_({ ok: false, error: '暗號不對' });
  if (body.action === 'list') return out_({ ok: true, profiles: list_() });
  if (body.action === 'save') {
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try { save_(body.profiles || []); } finally { lock.releaseLock(); }
    return out_({ ok: true });
  }
  return out_({ ok: false, error: '不認得的動作' });
}

function sheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.setFrozenRows(1);
    sh.getRange('A:P').setNumberFormat('@'); // 帳號像 0123 這種才不會被當成數字，色碼也不會被改掉
  }
  // 舊版試算表少了後面幾欄的標題，補上
  const head = sh.getRange(1, 1, 1, HEAD.length);
  if (String(head.getValues()[0][HEAD.length - 1]) !== HEAD[HEAD.length - 1]) head.setValues([HEAD]).setFontWeight('bold');
  return sh;
}

// 頭像存成「種類|網址」，例如 emote|https://static-cdn.jtvnw.net/…
function avatarOf_(text) {
  const m = String(text || '').match(/^(emote|pfp)\|(https:\/\/\S+)$/);
  return m ? { kind: m[1], url: m[2] } : null;
}

function list_() {
  const rows = sheet_().getDataRange().getValues().slice(1);
  const out = {};
  rows.forEach(function (r) {
    const login = String(r[0] || '').trim().toLowerCase();
    if (!login) return;
    out[login] = {
      display: String(r[1] || login),
      species: String(r[2] || ''),
      color: String(r[3] || '') || null,
      size: Number(r[4]) || 1,
      unlocked: String(r[5] || '').split(',').map(function (s) { return s.trim(); }).filter(String),
      avatar: avatarOf_(r[7]),
      wear: String(r[8] || '') || null,
      pattern: String(r[9] || '') || null,
      mine: /^https:\/\//.test(String(r[10] || '')) ? String(r[10]) : null,
      color2: String(r[11] || '') || null,
      wearColor: String(r[12] || '') || null,
      sizePick: String(r[13] || '') || null,
      tag: String(r[14] || '') || null,
      face: String(r[15] || '') || null,
    };
  });
  return out;
}

function save_(profiles) {
  const sh = sheet_();
  const data = sh.getDataRange().getValues();
  const index = {};
  data.forEach(function (r, i) { if (i && r[0]) index[String(r[0]).trim().toLowerCase()] = i + 1; });
  const now = new Date();
  profiles.forEach(function (p) {
    const login = String(p.login || '').trim().toLowerCase();
    if (!login) return;
    const avatar = p.avatar && p.avatar.url ? p.avatar.kind + '|' + p.avatar.url : '';
    const row = [login, p.display || login, p.species || '', p.color || '', p.size || 1, (p.unlocked || []).join(','), now, avatar, p.wear || '', p.pattern || '', p.mine || '', p.color2 || '', p.wearColor || '', p.sizePick || '', p.tag || '', p.face || ''];
    if (index[login]) sh.getRange(index[login], 1, 1, row.length).setValues([row]);
    else { sh.appendRow(row); index[login] = sh.getLastRow(); }
  });
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
