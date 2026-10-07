/* ══════════════════════════════════════════════════════════
   camera.js — 监控画面渲染（像素风 Canvas）
   逻辑分辨率 170×96，由主画布放大 4 倍，保持像素颗粒
   ══════════════════════════════════════════════════════════ */

const Cameras = (() => {

  const W = 170, H = 96;

  const CAMS = [
    { id: 'gate',  name: '大门外',   short: '门外',   desc: '单元门外的街道与人行道',
      tone: '#8fa6c4', ceiling: 10 },
    { id: 'lobby', name: '一层门厅', short: '门厅',   desc: '门厅、电梯与楼梯口',
      tone: '#9fb0a8', ceiling: 0 },
    { id: 'stair', name: '楼梯间',   short: '楼梯',   desc: '贯通上下层的楼梯井',
      tone: '#8496a6', ceiling: 0 },
    { id: 'lobby2',name: '楼层走廊', short: '走廊',   desc: '电梯厅与住户走廊',
      tone: '#a3aeb8', ceiling: 0 },
  ];

  const SKY = '#0d1622', SKY2 = '#1b2a3a';
  const WALL_A = '#2b3138', WALL_B = '#232830', WALL_C = '#191d23';
  const FLOOR_A = '#2e333a', FLOOR_B = '#242830', FLOOR_C = '#1a1e24';
  const CEIL = '#12161b', METAL = '#39414b', METAL_D = '#242a32';
  const LIGHT = '#ffe9b0', DOOR = '#3a2b23', DOOR_D = '#2a1f19';

  let ctx = null;
  let time = 0;
  let glitchCanvas = null;
  let noiseCache = [];

  function attach(canvas) {
    ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // 预生成噪声贴片
    glitchCanvas = document.createElement('canvas');
    glitchCanvas.width = W; glitchCanvas.height = H;
    const g = glitchCanvas.getContext('2d');
    const img = g.createImageData(W, H);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
      img.data[i + 3] = Math.random() < 0.55 ? 255 : 0;
    }
    g.putImageData(img, 0, 0);

    // 若干帧雪花，用于故障
    for (let k = 0; k < 6; k++) {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const cc = c.getContext('2d');
      const im = cc.createImageData(W, H);
      for (let i = 0; i < im.data.length; i += 4) {
        const v = Math.random() * 255;
        im.data[i] = im.data[i + 1] = im.data[i + 2] = v;
        im.data[i + 3] = 255;
      }
      cc.putImageData(im, 0, 0);
      noiseCache.push(c);
    }
  }

  /* ─────────── 基础绘制工具 ─────────── */

  function rect(x, y, w, h, col) {
    ctx.fillStyle = col;
    ctx.fillRect(x | 0, y | 0, Math.max(1, w | 0), Math.max(1, h | 0));
  }

  function grad(x0, y0, x1, y1, stops) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    stops.forEach(s => g.addColorStop(s[0], s[1]));
    return g;
  }

  function px(x, y, col, size) {
    size = size || 1;
    ctx.fillStyle = col;
    ctx.fillRect(x | 0, y | 0, size, size);
  }

  function glow(cx, cy, r, col, alpha) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  }

  function text(str, x, y, col, size) {
    ctx.fillStyle = col;
    ctx.font = (size || 6) + 'px "Consolas","Courier New",monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(str, x | 0, y | 0);
  }

  /* ═══════════════════════════════════════════════════════
     人 物 绘 制
     ═══════════════════════════════════════════════════════ */

  /**
   * 在 (fx, fy) 处绘制一个人物
   * fx = 脚底中心的 x 坐标，fy = 脚底 y 坐标
   * scale: 摄像机远近缩放
   * a: appearance 对象
   * opt: { walk: 0..1 走路相位, phase: 全局相位, facing: 1/-1, alpha: 1 }
   */
  function drawPerson(fx, fy, scale, a, opt) {
    opt = opt || {};
    const t = opt.phase !== undefined ? opt.phase : time;
    const facing = opt.facing || 1;
    const walk = opt.walk || 0;
    const H0 = 30;                       // 基准身高（像素）
    const h = H0 * (a.hScale || 1) * scale;
    const sh = 1 - (1 - (a.sScale || 1)) * 0.35;   // 横向收窄（柔和）
    const hw = 6.2 * sh * scale;         // 半肩宽

    const headR = 3.6 * scale * sh;
    const legLen = h * 0.42;
    const torsoH = h * 0.33;
    const headCY = fy - h + headR;

    ctx.save();

    // 幽灵 / 闪烁
    if (a.ghostly) ctx.globalAlpha = (a.skinAlpha || 0.55) * (opt.alpha || 1);
    else if (a.flicker) {
      const f = Math.sin(t * 13) * Math.sin(t * 4.7);
      ctx.globalAlpha = (f > 0.55 ? 0.35 : 1) * (opt.alpha || 1);
    } else if (opt.alpha !== undefined) ctx.globalAlpha = opt.alpha;

    /* 影子 */
    if (a.shadow !== 0) {
      const dir = a.shadow < 0 ? facing * -1 : facing * 1;
      const off = 5 * scale * dir;
      ctx.fillStyle = 'rgba(0,0,0,0.42)';
      ctx.beginPath();
      ctx.ellipse(fx + off, fy + 0.5 * scale, 7.5 * scale * sh, 2.1 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const hipY = fy - legLen;
    const shoulderY = hipY - torsoH;

    /* 腿 */
    const swing = walk * 3.2 * scale;
    ctx.fillStyle = a.pantsColor;
    // 左腿
    rect(fx - hw * 0.55 - swing, hipY, 2.5 * scale * sh, legLen, a.pantsColor);
    // 右腿
    rect(fx + hw * 0.15 + swing, hipY, 2.5 * scale * sh, legLen, a.pantsColor);
    // 鞋
    rect(fx - hw * 0.7 - swing, fy - 1.6 * scale, 4 * scale * sh, 1.7 * scale, a.shoeColor);
    rect(fx + hw * 0.05 + swing, fy - 1.6 * scale, 4 * scale * sh, 1.7 * scale, a.shoeColor);

    /* 躯干 */
    const torsoW = hw * 2;
    ctx.fillStyle = a.coatColor;
    ctx.fillRect(Math.round(fx - hw), Math.round(shoulderY), Math.round(torsoW), Math.round(torsoH + 1));
    // 衣领阴影
    rect(fx - hw, shoulderY, torsoW, 1.2 * scale, shade(a.coatColor, -0.28));

    /* 手臂 */
    const armSwing = walk * 2.4 * scale * (a.limbHack ? -1 : 1);
    ctx.fillStyle = shade(a.coatColor, -0.2);
    rect(fx - hw - 1.6 * scale * sh, shoulderY + 1, 1.8 * scale * sh, torsoH * 0.95, shade(a.coatColor, -0.2));
    rect(fx + hw - 0.2 * scale * sh, shoulderY + 1 + armSwing, 1.8 * scale * sh, torsoH * 0.95, shade(a.coatColor, -0.2));

    /* 手 */
    const handY = shoulderY + torsoH * 0.95;
    rect(fx - hw - 1.6 * scale * sh, handY - armSwing, 1.7 * scale, 1.9 * scale, a.skin);
    rect(fx + hw - 0.2 * scale * sh, handY + armSwing, 1.7 * scale, 1.9 * scale, a.skin);

    /* 脖子 */
    const neckOff = facing * (a.headTurn || 0) * 0.8 * scale * sh;
    rect(fx - 1.2 * scale + neckOff, shoulderY - 1.6 * scale, 2.4 * scale, 2.2 * scale, shade(a.skin, -0.18));

    /* 头 */
    const headCX = fx + facing * (a.headTurn || 0) * 1.55 * scale * sh;
    ctx.fillStyle = a.skin;
    ctx.beginPath();
    ctx.ellipse(headCX, headCY, headR * 0.92, headR, 0, 0, Math.PI * 2);
    ctx.fill();

    /* 头发 */
    drawHair(headCX, headCY, headR, a, facing);

    /* 脸 */
    ctx.globalAlpha = ctx.globalAlpha * 1;
    const faceX = headCX + facing * headR * 0.28;
    const eyeGap = headR * 0.42;
    const eyeY = headCY - headR * 0.05;

    if (a.inkEyes) {
      // 纯黑眼窝
      px(faceX - eyeGap - 0.7 * scale, eyeY - 0.7 * scale, '#000', Math.max(2, 1.6 * scale));
      px(faceX + eyeGap - 0.7 * scale, eyeY - 0.7 * scale, '#000', Math.max(2, 1.6 * scale));
      px(faceX - eyeGap - 0.2 * scale, eyeY - 0.2 * scale, '#3a0000', Math.max(1, scale * 0.8));
      px(faceX + eyeGap - 0.2 * scale, eyeY - 0.2 * scale, '#3a0000', Math.max(1, scale * 0.8));
    } else {
      const blink = (Math.sin(t * 0.9 + opt.seed) > 0.985) ? 0.25 : 1;
      const eh = Math.max(1, 1.3 * scale * blink);
      px(faceX - eyeGap - 0.6 * scale, eyeY, '#f2f0ec', Math.max(2, 1.3 * scale));
      px(faceX + eyeGap - 0.6 * scale, eyeY, '#f2f0ec', Math.max(2, 1.3 * scale));
      px(faceX - eyeGap - 0.3 * scale, eyeY + 0.2 * scale, '#111', Math.max(1, scale * 0.75));
      px(faceX + eyeGap - 0.3 * scale, eyeY + 0.2 * scale, '#111', Math.max(1, scale * 0.75));
    }

    // 多出来的眼睛（压在脸颊/下颌一侧，避开头发覆盖区，确保一眼可见）
    if (a.extraEyes > 0) {
      for (let i = 0; i < a.extraEyes; i++) {
        const ex = headCX - facing * headR * 0.66;
        const ey = headCY + headR * 0.16 + i * 2.6 * scale;
        px(ex, ey, '#f2f0ec', Math.max(2, 1.4 * scale));
        px(ex + 0.25 * scale, ey + 0.25 * scale, '#111', Math.max(1, scale * 0.75));
      }
    }

    // 嘴
    if (!a.props.mask) {
      if (a.mouth === 'open' || a.extraMouth) {
        rect(faceX - 0.9 * scale, headCY + headR * 0.42, 2.2 * scale, 1.5 * scale, '#3a1414');
      } else {
        rect(faceX - 0.9 * scale, headCY + headR * 0.48, 2.0 * scale, Math.max(1, 0.7 * scale), '#6b3a3a');
      }
    }
    // 第二张嘴
    if (a.extraMouth) {
      rect(headCX - facing * headR * 0.6, headCY + headR * 0.15, 2.0 * scale, 1.8 * scale, '#3a1414');
      rect(headCX - facing * headR * 0.6 + 0.3 * scale, headCY + headR * 0.15 + 0.3 * scale, 1.4 * scale, 0.7 * scale, '#e8ddd0');
    }

    /* 领口污渍 */
    if (a.collarStain) {
      ctx.fillStyle = 'rgba(78,14,14,0.85)';
      ctx.beginPath();
      ctx.ellipse(fx + 0.5 * scale, shoulderY + 2 * scale, 2.6 * scale, 1.4 * scale, 0.4, 0, Math.PI * 2);
      ctx.fill();
    }

    /* 道具 */
    drawProps(fx, fy, scale, a, facing, t);

    ctx.restore();
  }

  function drawHair(cx, cy, r, a, facing) {
    const col = a.hairColor;
    if (a.props.hat) {
      rect(cx - r * 1.25, cy - r * 0.95, r * 2.5, r * 0.6, '#22262b');
      rect(cx - r * 0.95, cy - r * 1.45, r * 1.9, r * 0.8, '#2b3036');
      return;
    }
    if (a.props.hood) {
      ctx.fillStyle = shade(a.coatColor, 0.12);
      ctx.beginPath();
      ctx.ellipse(cx, cy - r * 0.18, r * 1.5, r * 1.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.ellipse(cx + facing * r * 0.34, cy + r * 0.06, r * 0.92, r * 0.86, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (a.hairStyle === 'bald') {
      px(cx - r * 0.5, cy - r * 0.85, shade(a.skin, -0.12), Math.round(r * 1.1));
      return;
    }

    if (a.hairRise) {
      ctx.fillStyle = col;
      for (let i = -2; i <= 2; i++) {
        rect(cx + i * r * 0.4, cy - r * 2.4 - Math.abs(i) * r * 0.3, 1.2, r * 1.7, col);
      }
    }

    ctx.fillStyle = col;
    if (a.hairStyle === 'short') {
      ctx.fillRect(cx - r * 0.98, cy - r * 1.12, r * 1.96, r * 0.78);
    } else if (a.hairStyle === 'bob') {
      ctx.fillRect(cx - r * 1.12, cy - r * 1.15, r * 2.24, r * 0.8);
      ctx.fillRect(cx - r * 1.12, cy - r * 1.15, r * 0.35, r * 1.7);
      ctx.fillRect(cx + r * 0.77, cy - r * 1.15, r * 0.35, r * 1.7);
    } else if (a.hairStyle === 'long') {
      ctx.fillRect(cx - r * 1.1, cy - r * 1.2, r * 2.2, r * 0.85);
      ctx.fillRect(cx - r * 1.15, cy - r * 1.2, r * 0.4, r * 3.1);
      ctx.fillRect(cx + r * 0.75, cy - r * 1.2, r * 0.4, r * 3.1);
    } else if (a.hairStyle === 'bun') {
      ctx.fillRect(cx - r * 1.0, cy - r * 1.1, r * 2.0, r * 0.7);
      ctx.beginPath();
      ctx.arc(cx, cy - r * 1.5, r * 0.5, 0, Math.PI * 2);
      ctx.fill();
    } else { // messy
      ctx.fillRect(cx - r * 1.05, cy - r * 1.1, r * 2.1, r * 0.72);
      px(cx - r * 1.1, cy - r * 1.45, col, Math.round(r * 0.6));
      px(cx + r * 0.6, cy - r * 1.5, col, Math.round(r * 0.6));
    }
  }

  function drawProps(fx, fy, scale, a, facing, t) {
    const p = a.props || {};

    if (p.mask) {
      rect(fx - 2.6 * scale, fy - 30 * scale * (a.hScale || 1) + 3.0 * scale,
           5.2 * scale, 2.6 * scale, '#d6ecf5');
    }
    if (p.glasses) {
      const eyeY = fy - 30 * scale * (a.hScale || 1) + 1.7 * scale;
      rect(fx - 3.0 * scale, eyeY - 0.4 * scale, 2.4 * scale, 0.9 * scale, '#0d0f12');
      rect(fx + 0.6 * scale, eyeY - 0.4 * scale, 2.4 * scale, 0.9 * scale, '#0d0f12');
      rect(fx - 0.6 * scale, eyeY - 0.3 * scale, 1.2 * scale, 0.6 * scale, '#0d0f12');
    }
    if (p.vest) {
      const shoulderY = fy - 30 * scale * (a.hScale || 1) * 0.33 - 30 * scale * (a.hScale || 1) * 0.42;
      rect(fx - 4.2 * scale, shoulderY + 2 * scale, 8.4 * scale, 1.4 * scale, '#d8e04a');
      rect(fx - 4.2 * scale, shoulderY + 6 * scale, 8.4 * scale, 1.4 * scale, '#d8e04a');
    }
    if (p.pet) {
      const bx = fx + facing * 6 * scale;
      const by = fy - 12 * scale;
      ctx.fillStyle = '#3a3f45';
      ctx.beginPath();
      ctx.ellipse(bx, by, 4.2 * scale, 3.4 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      rect(bx - 3 * scale, by - 5.5 * scale, 1.2 * scale, 2.6 * scale, '#3a3f45');
      rect(bx + 1.8 * scale, by - 5.5 * scale, 1.2 * scale, 2.6 * scale, '#3a3f45');
    }
    if (p.suitcase) {
      const bx = fx + facing * 7 * scale;
      rect(bx - 3.4 * scale, fy - 9 * scale, 6.8 * scale, 8.4 * scale, '#4a3a30');
      rect(bx - 3.4 * scale, fy - 5.6 * scale, 6.8 * scale, 1.0 * scale, '#2e241d');
      rect(bx - 1.2 * scale, fy - 11 * scale, 2.4 * scale, 2.2 * scale, '#5a4a3c');
    }
    if (p.parcel) {
      const bx = fx - facing * 1 * scale;
      rect(bx - 6 * scale, fy - 17 * scale, 7 * scale, 6 * scale, '#7a6444');
      rect(bx - 5 * scale, fy - 23 * scale, 6 * scale, 6 * scale, '#8a7250');
      rect(bx - 4 * scale, fy - 28 * scale, 5 * scale, 5 * scale, '#7a6444');
    }
    if (p.cast) {
      rect(fx + facing * 1.4 * scale, fy - 9 * scale, 3.2 * scale, 8 * scale, '#d8d4c8');
    }
    if (p.hunch) {
      // 由 hScale 体现，这里加一个驼背的弧顶
      rect(fx - 4 * scale, fy - 24 * scale, 8 * scale, 2 * scale, shade(a.coatColor, 0.08));
    }
    if (p.wet) {
      ctx.fillStyle = 'rgba(120,160,190,0.18)';
      ctx.fillRect(fx - 5 * scale, fy - 30 * scale * (a.hScale || 1), 10 * scale, 30 * scale * (a.hScale || 1));
    }
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amt < 0) { r *= (1 + amt); g *= (1 + amt); b *= (1 + amt); }
    else { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    return '#' + (((1 << 24) + (r << 16 | 0) + (g << 8 | 0) + b) | 0).toString(16).slice(1);
  }

  /* ═══════════════════════════════════════════════════════
     证件照绘制（基线外观，永远正常）
     ═══════════════════════════════════════════════════════ */

  function drawPhoto(canvas, app) {
    const c = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, w, h);

    // 证件照底色
    const bg = c.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#9aa6b0');
    bg.addColorStop(1, '#7d8994');
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);

    // 用独立上下文画人（等比放大）
    const scale = w / 46;
    const feetY = h - 8;
    const cx = w / 2;

    c.save();
    c.translate(cx, 0);
    // 借用主 ctx 的绘制函数需要切换上下文，这里单独实现一份简版
    drawPersonTo(c, 0, feetY, scale, app, { facing: 1, phase: 0, walk: 0 });
    c.restore();

    // 证件照边缘做旧
    c.fillStyle = 'rgba(0,0,0,0.10)';
    c.fillRect(0, 0, w, 6);
    c.strokeStyle = 'rgba(255,255,255,0.18)';
    c.lineWidth = 1;
    c.strokeRect(0.5, 0.5, w - 1, h - 1);
  }

  // 把人体绘制到任意上下文（证件照用），逻辑与 drawPerson 一致但更简化
  function drawPersonTo(c, fx, fy, scale, a, opt) {
    const H0 = 30;
    const h = H0 * (a.hScale || 1) * scale;
    const sh = 1 - (1 - (a.sScale || 1)) * 0.35;
    const hw = 6.2 * sh * scale;
    const headR = 3.6 * scale * sh;
    const legLen = h * 0.42;
    const torsoH = h * 0.33;
    const hipY = fy - legLen;
    const shoulderY = hipY - torsoH;
    const headCY = fy - h + headR;

    if (a.shadow !== 0) {
      c.fillStyle = 'rgba(0,0,0,0.28)';
      c.beginPath();
      c.ellipse(fx, fy + 1, 7 * scale * sh, 2 * scale, 0, 0, Math.PI * 2);
      c.fill();
    }

    c.fillStyle = a.pantsColor;
    c.fillRect(fx - hw * 0.55, hipY, 2.5 * scale * sh, legLen);
    c.fillRect(fx + hw * 0.15, hipY, 2.5 * scale * sh, legLen);
    c.fillStyle = a.shoeColor;
    c.fillRect(fx - hw * 0.7, fy - 1.7 * scale, 4 * scale * sh, 1.8 * scale);
    c.fillRect(fx + hw * 0.05, fy - 1.7 * scale, 4 * scale * sh, 1.8 * scale);

    c.fillStyle = a.coatColor;
    c.fillRect(fx - hw, shoulderY, hw * 2, torsoH + 1);

    c.fillStyle = shade(a.coatColor, -0.2);
    c.fillRect(fx - hw - 1.6 * scale * sh, shoulderY + 1, 1.8 * scale * sh, torsoH * 0.95);
    c.fillRect(fx + hw - 0.2 * scale * sh, shoulderY + 1, 1.8 * scale * sh, torsoH * 0.95);
    c.fillStyle = a.skin;
    c.fillRect(fx - hw - 1.6 * scale * sh, shoulderY + torsoH * 0.95 - 1, 1.7 * scale, 1.9 * scale);
    c.fillRect(fx + hw - 0.2 * scale * sh, shoulderY + torsoH * 0.95 - 1, 1.7 * scale, 1.9 * scale);

    c.fillStyle = shade(a.skin, -0.18);
    c.fillRect(fx - 1.2 * scale, shoulderY - 1.6 * scale, 2.4 * scale, 2.2 * scale);

    c.fillStyle = a.skin;
    c.beginPath();
    c.ellipse(fx, headCY, headR * 0.92, headR, 0, 0, Math.PI * 2);
    c.fill();

    // 头发
    const col = a.hairColor;
    c.fillStyle = col;
    if (a.props.hat) {
      c.fillStyle = '#22262b';
      c.fillRect(fx - headR * 1.25, headCY - headR * 0.95, headR * 2.5, headR * 0.6);
      c.fillStyle = '#2b3036';
      c.fillRect(fx - headR * 0.95, headCY - headR * 1.45, headR * 1.9, headR * 0.8);
    } else if (a.props.hood) {
      c.fillStyle = shade(a.coatColor, 0.12);
      c.beginPath();
      c.ellipse(fx, headCY - headR * 0.18, headR * 1.5, headR * 1.42, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(0,0,0,0.5)';
      c.beginPath();
      c.ellipse(fx + headR * 0.34, headCY + headR * 0.06, headR * 0.9, headR * 0.84, 0, 0, Math.PI * 2);
      c.fill();
    } else if (a.hairStyle === 'bald') {
      c.fillStyle = shade(a.skin, -0.1);
      c.fillRect(fx - headR * 0.5, headCY - headR * 0.9, headR, headR * 0.5);
    } else if (a.hairStyle === 'long') {
      c.fillRect(fx - headR * 1.1, headCY - headR * 1.2, headR * 2.2, headR * 0.85);
      c.fillRect(fx - headR * 1.15, headCY - headR * 1.2, headR * 0.4, headR * 3.1);
      c.fillRect(fx + headR * 0.75, headCY - headR * 1.2, headR * 0.4, headR * 3.1);
    } else if (a.hairStyle === 'bob') {
      c.fillRect(fx - headR * 1.12, headCY - headR * 1.15, headR * 2.24, headR * 0.8);
      c.fillRect(fx - headR * 1.12, headCY - headR * 1.15, headR * 0.35, headR * 1.7);
      c.fillRect(fx + headR * 0.77, headCY - headR * 1.15, headR * 0.35, headR * 1.7);
    } else if (a.hairStyle === 'bun') {
      c.fillRect(fx - headR, headCY - headR * 1.1, headR * 2, headR * 0.7);
      c.beginPath();
      c.arc(fx, headCY - headR * 1.5, headR * 0.5, 0, Math.PI * 2);
      c.fill();
    } else {
      c.fillRect(fx - headR * 1.05, headCY - headR * 1.1, headR * 2.1, headR * 0.72);
    }

    // 五官
    const eyeGap = headR * 0.42;
    const eyeY = headCY - headR * 0.05;
    if (a.inkEyes) {
      c.fillStyle = '#000';
      c.fillRect(fx - eyeGap - 0.7 * scale, eyeY - 0.7 * scale, 1.7 * scale, 1.7 * scale);
      c.fillRect(fx + eyeGap - 0.7 * scale, eyeY - 0.7 * scale, 1.7 * scale, 1.7 * scale);
    } else {
      c.fillStyle = '#f2f0ec';
      c.fillRect(fx - eyeGap - 0.6 * scale, eyeY, 1.4 * scale, 1.3 * scale);
      c.fillRect(fx + eyeGap - 0.6 * scale, eyeY, 1.4 * scale, 1.3 * scale);
      c.fillStyle = '#111';
      c.fillRect(fx - eyeGap - 0.3 * scale, eyeY + 0.2 * scale, 0.8 * scale, 0.8 * scale);
      c.fillRect(fx + eyeGap - 0.3 * scale, eyeY + 0.2 * scale, 0.8 * scale, 0.8 * scale);
    }
    if (!a.props.mask) {
      c.fillStyle = '#6b3a3a';
      c.fillRect(fx - 0.9 * scale, headCY + headR * 0.48, 2 * scale, 0.7 * scale);
    }
    if (a.props.mask) {
      c.fillStyle = '#d6ecf5';
      c.fillRect(fx - 2.6 * scale, headCY + headR * 0.15, 5.2 * scale, headR * 0.85);
    }
    if (a.props.glasses) {
      c.fillStyle = '#0d0f12';
      c.fillRect(fx - eyeGap - 1.2 * scale, eyeY - 0.4 * scale, 2.4 * scale, 0.9 * scale);
      c.fillRect(fx + eyeGap - 1.2 * scale, eyeY - 0.4 * scale, 2.4 * scale, 0.9 * scale);
    }
    if (a.props.pet) {
      c.fillStyle = '#3a3f45';
      c.beginPath();
      c.ellipse(fx + 6 * scale, fy - 12 * scale, 4.2 * scale, 3.4 * scale, 0, 0, Math.PI * 2);
      c.fill();
    }
    if (a.props.vest) {
      c.fillStyle = '#d8e04a';
      c.fillRect(fx - hw, shoulderY + 3 * scale, hw * 2, 1.4 * scale);
      c.fillRect(fx - hw, shoulderY + 7 * scale, hw * 2, 1.4 * scale);
    }
    if (a.props.cast) {
      c.fillStyle = '#d8d4c8';
      c.fillRect(fx + 1.4 * scale, fy - 9 * scale, 3.2 * scale, 8 * scale);
    }
  }

  /* ═══════════════════════════════════════════════════════
     场 景 绘 制
     ═══════════════════════════════════════════════════════ */

  function bgGate() {
    // 天空
    ctx.fillStyle = grad(0, 0, 0, 46, [[0, SKY], [1, SKY2]]);
    ctx.fillRect(0, 0, W, 46);

    // 月亮
    ctx.fillStyle = '#dfe8f0';
    ctx.beginPath(); ctx.arc(140, 13, 4.4, 0, Math.PI * 2); ctx.fill();
    glow(140, 13, 16, 'rgba(200,220,240,0.35)', 0.5);

    // 远处楼房
    const blocks = [[4, 30, 16, 16], [22, 24, 13, 22], [37, 33, 11, 13],
                    [50, 27, 15, 19], [122, 28, 14, 18], [138, 22, 18, 24],
                    [158, 31, 12, 15]];
    blocks.forEach((b, i) => {
      rect(b[0], b[1], b[2], b[3], i % 2 ? '#111a25' : '#0d151f');
      // 亮着的窗
      for (let wy = b[1] + 2; wy < b[1] + b[3] - 2; wy += 4) {
        for (let wx = b[0] + 2; wx < b[0] + b[2] - 2; wx += 4) {
          if (Math.random() < 0.62) {
            rect(wx, wy, 1.6, 2, Math.random() < 0.25 ? '#f0d488' : '#5d7385');
          }
        }
      }
    });

    // 地面
    rect(0, 46, W, H - 46, '#191d23');
    rect(0, 46, W, 3, '#242a31');

    // 人行道
    rect(0, 62, W, 20, '#2a2f36');
    for (let x = 0; x < W; x += 13) rect(x, 62, 1, 20, '#22272d');
    rect(0, 62, W, 1.5, '#3a4149');

    // 马路
    rect(0, 82, W, 14, '#20242a');
    for (let x = 2; x < W; x += 16) rect(x, 88, 8, 1.4, '#3d444c');

    // 单元门
    drawEntrance();

    // 路灯
    px(30, 20, '#2b3036', 2);
    rect(30, 22, 1.6, 42, '#2b3036');
    rect(26, 18, 10, 3, '#333a42');
    glow(31, 21, 22, 'rgba(255,225,160,0.30)', 0.55);
    rect(28, 20, 6, 1.4, LIGHT);
  }

  function drawEntrance() {
    // 门洞
    rect(68, 22, 34, 56, '#1b2028');
    // 双开玻璃门
    rect(71, 26, 28, 52, '#26313c');
    rect(72, 27, 12.4, 50, '#1d2833');
    rect(85.6, 27, 12.4, 50, '#1d2833');
    rect(84.6, 26, 1.4, 52, METAL);
    // 玻璃反光
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#bcd6ea';
    ctx.beginPath();
    ctx.moveTo(73, 76); ctx.lineTo(83, 27); ctx.lineTo(88, 27); ctx.lineTo(78, 76);
    ctx.fill();
    ctx.globalAlpha = 1;
    // 门把手
    rect(82, 48, 1, 5, '#8b939c');
    rect(87, 48, 1, 5, '#8b939c');
    // 门顶灯
    rect(80, 22, 10, 2, '#2b3036');
    rect(81, 23, 8, 1, LIGHT);
    glow(85, 24, 16, 'rgba(255,225,160,0.35)', 0.6);
    // 雨棚
    rect(60, 16, 50, 4, '#1d2229');
    rect(60, 20, 50, 1.4, '#2a3138');
    // 门牌
    rect(90, 54, 8, 4, '#39414b');
    text('C-3', 90.4, 54.6, '#c8d2dc', 4);
    // 台阶
    rect(66, 78, 38, 3, '#2c3238');
    rect(62, 81, 46, 2.4, '#252b31');
  }

  function bgLobby() {
    // 远墙
    rect(0, 0, W, H, '#151a20');
    rect(38, 18, 94, 52, WALL_A);
    rect(38, 18, 94, 2, '#333a43');

    // 天花与地板
    ctx.fillStyle = grad(0, 0, 0, 40, [[0, '#0d1116'], [1, '#1c2229']]);
    ctx.fillRect(0, 0, W, 40);
    ctx.fillStyle = grad(0, 62, 0, H, [[0, '#2a2f37'], [1, '#1a1e24']]);
    ctx.fillRect(0, 62, W, H - 62);

    // 侧墙透视
    ctx.fillStyle = '#1e242b';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(38, 18); ctx.lineTo(38, 70); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1b2128';
    ctx.beginPath(); ctx.moveTo(W, 0); ctx.lineTo(132, 18); ctx.lineTo(132, 70); ctx.lineTo(W, H); ctx.closePath(); ctx.fill();

    // 地砖透视线
    for (let i = 1; i <= 8; i++) {
      const y = 62 + i * i * 0.5;
      rect(0, y, W, 0.8, '#232830');
    }

    // 电梯
    rect(58, 22, 26, 48, METAL_D);
    rect(59, 23, 24, 46, '#2f3740');
    rect(60, 24, 22, 44, '#3a434d');
    rect(70.5, 24, 1, 44, METAL_D);
    // 电梯指示灯
    rect(66, 19, 10, 4, '#14181d');
    text('1F', 69.4, 19.4, '#7ef0a8', 4);
    // 门缝光
    rect(70.8, 24, 0.5, 44, '#1a1f25');

    // 楼梯口
    rect(100, 26, 22, 44, '#12161b');
    ctx.fillStyle = '#20262d';
    for (let i = 0; i < 7; i++) {
      ctx.fillRect(101 + i * 0.6, 66 - i * 5.6, 20 - i * 1.2, 5.6);
      ctx.fillStyle = i % 2 ? '#252c34' : '#1e242b';
    }
    rect(100, 26, 22, 2, '#333a43');

    // 门厅吊灯
    [[62, 6], [85, 6], [108, 6]].forEach(p => {
      rect(p[0], p[1], 6, 2, '#3a424a');
      rect(p[0] + 0.5, p[1] + 2, 5, 1, LIGHT);
      glow(p[0] + 3, p[1] + 4, 18, 'rgba(255,232,170,0.22)', 0.55);
    });

    // 前台
    rect(6, 56, 26, 6, '#3a2f26');
    rect(6, 62, 26, 14, '#2e251e');
    rect(6, 55, 26, 1.4, '#4a3d31');

    // 门厅公告板
    rect(14, 22, 18, 22, '#2b2119');
    rect(15, 23, 16, 20, '#3a3226');
    for (let i = 0; i < 5; i++) rect(16, 25 + i * 3.6, 6 + (i % 3) * 3, 2, '#b8bfae');

    // 大楼铭牌
    text('温 岸 公 寓', 60, 10, '#4d5866', 6);
  }

  function bgStair() {
    rect(0, 0, W, H, '#0b0e12');

    // 三层楼梯口，越远越暗
    const landings = [
      { x: 50, y: 14, w: 70, h: 62, s: 1.0, tw: '#242b33' },
      { x: 62, y: 22, w: 46, h: 44, s: 0.72, tw: '#1c2229' },
      { x: 70, y: 28, w: 30, h: 30, s: 0.52, tw: '#151a20' },
    ];

    landings.forEach((L, idx) => {
      rect(L.x, L.y, L.w, L.h, L.tw);
      // 楼梯踏步
      ctx.fillStyle = idx === 0 ? '#2b323a' : '#22282f';
      const steps = 6;
      for (let i = 0; i < steps; i++) {
        const sy = L.y + L.h - 8 - i * (L.h * 0.34 / steps) - 12;
        ctx.fillRect(L.x + 3, sy, L.w - 8, L.h * 0.34 / steps);
        ctx.fillStyle = idx === 0 ? '#232a32' : '#1c2229';
      }
      // 扶手
      rect(L.x + 2, L.y + L.h * 0.42, 2, L.h * 0.5, idx === 0 ? '#4a525c' : '#333a43');
      // 顶层灯
      if (idx === 0) {
        rect(L.x + 8, L.y + 2, 8, 2, LIGHT);
        glow(L.x + 12, L.y + 5, 22, 'rgba(255,230,160,0.22)', 0.6);
      }
      if (idx === 2) {
        glow(L.x + L.w / 2, L.y + L.h / 2, 12, 'rgba(120,160,200,0.15)', 0.5);
      }
      // 门
      rect(L.x + L.w - 14, L.y + L.h - 30, 10, 26, '#1a1f26');
    });

    // 楼梯井阴影
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(50, 14); ctx.lineTo(50, 76); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(W, 0); ctx.lineTo(120, 14); ctx.lineTo(120, 76); ctx.lineTo(W, H); ctx.closePath(); ctx.fill();

    // 墙面水渍
    for (let i = 0; i < 14; i++) {
      rect(4 + Math.random() * 12, 10 + Math.random() * 60, 1 + Math.random() * 3, 2 + Math.random() * 10,
           'rgba(30,26,22,0.5)');
    }
  }

  function bgCorridor(targetFloor, showFloor) {
    rect(0, 0, W, H, '#12161c');

    // 走廊尽头
    rect(48, 26, 74, 44, '#1c2229');
    rect(48, 26, 74, 2, '#2c333b');

    // 天花 / 地板透视
    ctx.fillStyle = grad(0, 0, 0, 30, [[0, '#0c1015'], [1, '#1a2027']]);
    ctx.fillRect(0, 0, W, 30);
    ctx.fillStyle = grad(0, 66, 0, H, [[0, '#272d34'], [1, '#161a20']]);
    ctx.fillRect(0, 66, W, H - 66);

    // 侧墙
    ctx.fillStyle = '#1f252c';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(48, 26); ctx.lineTo(48, 70); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1c2229';
    ctx.beginPath(); ctx.moveTo(W, 0); ctx.lineTo(122, 26); ctx.lineTo(122, 70); ctx.lineTo(W, H); ctx.closePath(); ctx.fill();

    // 两侧住户门（近大远小）
    const floorNo = String(showFloor || targetFloor || 8).padStart(2, '0');
    const doors = [
      { y: 30, h: 40, w: 13, x: 4,   n: '1' },
      { y: 32, h: 34, w: 11, x: 21,  n: '2' },
      { y: 34, h: 28, w: 9,  x: 34,  n: '3' },
      { y: 30, h: 40, w: 13, x: 153, n: '4' },
      { y: 32, h: 34, w: 11, x: 138, n: '5' },
      { y: 34, h: 28, w: 9,  x: 127, n: '6' },
    ];
    doors.forEach((d, i) => {
      rect(d.x, d.y, d.w, d.h, DOOR);
      rect(d.x, d.y, d.w, 1.4, '#4a3830');
      rect(d.x + d.w - 1.6, d.y + 1.4, 1.6, d.h - 1.4, DOOR_D);
      // 门牌
      const roomNo = floorNo + d.n;
      rect(d.x + 1, d.y + 5, 5, 3.4, '#c9c2a8');
      text(roomNo, d.x + 1.2, d.y + 5.4, '#2a2418', 4);
      // 门把手
      rect(i < 3 ? d.x + d.w - 3 : d.x + 1.4, d.y + d.h * 0.55, 1.4, 1.4, '#9aa2ab');
    });

    // 电梯（远端左侧）
    rect(50, 30, 14, 38, METAL_D);
    rect(51, 31, 12, 36, '#313a44');
    rect(56.8, 31, 0.8, 36, METAL_D);
    rect(53, 27, 8, 3, '#14181d');
    text(String('1'), 55.6, 27.3, '#7ef0a8', 4);

    // 楼层指示牌
    rect(96, 30, 24, 11, '#141a20');
    rect(97, 31, 22, 9, '#1d242b');
    text('F ' + (showFloor || targetFloor), 100, 32.6, '#cfe0ef', 6);

    // 楼梯门
    rect(104, 44, 14, 24, '#1b2028');
    text('安全出口', 104.6, 45.4, '#4d5866', 3.4);

    // 顶灯
    [[30, 4], [85, 4], [140, 4]].forEach((p, i) => {
      rect(p[0], p[1], 8, 2, '#3a424a');
      rect(p[0] + 0.5, p[1] + 2, 7, 1, i === 1 ? LIGHT : '#8a8468');
      glow(p[0] + 4, p[1] + 4, 16, 'rgba(255,232,170,0.16)', 0.5);
    });
  }

  /* ═══════════════════════════════════════════════════════
     主 入 口
     ═══════════════════════════════════════════════════════ */

  /**
   * scene = {
   *   cam: 'gate'|'lobby'|'stair'|'lobby2',
   *   people: [{ x, y, scale, app, walk, facing }],
   *   overlay: 'none'|'glitch'|'dark',
   *   targetFloor, showFloor,
   *   shake: 0..1,
   *   flashlight: bool,
   * }
   */
  function render(scene, dt) {
    if (!ctx) return;
    time += dt;

    ctx.setTransform(4, 0, 0, 4, 0, 0);
    ctx.imageSmoothingEnabled = false;

    ctx.save();
    if (scene.shake) {
      ctx.translate((Math.random() - 0.5) * scene.shake * 4,
                    (Math.random() - 0.5) * scene.shake * 3);
    }

    // 背景
    switch (scene.cam) {
      case 'gate':   bgGate(); break;
      case 'lobby':  bgLobby(); break;
      case 'stair':  bgStair(); break;
      case 'lobby2': bgCorridor(scene.targetFloor || 8, scene.showFloor || 0); break;
      default:       rect(0, 0, W, H, '#101317');
    }

    // 人物：远的先画
    (scene.people || []).slice().sort((a, b) => a.scale - b.scale).forEach((p, i) => {
      drawPerson(p.x, p.y, p.scale, p.app, {
        walk: p.walk || 0,
        phase: time,
        facing: p.facing || 1,
        alpha: p.alpha,
        seed: i * 2.3,
      });
    });

    ctx.restore();

    // 手电筒：只保留一小圈
    if (scene.flashlight) {
      const g = ctx.createRadialGradient(85, 55, 6, 85, 55, 56);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.55)');
      g.addColorStop(1, 'rgba(0,0,0,0.95)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    // 摄像机色调
    if (scene.cam === 'gate') {
      ctx.fillStyle = 'rgba(30,60,110,0.10)';
      ctx.fillRect(0, 0, W, H);
    }

    // 故障 / 雪花
    if (scene.overlay === 'glitch') {
      const f = noiseCache[Math.floor(time * 22) % noiseCache.length];
      ctx.globalAlpha = 0.5;
      ctx.drawImage(f, 0, 0, W, H);
      ctx.globalAlpha = 1;
      for (let i = 0; i < 5; i++) {
        const y = Math.random() * H;
        ctx.drawImage(f, 0, y, W, 1.5 + Math.random() * 3, 0, y, W, 1.5 + Math.random() * 3);
      }
      // 滚动撕裂条
      const by = (time * 90) % H;
      rect(0, by, W, 2.4, 'rgba(255,255,255,0.10)');
    }

    // 暗角
    const vg = ctx.createRadialGradient(85, 48, 22, 85, 48, 92);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.78)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // 时间戳水印
    const now = new Date();
    const hh = String((22 + Math.floor(time / 60)) % 24).padStart(2, '0');
    const mm = String(Math.floor(time) % 60).padStart(2, '0');
    text(hh + ':' + mm + ':' + String(Math.floor((time * 7) % 60)).padStart(2, '0'),
         4, H - 8, 'rgba(230,240,250,0.62)', 6);
  }

  /* ─────────── 供外部使用的小工具 ─────────── */

  function staticFrame(canvas, strength) {
    const c = canvas.getContext('2d');
    const f = noiseCache[Math.floor(Math.random() * noiseCache.length)];
    c.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    c.imageSmoothingEnabled = false;
    c.globalAlpha = strength === undefined ? 0.85 : strength;
    c.drawImage(f, 0, 0, W, H);
    c.globalAlpha = 1;
  }

  return { attach, render, drawPerson, drawPhoto, CAMS, W, H, shade, staticFrame };
})();
