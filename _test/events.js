/* 随机事件探针：
   1) 15 条事件是否都能被抽到（无死事件）
   2) 事件密度是否合理（不能太密、也不能整夜空转）
   3) 事件期间不报错、状态能正常回收（active 不会泄漏）
   4) 事件**绝不参与判定**：触发前后 registry 对当前访客的判定结果必须不变
*/
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── 浏览器桩 ──
const noop = () => {};
const fakeNode = new Proxy({}, {
  get(t, k) {
    if (k === 'style') return {};
    if (k === 'classList') return { add: noop, remove: noop, toggle: noop, contains: () => false };
    if (k === 'dataset') return {};
    if (k === 'appendChild' || k === 'removeChild' || k === 'setAttribute') return noop;
    if (k === 'querySelectorAll') return () => [];
    if (k === 'getContext') return () => ({});
    if (k === 'textContent' || k === 'innerHTML') return '';
    return fakeNode;
  },
  set() { return true; },
});
global.document = {
  getElementById: () => fakeNode,
  createElement: () => fakeNode,
  querySelector: () => fakeNode,
  querySelectorAll: () => [],
  addEventListener: noop,
  removeEventListener: noop,
  body: fakeNode,
  head: fakeNode,
};
global.window = { addEventListener: noop, removeEventListener: noop, innerWidth: 1440, innerHeight: 900 };
// Node 24 自带只读的 globalThis.navigator / performance，不能赋值也不用赋值
global.requestAnimationFrame = () => 0;

for (const f of ['visitor.js', 'registry.js', 'events.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), { filename: f });
}
const V = vm.runInThisContext('Visitors');
const Reg = vm.runInThisContext('Registry');
const Ev = vm.runInThisContext('Events');

let fail = 0;
const bad = (s) => { fail++; console.log('  ✗ ' + s); };

// 假的 SFX：只记调用
const calls = {};
const SFX = new Proxy({}, {
  get(t, k) {
    if (k === 'setTension' || k === 'setMuted' || k === 'stopAmbience') return noop;
    return (...a) => { calls[k] = (calls[k] || 0) + 1; void a; };
  },
});

V.setSeed(31337);
V.genResidents();
Reg.loadLedger(V.RESIDENTS);

// ── 1..3：跑 8 个"夜"，每夜 600 秒，间隙调到 1.2 秒逼出所有事件 ──
const fired = {};
let total = 0, maxActive = 0;
const S = {
  dead: false, running: true, time: 0, cam: 'gate',
  visitor: null, corridorFloor: 8,
  released: {}, vacancies: [], flagged: [], mistakes: 0, night: 1,
};

Ev.setEnabled(true);
Ev.setGap(1.2);

for (let night = 1; night <= 8; night++) {
  S.night = night;
  S.time = 0;
  Ev.setNight(night);
  Ev.setGap(1.2);
  const built = V.buildNight(night);
  Reg.setNightNotes(built.flagged, built.vacancies);

  for (let step = 0; step < 6000; step++) {          // 6000 * 0.1 = 600 秒
    S.time += 0.1;
    S.cam = ['gate', 'lobby', 'stair', 'lobby2'][step % 4];
    Ev.step(0.1, S, { SFX });
    maxActive = Math.max(maxActive, Ev.active.length);
    if (Ev.active.length > 24) { bad('第' + night + '夜 active 泄漏到 ' + Ev.active.length); break; }
  }
  Ev.log.forEach(l => { fired[l.title || l.id || JSON.stringify(l)] = (fired[l.title || l.id || JSON.stringify(l)] || 0) + 1; });
  total += Ev.log.length;
}

// 统计到底哪些事件 ID 被触发过：直接再跑一遍、在 fire 之后读 active
const hit = {};
for (let night = 1; night <= 12; night++) {
  S.time = 0;
  Ev.setNight(night); Ev.setGap(0.8);
  for (let step = 0; step < 4000; step++) {
    S.time += 0.1;
    S.cam = ['gate', 'lobby', 'stair', 'lobby2'][step % 4];
    const before = Ev.active.length;
    Ev.step(0.1, S, { SFX });
    if (Ev.active.length > before) {
      // 最新那条就是刚触发的
      const a = Ev.active[Ev.active.length - 1];
      hit[a.e.id] = (hit[a.e.id] || 0) + 1;
    }
  }
}

console.log('事件表 = ' + Ev.EVENTS.length + ' 条');
console.log('12 夜 × 400 秒（间隙 0.8s）触发统计：');
const misses = [];
Ev.EVENTS.forEach(e => {
  const n = hit[e.id] || 0;
  console.log('  ' + (n ? '✓' : '✗') + ' ' + e.id.padEnd(18) + ' cam=' + String(e.cam).padEnd(8) + ' 触发 ' + n + ' 次');
  if (!n) misses.push(e.id);
});
if (misses.length) bad('从未被触发的事件：' + misses.join(', '));

console.log('');
console.log('active 峰值 = ' + maxActive + '（应当很小，说明事件会正常回收）');
if (maxActive > 8) bad('active 峰值过高：' + maxActive);

// ── 4：事件绝不参与判定 ──
const built = V.buildNight(7);
Reg.setNightNotes(built.flagged, built.vacancies);
const active = Reg.activeRulesForNight(7);
let changed = 0;
built.queue.forEach(v => {
  const a = Reg.evaluate(v, { activeRules: active, released: {}, vacancies: built.vacancies, flagged: built.flagged });
  // 用同一个访客再跑一遍，中间穿插大量事件
  S.time = 0; Ev.setNight(7); Ev.setGap(0.5);
  for (let i = 0; i < 400; i++) { Ev.step(0.1, S, { SFX }); }
  const b = Reg.evaluate(v, { activeRules: active, released: {}, vacancies: built.vacancies, flagged: built.flagged });
  if (a.verdict !== b.verdict || a.failed.join() !== b.failed.join()) changed++;
});
if (changed) bad(changed + ' 位访客的判定结果被事件改变了（事件绝不该影响判定）');
else console.log('判定不受影响：' + built.queue.length + ' 位访客在事件前后判定完全一致');

console.log('');
console.log(fail ? '结果：' + fail + ' 处问题' : '结果：事件系统全部通过');
process.exit(fail ? 1 : 0);
