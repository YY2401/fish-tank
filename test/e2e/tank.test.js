'use strict';
/* 水族箱畫面（tank.html）：用真的 Chrome 開，模擬聊天室打指令，檢查魚的狀態 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

if (!H.chromePath()) {
  test('e2e（找不到 Chrome，略過；可用 CHROME_PATH 指定）', { skip: true }, () => {});
} else {
  let srv, browser;
  before(async () => { srv = await H.serve(); browser = await H.launch(); });
  after(async () => { await browser.close(); srv.server.close(); });

  async function open(t, query = '', opts = {}) {
    const page = await H.newPage(browser, opts);
    t.after(() => page.close());
    await page.goto(`${srv.url}/tank.html?demo=1&event=0&tip=0${query}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.FishTank);
    await page.evaluate(() => localStorage.clear());
    return page;
  }
  const chat = (page, login, text, extra = {}) =>
    page.evaluate((login, text, extra) => FishTank.handleChat({ login, display: extra.display || login, text, badges: extra.badges || {}, tags: extra.tags }), login, text, extra);
  const fish = (page, login) => page.evaluate((l) => {
    const f = FishTank.fishes.get(l);
    return f && { species: f.species, color: f.color, size: f.size, state: f.state, x: f.x, y: f.y, say: f.say, unlocked: f.unlocked, leaving: f.leaving, flee: f.flee };
  }, login);
  const advance = (page, sec) => page.evaluate((s) => FishTank.advance(s), sec);
  const peek = (page) => page.evaluate(() => FishTank.peek());
  const many = (page, n, prefix = 'v') => page.evaluate((n, prefix) => { for (let i = 0; i < n; i++) FishTank.handleChat({ login: prefix + i, display: prefix + i, text: '!魚', badges: {} }); }, n, prefix);

  test('載入沒有錯誤；講話就變成魚，聊天內容變成泡泡', async (t) => {
    const page = await open(t);
    await chat(page, 'amy', '哈囉大家');
    const f = await fish(page, 'amy');
    assert.ok(f, '應該有 amy 的魚');
    assert.equal(f.say, '哈囉大家');
    assert.deepEqual(page.errors, []);
  });

  test('auto=0 時要打 !魚 才加入；機器人帳號不會變成魚', async (t) => {
    const page = await open(t, '&auto=0');
    await chat(page, 'bob', '路過');
    assert.equal(await fish(page, 'bob'), undefined);
    await chat(page, 'bob', '!魚');
    assert.ok(await fish(page, 'bob'));
    await chat(page, 'nightbot', '!魚');
    assert.equal(await fish(page, 'nightbot'), undefined);
  });

  test('換魚種、換顏色；重新整理後同一個人外觀還記得', async (t) => {
    const page = await open(t);
    await chat(page, 'amy', '!魚');
    await chat(page, 'amy', '!鯊魚');
    await chat(page, 'amy', '!顏色 粉');
    let f = await fish(page, 'amy');
    assert.equal(f.species, 'shark');
    assert.equal(f.color, '#ff8ccf');
    await H.sleep(800); // 外觀寫進瀏覽器有 0.5 秒延遲
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.FishTank);
    await chat(page, 'amy', '我回來了');
    f = await fish(page, 'amy');
    assert.equal(f.species, 'shark');
    assert.equal(f.color, '#ff8ccf');
  });

  test('稀有魚種：一般觀眾被擋下並說明怎麼解鎖，實況主可以直接用', async (t) => {
    const page = await open(t);
    await chat(page, 'amy', '!魚');
    const before = (await fish(page, 'amy')).species;
    await chat(page, 'amy', '!鯨魚');
    const f = await fish(page, 'amy');
    assert.equal(f.species, before);
    assert.match(f.say, /稀有魚種/);
    await chat(page, 'boss', '!鯨魚', { badges: { broadcaster: true } });
    assert.equal((await fish(page, 'boss')).species, 'whale');
  });

  test('動作：跳出水面再落回、睡覺沉到底、餵食吃了會變大', async (t) => {
    const page = await open(t);
    await chat(page, 'amy', '!魚');
    await advance(page, 3);
    await chat(page, 'amy', '!跳');
    await advance(page, 0.5);
    const { area } = await peek(page);
    assert.ok((await fish(page, 'amy')).y < area.surfaceY, '跳的時候要高過水面');
    await advance(page, 4);
    assert.equal((await fish(page, 'amy')).state, 'swim');

    await chat(page, 'amy', '!睡');
    await advance(page, 15);
    const sleeping = await fish(page, 'amy');
    assert.equal(sleeping.state, 'sleep');
    assert.ok(sleeping.y > area.floorY - 60, '睡覺要沉到底');

    await chat(page, 'amy', '!餵');
    assert.ok((await peek(page)).food > 0);
    await advance(page, 30);
    assert.ok((await fish(page, 'amy')).size > 1, '吃到飼料要變大');
  });

  test('抱抱：游到對方旁邊，結束後恢復閒逛', async (t) => {
    const page = await open(t);
    await chat(page, 'amy', '!魚');
    await chat(page, 'bob', '!魚');
    await advance(page, 2);
    await chat(page, 'amy', '!抱 @bob');
    assert.equal((await fish(page, 'amy')).state, 'hug');
    let done = false;
    for (let i = 0; i < 24 && !done; i++) {
      await advance(page, 0.5);
      done = (await fish(page, 'amy')).state === 'swim';
    }
    assert.ok(done, '12 秒內要抱到');
    const a = await fish(page, 'amy'), b = await fish(page, 'bob');
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 150, '抱完應該在對方旁邊');
  });

  test('大事件：鯊魚讓魚逃跑、漩渦全部捲進去、寶箱讓搶到的魚解鎖稀有魚種', async (t) => {
    const page = await open(t);
    await many(page, 12);
    await advance(page, 3);

    await page.evaluate(() => FishTank.startEvent('shark'));
    assert.match((await peek(page)).banner, /鯊魚出沒/);
    // 鯊魚橫越整個畫面的過程中，至少要有一隻魚逃過
    let fled = false;
    for (let i = 0; i < 20 && !fled; i++) {
      await advance(page, 0.5);
      fled = await page.evaluate(() => [...FishTank.fishes.values()].some((f) => f.flee > 0));
    }
    assert.ok(fled, '鯊魚經過時要有魚逃跑');
    await advance(page, 15);
    assert.equal((await peek(page)).ev, null);

    await page.evaluate(() => FishTank.startEvent('whirl'));
    await advance(page, 2);
    assert.ok(await page.evaluate(() => [...FishTank.fishes.values()].every((f) => f.state === 'whirl' || f.state === 'jump')));
    await advance(page, 8);
    assert.equal((await peek(page)).ev, null);
    assert.ok(await page.evaluate(() => [...FishTank.fishes.values()].every((f) => f.state !== 'whirl')));

    await page.evaluate(() => FishTank.startEvent('treasure'));
    await advance(page, 40);
    const p = await peek(page);
    assert.equal(p.ev, null);
    assert.match(p.banner, /搶到寶箱/);
    assert.equal(await page.evaluate(() => [...FishTank.fishes.values()].filter((f) => f.unlocked.length === 1).length), 1);
  });

  test('接上 Twitch 聊天室（模擬）：一般訊息、訂閱、小奇點、忠誠點品項、揪團', async (t) => {
    const page = await open(t, '&channel=yy2401&rw=rid-1:shark', { twitch: true });
    await page.waitForFunction(() => window.__twitch.sockets.length && window.__twitch.sockets[0].sent.includes('JOIN #yy2401'));
    const say = (line) => page.evaluate((l) => window.__twitch.say(l), line);

    await say('@display-name=小魚;badges= :fan01!fan01@fan01.tmi.twitch.tv PRIVMSG #yy2401 :大家好');
    assert.equal((await fish(page, 'fan01')).say, '大家好');

    await say('@msg-id=sub;login=fan01;display-name=小魚 :tmi.twitch.tv USERNOTICE #yy2401');
    const subbed = await fish(page, 'fan01');
    assert.equal(subbed.unlocked.length, 1);
    assert.equal(subbed.species, subbed.unlocked[0]);

    await say('@bits=100;display-name=金主 :rich!rich@rich.tmi.twitch.tv PRIVMSG #yy2401 :Cheer100 錦鯉');
    assert.equal((await fish(page, 'rich')).species, 'koi');

    await say('@custom-reward-id=rid-1;display-name=路人 :p1!p1@p1.tmi.twitch.tv PRIVMSG #yy2401 :來吧鯊魚');
    assert.equal((await peek(page)).ev, 'shark');

    await say('@msg-id=raid;login=friend;msg-param-login=friend;msg-param-displayName=好朋友;msg-param-viewerCount=30 :tmi.twitch.tv USERNOTICE #yy2401');
    assert.ok((await peek(page)).schools > 0, '揪團要有魚群');
    assert.equal((await fish(page, 'friend')).species, 'whale');
    assert.deepEqual(page.errors, []);
  });

  test('水族箱範圍：魚不會游出範圍，範圍外透明', async (t) => {
    const page = await open(t, '&top=0.5&bottom=0.05&left=0.5&right=0.05');
    await many(page, 20);
    await page.evaluate(() => FishTank.startEvent('shark'));
    for (let i = 0; i < 6; i++) {
      await advance(page, 5);
      const { area } = await peek(page);
      const out = await page.evaluate((a) => [...FishTank.fishes.values()].filter((f) => f.state !== 'jump' && f.state !== 'enter' && (f.x < a.X0 || f.x > a.X1 || f.y < a.Y0 || f.y > a.Y1)).map((f) => f.login), area);
      assert.deepEqual(out, [], '這些魚跑出範圍了');
    }
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), 'rgba(0, 0, 0, 0)');
  });

  test('魚很多時名字和泡泡不重疊，泡泡最多 8 個', async (t) => {
    const page = await open(t);
    await many(page, 40);
    await advance(page, 4);
    await page.evaluate(() => { for (let i = 0; i < 40; i++) FishTank.handleChat({ login: 'v' + i, display: 'v' + i, text: '第 ' + i + ' 句話', badges: {} }); });
    await advance(page, 0.2);
    const placed = (await peek(page)).placed;
    assert.ok(placed.length > 10);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i], b = placed[j];
        const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
        assert.ok(!overlap, `第 ${i} 和第 ${j} 個標籤重疊`);
      }
    }
    assert.ok(placed.filter((p) => p.kind === 'say').length <= 8);
  });

  test('魚太多時最久沒講話的先離開；太久沒講話會自己游走', async (t) => {
    const page = await open(t, '&max=5&idle=1');
    await many(page, 5);
    await advance(page, 1);
    await chat(page, 'late', '!魚');
    assert.equal((await fish(page, 'v0')).leaving, true);
    assert.equal((await fish(page, 'late')).leaving, false);
    await advance(page, 65);
    assert.equal(await page.evaluate(() => [...FishTank.fishes.values()].filter((f) => !f.leaving).length), 0);
  });

  test('Google 試算表同步（模擬）：開頭讀進外觀，改了會寫回', async (t) => {
    const saves = [];
    const sheet = (body) => {
      if (body.key !== 'k1') return { ok: false, error: '暗號不對' };
      if (body.action === 'list') return { ok: true, profiles: { amy: { display: 'Amy', species: 'koi', color: null, size: 1.5, unlocked: ['koi'] } } };
      saves.push(...body.profiles);
      return { ok: true };
    };
    const page = await open(t, '&store=https://script.google.com/macros/s/TEST/exec&skey=k1', { sheet });
    await page.waitForFunction(() => /試算表讀到/.test(document.getElementById('status').textContent));
    await chat(page, 'amy', '嗨');
    const f = await fish(page, 'amy');
    assert.equal(f.species, 'koi');
    assert.equal(f.size, 1.5);
    await chat(page, 'amy', '!顏色 紅');
    await H.sleep(5600); // 每 5 秒寫一次
    const saved = saves.find((p) => p.login === 'amy');
    assert.ok(saved, '要寫回試算表');
    assert.equal(saved.color, '#ff4a4a');
    assert.deepEqual(saved.unlocked, ['koi']);
  });
}
