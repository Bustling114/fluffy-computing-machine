/* 离屏 canvas 探针（解析式版）：直接问 camera.js「你往画布上画了什么」
   为什么需要它：无头 Chrome 的截图看不清暗部细节，靠肉眼判断
   「电梯井到底画出来了没有」只会在黑色背景上瞎猜。这里用一个假的
   Canvas2D 把每次绘制按"面积 × 亮度"累加起来，再按区域统计，用数字说话。

   实现取舍：不做真实像素栅格化，而是维护两张累加表
     cover[i]  = 这个像素被"实体"画过几次（矩形类）
     lum[i]    = 这个像素累积的 R+G+B 亮度（矩形与光晕都算）
   矩形按 4x 变换换算成设备像素面积直接累加；光晕按圆的面积 × 中心色 alpha
   近似累加。这样既快，又不受"变换写在哪个坐标系"这类细节干扰。

   用法：node _test/canvas.js
*/
'use strict';

function makeCtx(w, h) {
  const W = w, H = h;
  const cover = new Float32Array(W * H);
  const lum = new Float32Array(W * H);
  const draws = [];
  const stack = [];
  let st = { tx: 0, ty: 0, sx: 1, sy: 1, alpha: 1 };

  function parseCol(c) {
    if (typeof c !== 'string') return [0, 0, 0, 1];
    if (c[0] === '#') {
      let s = c.slice(1);
      if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
      const n = parseInt(s, 16);
      if (isNaN(n)) return [0, 0, 0, 1];
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
    }
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (m) {
      const p = m[1].split(',').map(v => parseFloat(v));
      return [p[0] | 0, p[1] | 0, p[2] | 0, p.length > 3 ? p[3] : 1];
    }
    return [0, 0, 0, 1];
  }

  /* 往累加表里加一个设备像素矩形 */
  function addRect(x0, y0, x1, y1, r, g, b, a, solid) {
    const ax = Math.max(0, Math.floor(x0)), ay = Math.max(0, Math.floor(y0));
    const bx = Math.min(W, Math.ceil(x1)), by = Math.min(H, Math.ceil(y1));
    if (bx <= ax || by <= ay) return 0;
    let n = 0;
    for (let y = ay; y < by; y++) {
      const row = y * W;
      for (let x = ax; x < bx; x++) {
        if (solid) cover[row + x] += 1;
        lum[row + x] += (r + g + b) * a;
        n++;
      }
    }
    return n;
  }

  return {
    canvas: { width: W, height: H },
    _cover: cover,
    _lum: lum,
    _draws: draws,
    globalAlpha: 1,
    fillStyle: '#000',
    font: '', textBaseline: '',
    asShape: false,                        // 探针内部用：fill() 时按路径包围盒画
    save() { stack.push(Object.assign({}, st)); },
    restore() { if (stack.length) st = stack.pop(); },
    setTransform(a, b, c, d, e, f) { st = { tx: e, ty: f, sx: a, sy: d, alpha: this.globalAlpha }; },
    translate(x, y) { st.tx += x * st.sx; st.ty += y * st.sy; },
    fillRect(x, y, w, h) {
      const alpha = (this.globalAlpha === undefined ? 1 : this.globalAlpha) * st.alpha;
      draws.push(['fillRect', +x.toFixed(1), +y.toFixed(1), +w.toFixed(1), +h.toFixed(1),
                  String(this.fillStyle).slice(0, 24), +alpha.toFixed(3)]);
      const fs = this.fillStyle;
      if (fs && fs._circle) {              // glow()：渐变当圆铺
        const [cx, cy, r] = fs._circle;
        const [rr, gg, bb, aa] = parseCol(fs._c);
        const A = aa * alpha;
        // 圆的亮度按 1 - d/r 衰减，等效平均 alpha = aa/3
        const x0 = st.tx + (cx - r) * st.sx, y0 = st.ty + (cy - r) * st.sy;
        const x1 = st.tx + (cx + r) * st.sx, y1 = st.ty + (cy + r) * st.sy;
        const area = (x1 - x0) * (y1 - y0) * 0.785;
        addRect(x0, y0, x1, y1, rr, gg, bb, A / 3, false);
        return;
      }
      const [rr, gg, bb, aa] = parseCol(fs);
      const A = aa * alpha;
      const x0 = Math.min(x, x + w), x1 = Math.max(x, x + w);
      const y0 = Math.min(y, y + h), y1 = Math.max(y, y + h);
      addRect(st.tx + x0 * st.sx, st.ty + y0 * st.sy,
              st.tx + x1 * st.sx, st.ty + y1 * st.sy, rr, gg, bb, A, A >= 0.85);
    },
    createLinearGradient() { return { addColorStop() {}, _c: '#000' }; },
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      const self = { _c: '#000', _circle: [x1, y1, r1] };
      self.addColorStop = (o, c) => { if (o === 0) self._c = c; };
      return self;
    },
    createImageData(w2, h2) { return { width: w2, height: h2, data: new Uint8ClampedArray(w2 * h2 * 4) }; },
    getImageData(x, y, w2, h2) { return { width: w2, height: h2, data: new Uint8ClampedArray(w2 * h2 * 4) }; },
    putImageData() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, ellipse() {}, stroke() {}, fill() {},
    drawImage() {},
    measureText() { return { width: 10 }; },
    fillText(s, x, y) { draws.push(['text', String(s), +x.toFixed(1), +y.toFixed(1), String(this.fillStyle)]); },
  };
}

function installDom() {
  global.document = {
    getElementById: () => null,
    createElement(tag) {
      if (tag !== 'canvas') return {};
      const c = { width: 170, height: 96, style: {} };
      c.getContext = () => makeCtx(c.width, c.height);
      return c;
    },
    addEventListener: () => {}, removeEventListener: () => {},
  };
  global.window = { addEventListener: () => {}, removeEventListener: () => {}, innerWidth: 1440, innerHeight: 900 };
  global.requestAnimationFrame = () => 0;
}

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  installDom();
  for (const f of ['audio.js', 'visitor.js', 'camera.js', 'registry.js', 'events.js']) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), { filename: f });
  }
  const Cam = vm.runInThisContext('Cameras');

  const screen = { width: 680, height: 384, style: {} };
  const ctx = makeCtx(680, 384);
  screen.getContext = () => ctx;
  Cam.attach(screen);

  const CW = 680, CH = 384;
  function stats(x0, y0, x1, y1) {
    let n = 0, lum = 0, total = 0;
    const ax = Math.max(0, x0 * 4), ay = Math.max(0, y0 * 4);
    const bx = Math.min(CW, x1 * 4), by = Math.min(CH, y1 * 4);
    for (let y = ay; y < by; y++) {
      for (let x = ax; x < bx; x++) {
        const i = y * CW + x;
        total++;
        if (ctx._cover[i] > 0) n++;
        lum += ctx._lum[i];
      }
    }
    return { n, total, lum: +lum.toFixed(1) };
  }

  function look(label, cam, visual, elevator, region) {
    ctx._cover.fill(0);
    ctx._lum.fill(0);
    ctx._draws.length = 0;
    Cam.render({
      cam: cam, people: [], elevator: elevator || 0,
      visual: Object.assign({ time: 2.5 }, visual || {}),
      targetFloor: 12, showFloor: 12, shake: 0, overlay: 'none', tint: null,
    }, 0.016);
    const s = stats(region[0], region[1], region[2], region[3]);
    console.log('  ' + label.padEnd(22) + ' 实体像素=' + String(s.n).padStart(6) +
                '  亮度总量=' + String(s.lum).padStart(10));
    return s;
  }

  let fail = 0;
  const warn = (s) => { fail++; console.log('  ✗ ' + s); };
  const ok = (s) => console.log('  ✓ ' + s);

  console.log('── 楼梯间 · 电梯井效果（区域 x120-170, y14-82）──');
  const R_STAIR = [120, 14, 170, 82];
  const sBase = look('无电梯', 'stair', {}, 0, R_STAIR);
  const sLow = look('电梯在低层 0.15', 'stair', {}, 0.15, R_STAIR);
  const sHigh = look('电梯在高层 0.95', 'stair', {}, 0.95, R_STAIR);
  if (sHigh.lum <= sBase.lum * 1.2) warn('电梯上行时右侧墙面没有明显变亮');
  else ok('电梯上行让墙面变亮（亮度总量 ' + sBase.lum + ' → ' + sHigh.lum + '）');
  if (Math.abs(sLow.lum - sHigh.lum) < 200) warn('电梯位置变化没有带来亮度差（这道光应该是会动的）');
  else ok('亮度随电梯位置变化（0.15 时 ' + sLow.lum + '，0.95 时 ' + sHigh.lum + '）');

  console.log('');
  console.log('── 走廊 · 灯闪 / 门缝 / 安全出口（区域 x20-160, y0-30 覆盖顶灯）──');
  const R_CORR = [20, 0, 160, 30];
  const cBase = look('平静', 'lobby2', {}, 0, R_CORR);
  const cFlick = look('灯闪', 'lobby2', { flicker: true }, 0, R_CORR);
  const R_CORR2 = [40, 24, 160, 70];
  const cBase2 = look('平静（墙与门）', 'lobby2', {}, 0, R_CORR2);
  const cAjar = look('门开一条缝', 'lobby2', { ajar: true }, 0, R_CORR2);
  const cExit = look('安全出口闪绿', 'lobby2', { exitPulse: true }, 0, R_CORR2);
  if (Math.abs(cFlick.lum - cBase.lum) < 100) warn('灯闪没有改变画面亮度');
  else ok('灯闪改变了亮度（' + cBase.lum + ' → ' + cFlick.lum + '）');
  if (cAjar.lum <= cBase2.lum) warn('门缝没画出来');
  else ok('门缝画出来了（亮度 ' + cBase2.lum + ' → ' + cAjar.lum + '）');
  if (cExit.lum <= cBase2.lum) warn('安全出口的绿光没画出来');
  else ok('安全出口的绿光画出来了（亮度 ' + cBase2.lum + ' → ' + cExit.lum + '）');

  console.log('');
  console.log('── 门厅 · 电梯门（区域 x55-95, y20-70）──');
  const R_LOBBY = [55, 20, 95, 70];
  const lBase = look('平静', 'lobby', {}, 0, R_LOBBY);
  const lDoor = look('电梯门开着', 'lobby', { elevatorDoor: true }, 0, R_LOBBY);
  if (lDoor.n === lBase.n && Math.abs(lDoor.lum - lBase.lum) < 50) warn('电梯门没有变化');
  else ok('电梯门有变化（实体像素 ' + lBase.n + ' → ' + lDoor.n + '，亮度 ' + lBase.lum + ' → ' + lDoor.lum + '）');

  console.log('');
  console.log('── 大门外 · 对讲机红灯 / 对面窗灯（区域 x55-75, y45-60）──');
  const R_GATE = [55, 45, 75, 60];
  const gBase = look('平静', 'gate', {}, 0, R_GATE);
  const gInter = look('对讲机响', 'gate', { intercom: true }, 0, R_GATE);
  if (gInter.lum <= gBase.lum) warn('对讲机红灯没画出来');
  else ok('对讲机红灯画出来了（' + gBase.lum + ' → ' + gInter.lum + '）');
  const R_WIN = [100, 10, 168, 40];
  // 对面楼的窗是逐帧随机点亮的（Math.random() < 0.62），
  // 所以比"总量涨没涨"之前必须把随机数钉死，否则基线每次都不一样。
  const realRandom = Math.random;
  Math.random = () => 0;
  const wBase = look('对面窗灯都在', 'gate', {}, 0, R_WIN);
  const wOut = look('对面灭了一扇窗', 'gate', { windowOut: true }, 0, R_WIN);
  Math.random = realRandom;
  if (wOut.lum >= wBase.lum) warn('对面窗灯没有变暗');
  else ok('对面窗灯确实灭了一扇（' + wBase.lum + ' → ' + wOut.lum + '）');

  console.log('');
  console.log(fail ? '结果：' + fail + ' 处问题' : '结果：画面级事件全部确实落在了画布上');
  process.exit(fail ? 1 : 0);
} else {
  module.exports = { makeCtx };
}
