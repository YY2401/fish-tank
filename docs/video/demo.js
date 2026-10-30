'use strict';
/* 功能展示影片：真的錄水族箱在動（不是截圖），底部加字幕。執行：node docs/video/demo.js（需要 ffmpeg） */
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const H = require('../../test/e2e/helpers');

const OUT = path.join(__dirname, '直播水族箱_功能展示_20261031.mp4');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAMES = ['小魚乾', '阿宅不睡覺', 'Momo_TW', '路過的貓', 'kiwi_kiwi', '布丁狗', '大吉大利', 'SunnyDay', '奶茶三分糖', 'Leo0218', '海綿寶寶粉', '雞排不加辣', 'yuki_chan', '熬夜冠軍'];

(async () => {
  const srv = await H.serve();
  const browser = await H.launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.evaluateOnNewDocument(H.FAKE_TWITCH);
  await page.goto(`${srv.url}/tank.html?channel=yy2401&event=0&tip=0&scale=1.4&deco=castle,chest,coral,bubbler`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.FishTank);
  // 字幕列（跟設定教學影片同一個樣式）、隱藏「已連上」提示
  await page.addStyleTag({ content: `.status{display:none!important}
    #cap{position:fixed;left:0;right:0;bottom:0;padding:14px 28px 18px;background:rgba(20,30,42,.88);color:#fff;font:500 24px/1.5 "Noto Sans TC",sans-serif;z-index:99;transition:opacity .3s}` });
  await page.evaluate(() => { const d = document.createElement('div'); d.id = 'cap'; d.style.opacity = 0; document.body.append(d); });
  const cap = (t) => page.evaluate((t) => { const d = document.getElementById('cap'); d.textContent = t; d.style.opacity = t ? 1 : 0; }, t);
  const chat = (i, text, badges = {}) => page.evaluate((login, display, text, badges) => FishTank.handleChat({ login, display, text, badges }), 'v' + i, NAMES[i], text, badges);

  const webm = OUT.replace(/\.mp4$/, '.webm');
  const rec = await page.screencast({ path: webm });

  await cap('觀眾在聊天室打 !魚，就變成一隻魚游進直播畫面');
  for (let i = 0; i < NAMES.length; i++) { await chat(i, '!魚', { sub: i % 4 === 0, vip: i === 7 }); await sleep(300); }
  await sleep(2500);

  await cap('聊天室講的話，會出現在自己那隻魚的頭上');
  for (const [i, t] of [[1, '晚安～'], [4, '這魚缸好可愛'], [7, '我是哪一隻'], [2, '主播加油']]) { await chat(i, t); await sleep(700); }
  await sleep(2200);

  await cap('!鯊魚 !水母 !河豚 換魚種，!顏色 彩虹 換顏色');
  for (const [i, t] of [[0, '!鯊魚'], [3, '!水母'], [5, '!河豚'], [6, '!顏色 彩虹'], [8, '!顏色 粉'], [9, '!神仙魚']]) { await chat(i, t); await sleep(500); }
  await sleep(2500);

  await cap('!跳 !轉 !泡泡 做動作');
  for (const [i, t] of [[1, '!跳'], [6, '!轉'], [5, '!泡泡'], [2, '!跳'], [4, '!轉']]) { await chat(i, t); await sleep(600); }
  await sleep(2500);

  await cap('!餵 撒飼料，大家搶著吃，吃越多長越大');
  await chat(7, '!餵');
  await sleep(600);
  await chat(2, '!餵');
  await sleep(5000);

  await cap('!抱 @名字 游過去給對方抱抱');
  await chat(3, '!抱 @v8');
  await sleep(4500);

  await cap('訂閱、贊助小奇點、搶寶箱，解鎖稀有魚種（鯨魚、獨角鯨、錦鯉）');
  await page.evaluate(() => FishTank.handleChat({ login: 'v1', display: '阿宅不睡覺', notice: true, kind: 'sub' }));
  await sleep(4500);

  await cap('全場大事件：鯊魚出沒！魚會四處逃跑');
  await page.evaluate(() => FishTank.startEvent('shark', { display: 'YY2401' }));
  await page.waitForFunction(() => !FishTank.peek().ev, { timeout: 20000 }); // 鯊魚游走才能開下一個事件
  await sleep(500);

  await cap('大漩渦：全部的魚被捲進去轉');
  await page.evaluate(() => FishTank.startEvent('whirl'));
  await sleep(7000);

  await cap('打開 yy2401.github.io/fish-tank 開始設定，不用安裝、不用登入');
  await sleep(4000);
  await rec.stop();

  // webm → mp4（H.264，一般播放器和社群網站都能播）
  const ff = process.env.FFMPEG_PATH || 'ffmpeg';
  execFileSync(ff, ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', OUT]);
  fs.unlinkSync(webm);
  console.log('影片：', OUT);
  await browser.close();
  srv.server.close();
})();
