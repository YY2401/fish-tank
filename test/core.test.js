const test = require('node:test');
const assert = require('node:assert');
const C = require('../fish-core.js');

test('指令解析：中英別名、魚種直打、@對象', () => {
  assert.deepStrictEqual(C.parseCommand('!魚'), { cmd: 'join', arg: '', target: null });
  assert.strictEqual(C.parseCommand('！跳').cmd, 'jump');
  assert.deepStrictEqual(C.parseCommand('!鯊魚'), { cmd: 'skin', arg: 'shark', target: null });
  assert.strictEqual(C.findSpecies(C.parseCommand('!變 河豚').arg), 'puffer');
  assert.strictEqual(C.parseCommand('!抱 @Some_User 你好').target, 'some_user');
  assert.strictEqual(C.parseCommand('哈囉'), null);
  assert.strictEqual(C.parseCommand('!不存在'), null);
});

test('顏色：名稱、#hex、三碼', () => {
  assert.strictEqual(C.findColor('紅色'), '#ff4a4a');
  assert.strictEqual(C.findColor('#66CCFF'), '#66ccff');
  assert.strictEqual(C.findColor('6cf'), '#66ccff');
  assert.strictEqual(C.findColor('彩虹'), 'rainbow');
  assert.strictEqual(C.findColor('不知道'), null);
});

test('冷卻', () => {
  const m = {};
  assert.ok(C.cooldownOk(m, 'a', 'jump', 0));
  assert.ok(!C.cooldownOk(m, 'a', 'jump', 1000));
  assert.ok(C.cooldownOk(m, 'b', 'jump', 1000));
  assert.ok(C.cooldownOk(m, 'a', 'jump', 5000));
});

test('IRC 解析', () => {
  const m = C.parseIrc('@badges=broadcaster/1,subscriber/0;color=#FF0000;display-name=小魚\\s測試;mod=0 :yy2401!yy2401@yy2401.tmi.twitch.tv PRIVMSG #yy2401 :!跳 一下');
  assert.strictEqual(m.command, 'PRIVMSG');
  assert.strictEqual(m.login, 'yy2401');
  assert.strictEqual(m.channel, 'yy2401');
  assert.strictEqual(m.text, '!跳 一下');
  assert.strictEqual(m.tags['display-name'], '小魚 測試');
  assert.deepStrictEqual(C.badgesOf(m.tags), { broadcaster: true, mod: false, vip: false, sub: true });
  assert.strictEqual(C.parseIrc(':a!a@a PRIVMSG #c :\u0001ACTION 揮手\u0001').text, '揮手');
});

test('網址參數', () => {
  const o = C.readOptions('?channel=%23YY2401&auto=0&bg=none&top=0.6&scale=9');
  assert.strictEqual(o.channel, 'yy2401');
  assert.strictEqual(o.auto, false);
  assert.strictEqual(o.bg, 'none');
  assert.strictEqual(o.top, 0.6);
  assert.strictEqual(o.scale, 3);
  assert.ok(o.ignore.includes('nightbot'));
});

test('稀有魚種：挑沒解鎖的、想要的優先、全部有了回傳 null', () => {
  assert.deepStrictEqual(C.RARE_IDS, ['whale', 'narwhal', 'koi']);
  assert.strictEqual(C.pickRare([], 'koi'), 'koi');
  assert.strictEqual(C.pickRare(['koi'], 'koi', () => 0), 'whale');
  assert.strictEqual(C.pickRare(['whale', 'narwhal', 'koi']), null);
  assert.ok(!C.RARE_IDS.includes(C.defaultSpecies('someone')));
  assert.deepStrictEqual(C.parseCommand('!獨角鯨'), { cmd: 'skin', arg: 'narwhal', target: null });
});

test('忠誠點品項對應：解析與還原，不認得的動作丟掉', () => {
  const m = C.parseRewards('abc-1:rare,def-2:shark,bad:nope,:rare');
  assert.deepStrictEqual(m, { 'abc-1': 'rare', 'def-2': 'shark' });
  assert.strictEqual(C.stringifyRewards(m), 'abc-1:rare,def-2:shark');
});

test('訂閱／送訂閱／揪團通知', () => {
  const sub = C.parseIrc('@msg-id=resub;login=fan01;display-name=粉絲 :tmi.twitch.tv USERNOTICE #yy2401 :好久不見');
  assert.deepStrictEqual(C.noticeOf(sub), { kind: 'sub', login: 'fan01', display: '粉絲' });
  const gift = C.parseIrc('@msg-id=subgift;login=boss;msg-param-recipient-user-name=lucky;msg-param-recipient-display-name=Lucky :tmi.twitch.tv USERNOTICE #yy2401');
  assert.deepStrictEqual(C.noticeOf(gift), { kind: 'sub', login: 'lucky', display: 'Lucky' });
  const raid = C.parseIrc('@msg-id=raid;login=friend;msg-param-displayName=Friend;msg-param-login=friend;msg-param-viewerCount=42 :tmi.twitch.tv USERNOTICE #yy2401');
  assert.deepStrictEqual(C.noticeOf(raid), { kind: 'raid', login: 'friend', display: 'Friend', viewers: 42 });
  assert.strictEqual(C.noticeOf(C.parseIrc('@msg-id=announcement :tmi.twitch.tv USERNOTICE #yy2401 :hi')), null);
});

test('新網址參數', () => {
  const o = C.readOptions('?rw=abc:rare&bits=0&subs=0&event=0&deco=castle,nope&store=https://evil.com/x&skey=k');
  assert.deepStrictEqual(o.rewards, { abc: 'rare' });
  assert.strictEqual(o.bits, 0);
  assert.strictEqual(o.subs, false);
  assert.strictEqual(o.event, 0);
  assert.deepStrictEqual(o.deco, ['castle']);
  assert.strictEqual(o.store, ''); // 只接受 Google Apps Script 網址
  const d = C.readOptions('');
  assert.deepStrictEqual(d.deco, ['chest', 'coral', 'bubbler']);
  assert.strictEqual(d.event, 15);
});

test('水族箱範圍：預設全畫面、留白太多時等比例縮小', () => {
  const d = C.readOptions('');
  assert.deepStrictEqual([d.top, d.bottom, d.left, d.right], [0, 0, 0, 0]);
  const o = C.readOptions('?top=0.6&left=0.5&right=0.5');
  assert.strictEqual(o.top, 0.6);
  assert.strictEqual(o.bottom, 0);
  assert.ok(Math.abs(o.left - 0.425) < 1e-9 && Math.abs(o.right - 0.425) < 1e-9);
});
