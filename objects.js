/* 魚缸物件：種類、預設顏色、怎麼畫。水族箱畫面和設定頁（物件按鈕的小圖）共用 */
(function (root) {
  const TAU = Math.PI * 2;

  // w、h：大小 1 倍時的寬高（像素，再乘上畫面縮放）；emit：會冒泡泡的位置（相對於物件底部中間）
  const OBJECTS = {
    castle: { name: '城堡', color: '#a99cc0', w: 180, h: 175, emit: [[0, -32]] },
    chest: { name: '寶箱', color: '#a8662e', w: 90, h: 80, emit: [[0, -48]] },
    coral: { name: '珊瑚', color: '#ff7a9a', w: 130, h: 80 },
    bubbler: { name: '打氣石', color: '#5f6b75', w: 36, h: 20, emit: [[0, -12]], fast: true },
    ship: { name: '沉船', color: '#7a5233', w: 280, h: 130, emit: [[40, -60]] },
    helmet: { name: '潛水頭盔', color: '#c8923a', w: 84, h: 86, emit: [[0, -84]] },
    shell: { name: '貝殼', color: '#ffb8a8', w: 54, h: 40 },
    starfish: { name: '海星', color: '#ff8a4a', w: 56, h: 26 },
    rock: { name: '岩石', color: '#7c8792', w: 150, h: 72 },
    plant: { name: '水草叢', color: '#3c9a5c', w: 96, h: 150 },
    anchor: { name: '錨', color: '#7d8a96', w: 80, h: 116 },
    pillar: { name: '遺跡柱', color: '#d8d0bc', w: 64, h: 160 },
  };

  function rgb(hex) {
    const n = parseInt(String(hex).slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // amt > 0 變亮、< 0 變暗
  function shade(hex, amt) {
    const [r, g, b] = rgb(hex);
    const t = amt < 0 ? 0 : 255, a = Math.abs(amt);
    return `rgb(${Math.round(r + (t - r) * a)},${Math.round(g + (t - g) * a)},${Math.round(b + (t - b) * a)})`;
  }
  // 每個物件固定的亂數（同一個物件每次重畫都長一樣）
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 畫一個物件：ctx 已經移到物件底部中間；k 是縮放；c 是主色；img 是自訂物件的圖
  const DRAW = {
    castle(g, c) {
      const stone = g.createLinearGradient(0, -170, 0, 0);
      stone.addColorStop(0, shade(c, 0.15));
      stone.addColorStop(1, shade(c, -0.45));
      g.fillStyle = stone;
      const tower = (tx, w, h) => {
        g.fillRect(tx - w / 2, -h, w, h);
        for (let k = 0; k < 3; k++) g.fillRect(tx - w / 2 + k * (w / 2.5), -h - 9, w / 5, 9);
      };
      tower(0, 99, 88);
      tower(-57, 40, 143);
      tower(57, 40, 143);
      g.fillStyle = '#c4507a';
      for (const tx of [-57, 57]) {
        g.beginPath();
        g.moveTo(tx - 24, -150);
        g.lineTo(tx, -193);
        g.lineTo(tx + 24, -150);
        g.fill();
      }
      g.fillStyle = '#1c1830';
      g.beginPath();
      g.moveTo(-18, 0);
      g.lineTo(-18, -33);
      g.arc(0, -33, 18, Math.PI, 0);
      g.lineTo(18, 0);
      g.fill();
      for (const [wx, wy] of [[-57, 110], [57, 110], [-57, 72], [57, 72]]) {
        g.beginPath();
        g.roundRect(wx - 5.5, -wy, 11, 18, [5, 5, 0, 0]);
        g.fill();
      }
    },
    chest(g, c) {
      const w = 84, h = 40;
      g.fillStyle = shade(c, -0.3);
      g.beginPath();
      g.moveTo(-w / 2, -h);
      g.lineTo(-w / 2 + 7, -h - 40);
      g.lineTo(w / 2 + 7, -h - 40);
      g.lineTo(w / 2, -h);
      g.fill();
      g.fillStyle = '#ffd23f';
      for (let i = 0; i < 9; i++) {
        g.beginPath();
        g.arc(-w / 2 + 12 + i * 7.5, -h - 2 - Math.sin(i * 1.3) * 5, 7, 0, TAU);
        g.fill();
      }
      g.fillStyle = c;
      g.fillRect(-w / 2, -h, w, h);
      g.fillStyle = '#d6a43a';
      g.fillRect(-w / 2, -h, w, 6);
      g.fillRect(-7, -h, 14, 19);
      g.fillRect(-w / 2 + 9, -h, 6, h);
      g.fillRect(w / 2 - 15, -h, 6, h);
    },
    coral(g, c, r) {
      const branch = (bx, by, ang, len, w, color, depth) => {
        const ex = bx + Math.cos(ang) * len, ey = by + Math.sin(ang) * len;
        g.strokeStyle = color;
        g.lineWidth = w;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(bx, by);
        g.lineTo(ex, ey);
        g.stroke();
        if (depth > 0) {
          branch(ex, ey, ang - 0.25 - r() * 0.35, len * 0.75, w * 0.72, color, depth - 1);
          branch(ex, ey, ang + 0.25 + r() * 0.35, len * 0.75, w * 0.72, color, depth - 1);
        }
      };
      branch(-20, 0, -Math.PI / 2 - 0.15, 46, 11, c, 3);
      branch(24, 0, -Math.PI / 2 + 0.2, 35, 9, shade(c, -0.2).replace('rgb', 'rgb'), 3);
      g.fillStyle = shade(c, 0.4);
      for (let i = 0; i < 6; i++) {
        g.beginPath();
        g.arc(-55 + r() * 110, -r() * 7, 3 + r() * 3, 0, TAU);
        g.fill();
      }
    },
    bubbler(g, c) {
      g.fillStyle = c;
      g.beginPath();
      g.ellipse(0, -5, 18, 10, 0, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.beginPath();
      g.ellipse(-5, -9, 7, 3.5, 0, 0, TAU);
      g.fill();
    },
    ship(g, c) {
      g.save();
      g.rotate(-0.12);
      // 船身
      const hull = g.createLinearGradient(0, -90, 0, 0);
      hull.addColorStop(0, shade(c, 0.1));
      hull.addColorStop(1, shade(c, -0.45));
      g.fillStyle = hull;
      g.beginPath();
      g.moveTo(-140, -70);
      g.lineTo(130, -80);
      g.quadraticCurveTo(120, -10, 70, 5);
      g.lineTo(-110, 5);
      g.quadraticCurveTo(-140, -20, -140, -70);
      g.fill();
      // 船板的線
      g.strokeStyle = shade(c, -0.55);
      g.lineWidth = 3;
      for (let i = 1; i < 4; i++) {
        g.beginPath();
        g.moveTo(-135, -70 + i * 18);
        g.lineTo(125, -80 + i * 18);
        g.stroke();
      }
      // 破洞與窗戶
      g.fillStyle = '#10161c';
      g.beginPath();
      g.moveTo(-40, -40);
      g.lineTo(-20, -55);
      g.lineTo(5, -42);
      g.lineTo(-8, -20);
      g.lineTo(-30, -24);
      g.fill();
      for (const x of [40, 70, 100]) {
        g.beginPath();
        g.arc(x, -55, 7, 0, TAU);
        g.fill();
      }
      // 斷掉的桅杆
      g.fillStyle = shade(c, -0.2);
      g.fillRect(-10, -150, 9, 75);
      g.beginPath();
      g.moveTo(-10, -150);
      g.lineTo(-1, -150);
      g.lineTo(6, -162);
      g.lineTo(-4, -156);
      g.fill();
      g.fillStyle = 'rgba(230,220,200,0.55)';
      g.beginPath();
      g.moveTo(-1, -145);
      g.quadraticCurveTo(40, -125, 30, -95);
      g.lineTo(-1, -100);
      g.fill();
      g.restore();
    },
    helmet(g, c) {
      const dome = g.createRadialGradient(-12, -62, 6, 0, -45, 46);
      dome.addColorStop(0, shade(c, 0.45));
      dome.addColorStop(1, shade(c, -0.35));
      g.fillStyle = dome;
      g.beginPath();
      g.arc(0, -44, 38, Math.PI * 0.92, Math.PI * 0.08, false);
      g.lineTo(34, -6);
      g.lineTo(-34, -6);
      g.fill();
      g.fillStyle = shade(c, -0.3);
      g.fillRect(-42, -10, 84, 10);
      // 正面圓窗
      g.fillStyle = shade(c, -0.5);
      g.beginPath();
      g.arc(0, -46, 21, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(120,200,230,0.55)';
      g.beginPath();
      g.arc(0, -46, 15, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.beginPath();
      g.arc(-5, -51, 4, 0, TAU);
      g.fill();
      // 螺絲
      g.fillStyle = shade(c, 0.3);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        g.beginPath();
        g.arc(Math.cos(a) * 21, -46 + Math.sin(a) * 21, 2.4, 0, TAU);
        g.fill();
      }
    },
    shell(g, c) {
      g.fillStyle = c;
      g.beginPath();
      g.moveTo(0, -2);
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI + (i / 8) * Math.PI;
        g.lineTo(Math.cos(a) * 26, -6 + Math.sin(a) * 30);
      }
      g.closePath();
      g.fill();
      g.strokeStyle = shade(c, -0.25);
      g.lineWidth = 2.2;
      for (let i = 1; i < 8; i++) {
        const a = Math.PI + (i / 8) * Math.PI;
        g.beginPath();
        g.moveTo(0, -2);
        g.lineTo(Math.cos(a) * 24, -6 + Math.sin(a) * 27);
        g.stroke();
      }
      g.fillStyle = shade(c, -0.15);
      g.fillRect(-7, -6, 14, 6);
    },
    starfish(g, c) {
      g.save();
      g.translate(0, -12);
      g.scale(1, 0.45); // 平躺在沙上
      g.fillStyle = c;
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 11 : 28;
        i ? g.lineTo(Math.cos(a) * r, Math.sin(a) * r) : g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
      g.fillStyle = shade(c, 0.35);
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * TAU) / 5;
        g.beginPath();
        g.arc(Math.cos(a) * 14, Math.sin(a) * 14, 2.4, 0, TAU);
        g.fill();
      }
      g.restore();
    },
    rock(g, c) {
      const blob = (x, w, h, a) => {
        const gr = g.createLinearGradient(0, -h, 0, 0);
        gr.addColorStop(0, shade(c, 0.12 + a));
        gr.addColorStop(1, shade(c, -0.5));
        g.fillStyle = gr;
        g.beginPath();
        g.ellipse(x, 2, w, h, 0, Math.PI, 0);
        g.fill();
      };
      blob(-35, 45, 52, 0);
      blob(35, 50, 40, 0.05);
      blob(0, 38, 66, 0.1);
    },
    plant(g, c, r) {
      for (let i = 0; i < 7; i++) {
        const x = -36 + i * 12 + r() * 6;
        const h = 90 + r() * 60;
        const lean = (r() - 0.5) * 30;
        g.fillStyle = i % 2 ? c : shade(c, -0.2);
        g.beginPath();
        g.moveTo(x - 6, 0);
        g.quadraticCurveTo(x - 10 + lean, -h * 0.6, x + lean, -h);
        g.quadraticCurveTo(x + 8 + lean * 0.6, -h * 0.55, x + 6, 0);
        g.fill();
      }
    },
    anchor(g, c) {
      g.strokeStyle = c;
      g.fillStyle = c;
      g.lineCap = 'round';
      g.lineWidth = 9;
      g.beginPath();
      g.moveTo(0, -100);
      g.lineTo(0, -12);
      g.stroke();
      g.beginPath();
      g.moveTo(-22, -82);
      g.lineTo(22, -82);
      g.stroke();
      g.beginPath();
      g.arc(0, -108, 9, 0, TAU);
      g.lineWidth = 6;
      g.stroke();
      g.lineWidth = 9;
      g.beginPath();
      g.arc(0, -40, 34, Math.PI * 0.15, Math.PI * 0.85);
      g.stroke();
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(s * 33, -27);
        g.lineTo(s * 40, -40);
        g.lineTo(s * 26, -36);
        g.fill();
      }
      g.fillStyle = shade(c, 0.35);
      g.fillRect(-2, -98, 3, 80);
    },
    pillar(g, c) {
      const body = g.createLinearGradient(-26, 0, 26, 0);
      body.addColorStop(0, shade(c, -0.25));
      body.addColorStop(0.5, shade(c, 0.15));
      body.addColorStop(1, shade(c, -0.35));
      g.fillStyle = shade(c, -0.15);
      g.fillRect(-32, -14, 64, 14);
      g.fillStyle = body;
      g.beginPath();
      g.moveTo(-24, -14);
      g.lineTo(-24, -140);
      g.lineTo(-8, -150);
      g.lineTo(4, -138);
      g.lineTo(14, -156);
      g.lineTo(24, -146);
      g.lineTo(24, -14);
      g.fill();
      g.strokeStyle = shade(c, -0.3);
      g.lineWidth = 2;
      for (const x of [-12, 0, 12]) {
        g.beginPath();
        g.moveTo(x, -18);
        g.lineTo(x, -136);
        g.stroke();
      }
    },
  };

  // 大小 1 倍時的寬高；自訂圖片看圖的長寬比（寬 120）
  function sizeOf(o, img) {
    if (OBJECTS[o.t]) return { w: OBJECTS[o.t].w, h: OBJECTS[o.t].h };
    if (img && img.naturalWidth) return { w: 120, h: (120 * img.naturalHeight) / img.naturalWidth };
    return { w: 120, h: 120 };
  }

  // 畫在 ctx 上：x、y 是物件底部中間（像素），k 是縮放（畫面縮放 × 物件大小）
  function drawObject(ctx, o, x, y, k, img, seed) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(o.f ? -k : k, k);
    if (OBJECTS[o.t]) DRAW[o.t](ctx, o.c || OBJECTS[o.t].color, rng(seed || 1));
    else if (img && img.naturalWidth) {
      const { w, h } = sizeOf(o, img);
      ctx.drawImage(img, -w / 2, -h, w, h);
    }
    ctx.restore();
  }

  root.FishObjects = { OBJECTS, drawObject, sizeOf };
})(self);
