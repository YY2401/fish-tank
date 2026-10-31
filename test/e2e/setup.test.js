'use strict';
/* 設定頁（index.html）：填設定 → OBS 網址、偵測忠誠點品項、試算表程式碼與測試連線 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const C = require('../../fish-core.js');

if (!H.chromePath()) {
  test('e2e（找不到 Chrome，略過；可用 CHROME_PATH 指定）', { skip: true }, () => {});
} else {
  let srv, browser;
  before(async () => { srv = await H.serve(); browser = await H.launch(); });
  after(async () => { await browser.close(); srv.server.close(); });

  async function open(t, opts = {}) {
    const page = await H.newPage(browser, { width: 1280, height: 900, ...opts });
    t.after(() => page.close());
    await page.goto(`${srv.url}/index.html`, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });
    await openAll(page);
    return page;
  }
  // 設定頁的每一區預設是收起來的（只有基本設定打開）；測試要點裡面的欄位，先全部打開
  const openAll = (page) => page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
  const obsUrl = async (page) => new URL(await page.$eval('#url', (e) => e.value)).searchParams;
  async function typeInto(page, sel, text) {
    await page.click(sel, { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type(sel, text);
  }

  test('填設定產生正確的 OBS 網址；預覽不帶試算表', async (t) => {
    const page = await open(t);
    await typeInto(page, '#channel', 'https://www.twitch.tv/YY2401');
    await page.click('#auto');
    await page.select('#bg', 'none');
    await page.click('[data-area="0.55,0.03,0.6,0.02"]'); // 右下角
    await typeInto(page, '#event', '0');
    await page.click('#objPalette [data-obj="castle"]');
    const p = await obsUrl(page);
    assert.equal(p.get('channel'), 'yy2401');
    assert.equal(p.get('auto'), '0');
    assert.equal(p.get('bg'), 'none');
    assert.deepEqual(['top', 'bottom', 'left', 'right'].map((k) => p.get(k)), ['0.55', '0.03', '0.6', '0.02']);
    assert.equal(p.get('event'), '0');
    assert.deepEqual(C.parseObjects(p.get('objs')).map((o) => o.t), ['chest', 'coral', 'bubbler', 'castle'], '預設三個物件，再加一座城堡');
    assert.ok(!p.has('demo'));
    await page.waitForFunction(() => /demo=1/.test(document.getElementById('preview').src));
    // 全畫面按鈕把範圍清掉
    await page.click('[data-area="0,0,0,0"]');
    assert.ok(!(await obsUrl(page)).has('top'));
    assert.deepEqual(page.errors, []);
  });

  test('重新整理後設定還在', async (t) => {
    const page = await open(t);
    await typeInto(page, '#channel', 'yy2401');
    await typeInto(page, '#bits', '300');
    await page.reload({ waitUntil: 'load' });
    const p = await obsUrl(page);
    assert.equal(p.get('channel'), 'yy2401');
    assert.equal(p.get('bits'), '300');
  });

  test('偵測忠誠點品項（模擬聊天室），選了動作就寫進 OBS 網址', async (t) => {
    const page = await open(t, { twitch: true });
    await typeInto(page, '#channel', 'yy2401');
    await page.waitForFunction(() => /正在偵測/.test(document.getElementById('listenText').textContent));
    await page.evaluate(() => window.__twitch.say('@custom-reward-id=abc-123;display-name=測試觀眾 :v1!v1@v1.tmi.twitch.tv PRIVMSG #yy2401 :鯨魚'));
    await page.waitForSelector('#rewards .reward');
    assert.match(await page.$eval('#rewards .reward b', (e) => e.textContent), /測試觀眾：「鯨魚」/);
    await page.select('#rewards .reward select', 'rare');
    assert.equal((await obsUrl(page)).get('rw'), 'abc-123:rare');
    await page.click('#rewards .reward button'); // 移除
    assert.ok(!(await obsUrl(page)).has('rw'));
  });

  test('試算表：複製的程式碼帶入暗號，測試連線成功後網址帶上試算表', async (t) => {
    let key = null;
    const page = await open(t, { sheet: (body) => { key = body.key; return { ok: true, profiles: { a: {}, b: {} } }; } });
    await page.evaluate(() => { window.__copied = ''; navigator.clipboard.writeText = async (s) => { window.__copied = s; }; });
    await page.click('#copyScript');
    await page.waitForFunction(() => window.__copied.length > 0);
    const code = await page.evaluate(() => window.__copied);
    assert.ok(!code.includes('__KEY__'), '暗號要填進去');
    const k = code.match(/const KEY = '([^']+)'/)[1];
    assert.ok(k.length >= 12);

    await typeInto(page, '#store', 'https://script.google.com/macros/s/TEST/exec');
    await page.click('#testStore');
    await page.waitForFunction(() => /連上了/.test(document.getElementById('storeMsg').textContent));
    assert.equal(key, k, '測試連線要用同一組暗號');
    assert.match(await page.$eval('#storeMsg', (e) => e.textContent), /2 隻魚/);
    const p = await obsUrl(page);
    assert.equal(p.get('store'), 'https://script.google.com/macros/s/TEST/exec');
    assert.equal(p.get('skey'), k);
  });

  test('試算表網址打錯會提醒', async (t) => {
    const page = await open(t);
    await typeInto(page, '#store', 'https://example.com/x');
    await page.click('#testStore');
    assert.match(await page.$eval('#storeMsg', (e) => e.textContent), /script\.google\.com/);
  });

  test('自訂魚種：貼圖片網址加入，名字重複或跟內建魚種撞名會擋；大頭貼開關寫進網址', async (t) => {
    const page = await open(t, { routes: { 'https://img.example.com/': {} } });
    await typeInto(page, '#skinName', '小雞');
    await typeInto(page, '#skinUrl', 'https://img.example.com/chick.png');
    await page.click('#skinAdd');
    assert.deepEqual((await obsUrl(page)).getAll('skin'), ['小雞|https://img.example.com/chick.png']);
    assert.equal(await page.$$eval('#skins .skin', (r) => r.length), 1);

    await typeInto(page, '#skinName', '小雞');
    await typeInto(page, '#skinUrl', 'https://img.example.com/b.png');
    await page.click('#skinAdd');
    assert.match(await page.$eval('#skinMsg', (e) => e.textContent), /已經有/);
    await typeInto(page, '#skinName', '鯊魚');
    await page.click('#skinAdd');
    assert.match(await page.$eval('#skinMsg', (e) => e.textContent), /重複/);
    await typeInto(page, '#skinName', '小狗');
    await typeInto(page, '#skinUrl', 'http://img.example.com/dog.png');
    await page.click('#skinAdd');
    assert.match(await page.$eval('#skinMsg', (e) => e.textContent), /https/);

    await page.click('#pfp');
    assert.equal((await obsUrl(page)).get('pfp'), '0');
    await page.click('#skins .skin button'); // 移除
    assert.deepEqual((await obsUrl(page)).getAll('skin'), []);
    assert.deepEqual(page.errors, []);
  });

  test('自訂魚種：上傳圖片不用任何帳號，縮小後直接放進 OBS 網址', async (t) => {
    const page = await open(t);
    const file = require('node:path').join(require('node:os').tmpdir(), 'fishtank-big.png');
    // 一張 600×400 的圖：上傳後要縮到最寬 160
    const big = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 400; const g = c.getContext('2d'); g.fillStyle = '#ffcc00'; g.fillRect(0, 0, 600, 400); return c.toDataURL('image/png').split(',')[1]; });
    require('node:fs').writeFileSync(file, Buffer.from(big, 'base64'));
    await typeInto(page, '#skinName', '小雞');
    await (await page.$('#skinFile')).uploadFile(file);
    await page.waitForFunction(() => /加好了/.test(document.getElementById('skinMsg').textContent));
    const skin = (await obsUrl(page)).getAll('skin')[0];
    assert.match(skin, /^小雞\|data:image\/(webp|png);base64,/);
    const size = await page.evaluate((u) => new Promise((res) => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.src = u; }), skin.split('|')[1]);
    assert.deepEqual(size, [160, 107]);
    assert.ok(skin.length < 8000, '縮小後的圖要夠小，網址才放得下');
    assert.equal(await page.$eval('#urlMsg', (e) => e.textContent), '');
  });

  test('魚缸外觀：配色、自訂顏色、畫面元素、海草、背景圖片都寫進網址', async (t) => {
    const page = await open(t);
    await page.click('[data-theme="sunset"]');
    let p = await obsUrl(page);
    assert.equal(p.get('theme'), 'sunset');
    assert.ok(!p.has('water'));
    assert.equal(await page.$eval('#colorRow', (e) => getComputedStyle(e).display), 'none', '沒勾「自己選顏色」時不顯示色票');
    await page.click('#customColor');
    assert.notEqual(await page.$eval('#colorRow', (e) => getComputedStyle(e).display), 'none');
    p = await obsUrl(page);
    assert.equal(p.get('water'), '#ff9a6b,#c45a8a,#4a2a6a', '自訂顏色從目前的主題開始');
    assert.equal(p.get('sand'), '#e8b98a');
    assert.equal(p.get('air'), '#ffc58a');
    // 色碼表：點色塊打開色票、點一格就套用；也可以直接打色碼
    const rockField = await page.$$('#colorRow .cf');
    await (await rockField[5].$('.cf-sw')).click();
    await (await rockField[5].$('.cf-grid button:nth-child(1)')).click();
    assert.match((await obsUrl(page)).get('rock'), /^#[0-9a-f]{6}$/);
    const hex = await rockField[8].$('.cf-hex');
    await hex.click({ clickCount: 3 });
    await hex.type('#123abc');
    assert.equal((await obsUrl(page)).get('line'), '#123abc');
    await page.click('#layers input[value="rays"]');
    await page.click('#layers input[value="rocks"]');
    await page.select('#weed', '3');
    await typeInto(page, '#bgimg', 'https://img.example.com/bg.jpg');
    p = await obsUrl(page);
    assert.equal(p.get('hide'), 'rays,rocks');
    assert.equal(p.get('weed'), '3');
    assert.equal(p.get('bgimg'), 'https://img.example.com/bg.jpg');
    await page.click('#submit');
    assert.equal((await obsUrl(page)).get('submit'), '0');
    await page.reload({ waitUntil: 'load' });
    await openAll(page);
    p = await obsUrl(page);
    assert.equal(p.get('theme'), 'sunset', '重新整理後還在');
    assert.equal(p.get('hide'), 'rays,rocks');
    assert.equal(await page.$eval('#layers input[value="rays"]', (e) => e.checked), false);
    assert.deepEqual(page.errors, []);
  });

  test('魚缸物件：加物件、調大小、翻轉、換顏色、刪除，在預覽上拖曳位置也會寫進網址', async (t) => {
    const page = await open(t);
    const objs = async () => C.parseObjects((await obsUrl(page)).get('objs'));
    await page.click('#objPalette [data-obj="ship"]');
    let list = await objs();
    assert.equal(list.length, 4);
    assert.equal(list[3].t, 'ship');
    assert.equal(await page.$eval('#objPanel', (e) => e.hidden), false, '選到剛加的物件');
    assert.equal(await page.$eval('#objName', (e) => e.textContent), '沉船');

    await page.$eval('#objSize', (e) => { e.value = '2'; e.dispatchEvent(new Event('input')); });
    await page.click('#objFlip');
    await page.click('#objColor .cf-sw');
    await page.click('#objColor .cf-grid button:nth-child(13)');
    list = await objs();
    assert.equal(list[3].s, 2);
    assert.equal(list[3].f, true);
    assert.match(list[3].c, /^#[0-9a-f]{6}$/);

    // 預覽是編輯模式：按住沉船拖到左上角
    const frame = await (await page.$('#preview')).contentFrame();
    await frame.waitForFunction(() => window.FishTank && FishTank.objects.length === 4);
    await page.$eval('#preview', (e) => e.scrollIntoView({ block: 'center' })); // 剛才點顏色時頁面捲下去了
    const box = await frame.evaluate(() => FishTank.objectBox(3));
    const rect = await page.$eval('#preview', (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width }; });
    const scale = rect.w / await frame.evaluate(() => innerWidth);
    const from = { x: rect.x + (box.x + box.w / 2) * scale, y: rect.y + (box.y + box.h / 2) * scale };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(rect.x + 40 * scale, rect.y + 200 * scale, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(() => { const p = new URLSearchParams(document.getElementById('url').value.split('?')[1]); return p.get('objs').split('|')[3].split('~')[1] < 0.3; });
    list = await objs();
    assert.ok(list[3].x < 0.3, '拖到左邊');
    assert.notEqual(list[3].y, null, '拖離沙地就浮在水中');

    await page.click('#objFloor');
    assert.equal((await objs())[3].y, null, '放回沙地');
    await page.click('#objDel');
    assert.equal((await objs()).length, 3);
    assert.equal(await page.$eval('#objPanel', (e) => e.hidden), true);
    assert.deepEqual(page.errors, []);
  });

  test('魚缸物件：上傳自己的物件圖，縮小後放進網址', async (t) => {
    const page = await open(t);
    const file = require('node:path').join(require('node:os').tmpdir(), 'fishtank-obj.png');
    const big = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 500; c.height = 500; c.getContext('2d').fillRect(0, 0, 500, 500); return c.toDataURL('image/png').split(',')[1]; });
    require('node:fs').writeFileSync(file, Buffer.from(big, 'base64'));
    await (await page.$('#objFile')).uploadFile(file);
    await page.waitForFunction(() => /img0/.test(document.getElementById('url').value));
    const p = await obsUrl(page);
    assert.equal(p.getAll('oimg').length, 1);
    assert.match(p.getAll('oimg')[0], /^data:image\/(webp|png);base64,/);
    assert.equal(C.parseObjects(p.get('objs'), 1).at(-1).t, 'img0');
    await page.click('#objDel');
    assert.equal((await obsUrl(page)).getAll('oimg').length, 0, '刪掉物件時圖也一起拿掉');
  });

  test('第一次打開：上面有三步驟說明，只有基本設定是打開的', async (t) => {
    const page = await H.newPage(browser, { width: 1280, height: 900 });
    t.after(() => page.close());
    await page.goto(`${srv.url}/index.html`, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });
    assert.match(await page.$eval('.quick', (e) => e.textContent), /三步驟/);
    const open = await page.$$eval('details.sec', (d) => d.map((x) => [x.querySelector('h2').textContent, x.open]));
    assert.deepEqual(open.filter(([, o]) => o).map(([n]) => n), ['1. 基本設定']);
    assert.equal(await page.$eval('#channel', (e) => e.offsetParent !== null), true, '頻道欄位直接看得到');
    assert.equal(await page.$eval('#objPanel', (e) => getComputedStyle(e).display), 'none', '沒選物件時不顯示物件面板');
    await page.click('[data-go="themes"]'); // 三步驟的第 2 步：自動打開配色那一區
    assert.equal(await page.$eval('#secLook details', (d) => d.open), true);
    await page.click('[data-go="channel"]');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'channel');
  });

  test('文字與顏色、指令、手感、大事件：表單改了就寫進網址，「已改幾項」與「還原預設」', async (t) => {
    const page = await open(t);
    await page.select('#secText .gen select', 'kai');
    const shark = await page.$('#secText .gen input[placeholder="鯊魚出沒！快逃！"]');
    await shark.click({ clickCount: 3 });
    await shark.type('大白鯊！');
    const row = async (name) => (await page.$$('#cmds .cmd')).find(async () => true) && (await page.evaluateHandle((n) => [...document.querySelectorAll('#cmds .cmd')].find((r) => r.querySelector('span').textContent === n), name)).asElement();
    await (await (await row('睡覺')).$('input[type=checkbox]')).click(); // 關掉「睡覺」
    const jump = await (await row('跳')).$('input[type=text]');
    assert.equal(await jump.evaluate((e) => e.value), '跳、jump', '叫法欄位直接填好目前的值');
    await jump.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await jump.type('蹦、hop');
    await page.$eval('#secTune .gen input[type=range]', (e) => { e.value = '2'; e.dispatchEvent(new Event('input')); });
    await (await page.$('#secEvent .multi input[value="treasure"]')).click();
    let p = await obsUrl(page);
    assert.equal(p.get('font'), 'kai');
    assert.equal(p.get('x_shark'), '大白鯊！');
    assert.equal(p.get('off'), 'sleep');
    assert.equal(p.get('c_jump'), '蹦,hop');
    assert.equal(p.get('cd'), '2');
    assert.equal(p.get('ev'), 'shark,whirl');
    assert.equal(await page.$eval('#secText .changed', (e) => e.textContent), '已改 2 項');
    assert.equal(await page.$eval('#secTune .changed', (e) => e.textContent), '已改 3 項');
    const table = await page.$eval('#cmdTable', (e) => [...e.rows].filter((r) => !r.hidden).map((r) => r.cells[0].textContent).join(' | '));
    assert.match(table, /!蹦 !衝 !轉 !泡泡/, '觀眾指令表換成新叫法、拿掉關掉的 !睡');
    await page.evaluate(() => { window.confirm = () => true; }); // 「確定要還原嗎？」直接按確定
    await page.click('#secTune .reset button');
    p = await obsUrl(page);
    assert.ok(!p.has('off') && !p.has('c_jump') && !p.has('cd'), '還原預設');
    assert.equal(await page.$eval('#secTune .changed', (e) => e.textContent), '');
    assert.equal(await (await (await row('睡覺')).$('input[type=checkbox]')).evaluate((e) => e.checked), true);
    assert.deepEqual(page.errors.filter((e) => !/native dialog/.test(e)), []);
  });

  test('即時同步：開著設定頁改配色，OBS 裡的水族箱馬上換；設定頁顯示已更新；暗號不對不收', async (t) => {
    const page = await open(t);
    await typeInto(page, '#channel', 'yy2401');
    const url = await page.$eval('#url', (e) => e.value);
    const p = new URLSearchParams(url.split('?')[1]);
    assert.ok(p.get('room') && p.get('key') && p.get('t'));
    // 同一個瀏覽器開「OBS 的水族箱」（測試裡走 BroadcastChannel）
    const tank = await H.newPage(browser, { twitch: true });
    t.after(() => tank.close());
    await tank.goto(`${srv.url}/tank.html?${p.toString()}`, { waitUntil: 'load' });
    await tank.waitForFunction(() => window.FishTank, { polling: 100 });
    await page.waitForFunction(() => /OBS 的水族箱已連上|直播畫面已更新/.test(document.getElementById('liveText').textContent), { polling: 100 });
    await page.bringToFront(); // 開了第二個分頁後設定頁在背景，背景分頁不能用滑鼠點
    await page.click('[data-theme="candy"]');
    await tank.waitForFunction(() => FishTank.opt.themeId === 'candy', { timeout: 5000, polling: 100 });
    await page.waitForFunction(() => /直播畫面已更新/.test(document.getElementById('liveText').textContent), { polling: 100 });
    // 改文字也會即時套用
    await page.$eval('#secText .gen input[placeholder="水族箱指令"]', (e) => { e.value = '來玩吧'; e.dispatchEvent(new Event('input')); });
    await tank.waitForFunction(() => document.querySelector('#help h2').textContent === '來玩吧', { timeout: 5000, polling: 100 });
    // 重開 OBS（重新整理）：用最後一次即時同步的設定
    await tank.reload({ waitUntil: 'load' });
    await tank.waitForFunction(() => window.FishTank, { polling: 100 });
    assert.equal(await tank.evaluate(() => FishTank.opt.themeId), 'candy');
    // 暗號不對的假訊息
    const fake = await tank.evaluate(async (room) => {
      const m = await FishCore.signMessage('wrong-key', { type: 'cfg', q: 'theme=deep', mid: 'x1' });
      new BroadcastChannel('fishtank:' + room).postMessage(m);
      await new Promise((r) => setTimeout(r, 300));
      return FishTank.opt.themeId;
    }, p.get('room'));
    assert.equal(fake, 'candy', '暗號不對的訊息丟掉');
    // 關掉即時同步就不送
    await page.bringToFront();
    await page.click('#live');
    await page.click('[data-theme="deep"]');
    await H.sleep(800);
    assert.equal(await tank.evaluate(() => FishTank.opt.themeId), 'candy');
    assert.deepEqual(tank.errors, []);
  });
}
