/* 桩自检：确认 canvas.js 里的假 Canvas2D 的变换数学是对的 */
'use strict';
const { makeCtx } = require('./canvas.js');

let fail = 0;
function check(name, got, want) {
  const ok = Math.abs(got - want) < 0.5;
  if (!ok) fail++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + '  got=' + got + ' want=' + want);
}

function drawn(ctx) {
  let n = 0;
  for (let i = 0; i < ctx._cover.length; i++) if (ctx._cover[i] > 0) n++;
  return n;
}
function lum(ctx) {
  let s = 0;
  for (let i = 0; i < ctx._lum.length; i++) s += ctx._lum[i];
  return +s.toFixed(1);
}

let ctx = makeCtx(680, 384);
ctx.setTransform(4, 0, 0, 4, 0, 0);
ctx.fillStyle = '#ffffff';
ctx.fillRect(120, 14, 50, 68);
check('4x 变换下 [120,14,50,68] 的实体像素数', drawn(ctx), 50 * 4 * 68 * 4);
check('白色矩形的亮度总量（255*3 每像素）', lum(ctx), 50 * 4 * 68 * 4 * 765);

ctx = makeCtx(680, 384);
ctx.setTransform(4, 0, 0, 4, 0, 0);
ctx.fillStyle = '#ffffff';
ctx.fillRect(165, 90, 20, 20);          // 逻辑 170x96 之外，只应画到边界
check('越界区域不写像素', drawn(ctx), 5 * 4 * 6 * 4);

ctx = makeCtx(680, 384);
ctx.setTransform(4, 0, 0, 4, 0, 0);
ctx.fillStyle = '#0b0e12';
ctx.fillRect(0, 0, 10, 10);
check('深色 #0b0e12 也算已绘制', drawn(ctx), 10 * 4 * 10 * 4);

// 半透明的矩形算"画过"，但不该被当成实体填满
ctx = makeCtx(680, 384);
ctx.setTransform(4, 0, 0, 4, 0, 0);
ctx.globalAlpha = 0.3;
ctx.fillStyle = '#ffffff';
ctx.fillRect(0, 0, 10, 10);
check('半透明矩形不算实体像素', drawn(ctx), 0);
check('半透明矩形仍计入亮度（0.3 * 765 * 面积）', lum(ctx), +(0.3 * 765 * 10 * 4 * 10 * 4).toFixed(1));

// 光晕：按外接正方形面积近似（等价平均 alpha = 中心 alpha / 3）
ctx = makeCtx(680, 384);
ctx.setTransform(4, 0, 0, 4, 0, 0);
const g = ctx.createRadialGradient(10, 10, 1, 10, 10, 10);
g.addColorStop(0, 'rgba(255,255,255,1)');
ctx.fillStyle = g;
ctx.fillRect(0, 0, 20, 20);
check('光晕计入亮度（外接正方形 × 中心色 / 3）', lum(ctx), +(20 * 4 * 20 * 4 * 765 / 3).toFixed(1));
check('光晕不算实体像素', drawn(ctx), 0);

console.log(fail ? '结果：桩有 ' + fail + ' 处问题' : '结果：桩的变换与亮度累加正确');
process.exit(fail ? 1 : 0);
