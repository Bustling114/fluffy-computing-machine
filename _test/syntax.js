/* syntax.js — 语法/装载体检：把所有 js 文件在打了 DOM 桩的环境里跑一遍
   用途：改完代码先跑这个，比开浏览器快得多。
   跑法： node "E:\DeepSeek works\doorman\_test\syntax.js"                        */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['js/audio.js', 'js/visitor.js', 'js/camera.js', 'js/registry.js', 'js/events.js', 'js/game.js'];

/* ── 极简 DOM 桩 ── */
function makeCtx2D() {
  const noop = () => {};
  const ctx = {
    canvas: { width: 680, height: 384 },
    setTransform: noop, save: noop, restore: noop, translate: noop, scale: noop,
    fillRect: noop, strokeRect: noop, clearRect: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    arc: noop, ellipse: noop, fill: noop, stroke: noop,
    fillText: noop, strokeText: noop,
    drawImage: noop, createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
    measureText: () => ({ width: 10 }),
    globalAlpha: 1, fillStyle: '', strokeStyle: '', font: '', textAlign: '',
    imageSmoothingEnabled: false, lineWidth: 1, globalCompositeOperation: 'source-over',
  };
  return ctx;
}

function makeEl(id) {
  const el = {
    id,
    style: {},
    dataset: {},
    classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      toggle(c, on) { if (on === undefined) on = !this._s.has(c); on ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    children: [],
    textContent: '',
    innerHTML: '',
    className: '',
    width: 680,
    height: 384,
    value: '',
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    insertBefore(c) { this.children.push(c); return c; },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getContext() { return makeCtx2D(); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 680, height: 384 }; },
    focus() {},
    setAttribute() {}, getAttribute() { return null; },
  };
  return el;
}

const els = {};
const document = {
  head: makeEl('head'),
  body: makeEl('body'),
  documentElement: makeEl('html'),
  getElementById(id) { return (els[id] = els[id] || makeEl(id)); },
  createElement(tag) { return makeEl(tag); },
  createTextNode(t) { return { text: t }; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener() {},
};

const sandbox = {
  console,
  document,
  window: null,
  location: { search: '', href: 'http://localhost/' },
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  setTimeout: () => 0,
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Error, isNaN, parseInt, parseFloat,
  URLSearchParams: class { constructor() {} has() { return false; } get() { return null; } },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  AudioContext: function () { return makeAudio(); },
  webkitAudioContext: function () { return makeAudio(); },
};
function makeAudio() {
  const noop = () => {};
  const node = () => ({
    connect: noop, disconnect: noop, start: noop, stop: noop,
    gain: { value: 0, setValueAtTime: noop, linearRampToValueAtTime: noop, exponentialRampToValueAtTime: noop, cancelScheduledValues: noop },
    frequency: { value: 0, setValueAtTime: noop, linearRampToValueAtTime: noop, exponentialRampToValueAtTime: noop },
    Q: { value: 0 }, type: '', buffer: null, loop: false, detune: { value: 0 },
    onended: null, playbackRate: { value: 1 },
    createGain: noop, createOscillator: noop, createBiquadFilter: noop,
    createBufferSource: noop, createBuffer: () => ({ getChannelData: () => new Float32Array(64) }),
    getChannelData: () => new Float32Array(64),
    createStereoPanner: noop, createDynamicsCompressor: noop, createWaveShaper: noop,
    createDelay: noop, createConvolver: noop, createPanner: noop,
    destination: { connect: noop }, sampleRate: 44100, currentTime: 0, state: 'running',
    resume: () => Promise.resolve(),
  });
  return node();
}
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
sandbox.addEventListener = () => {};
sandbox.removeEventListener = () => {};
sandbox.dispatchEvent = () => true;
sandbox.navigator = { userAgent: 'node', language: 'zh-CN' };
sandbox.innerWidth = 1440;
sandbox.innerHeight = 1000;
sandbox.getComputedStyle = () => ({ getPropertyValue: () => '' });
vm.createContext(sandbox);

let bad = 0;
for (const f of FILES) {
  const p = path.join(ROOT, f);
  try {
    const code = fs.readFileSync(p, 'utf8');
    // 只做语法检查
    new vm.Script(code, { filename: p });
  } catch (e) {
    bad++;
    console.log('✗ 语法错误 ' + f + ' :: ' + e.message);
  }
}
if (!bad) console.log('✓ 语法：' + FILES.length + ' 个文件全部通过');

/* ── 真正装载（会执行顶层代码）── */
const loaded = [];
for (const f of FILES) {
  const p = path.join(ROOT, f);
  try {
    vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: p });
    loaded.push(f);
  } catch (e) {
    console.log('✗ 装载失败 ' + f + ' :: ' + e.message);
  }
}
console.log('✓ 装载通过：' + loaded.join(', '));

/* ── 关键全局对象是否都在 ──
   注意：这些文件用顶层 const 暴露全局，在 vm 里顶层 const 是"脚本作用域"的，
   sandbox.X 读不到。所以这里用 runInContext 里的一次求值来回读。 */
function grab(name) {
  try { return vm.runInContext(name, sandbox); } catch (e) { return undefined; }
}
['SFX', 'Visitors', 'Cameras', 'Registry', 'Events'].forEach(k => {
  const v = grab(k);
  const ok = typeof v !== 'undefined' && v !== null;
  console.log((ok ? '✓ ' : '✗ ') + k + ' = ' + (ok ? typeof v : 'undefined'));
});
sandbox.__G = { SFX: grab('SFX'), Visitors: grab('Visitors'), Cameras: grab('Cameras'),
                Registry: grab('Registry'), Events: grab('Events') };

/* ── 接口自检 ── */
function has(obj, name, keys) {
  if (!obj) { console.log('✗ ' + name + ' 不存在'); return; }
  const miss = keys.filter(k => typeof obj[k] === 'undefined');
  console.log((miss.length ? '✗ ' : '✓ ') + name + (miss.length ? ' 缺少: ' + miss.join(', ') : ' 接口齐全'));
}
has(sandbox.__G.Events, 'Events', ['setNight', 'setEnabled', 'step', 'renderPeople', 'tint', 'visual', 'hasGlow', 'EVENTS']);
has(sandbox.__G.Cameras, 'Cameras', ['attach', 'render', 'drawPerson', 'drawPhoto', 'CAMS', 'W', 'H', 'shade', 'staticFrame']);
has(sandbox.__G.Visitors, 'Visitors', ['R', 'setSeed', 'buildNight', 'makeVisitor', 'genResidents', 'vacantRooms', 'flaggedRooms']);
has(sandbox.__G.Registry, 'Registry', ['loadLedger', 'evaluate', 'setNightNotes', 'activeRulesForNight', 'recordFor']);

/* ── 事件表自检：每条都要有 id/cam/w/dur/log/run ── */
if (sandbox.__G.Events) {
  const evs = sandbox.__G.Events.EVENTS;
  const badEv = evs.filter(e => !e.id || !e.cam || !e.w || !e.dur || !e.log || typeof e.run !== 'function');
  console.log((badEv.length ? '✗ ' : '✓ ') + '事件表 ' + evs.length + ' 条' +
    (badEv.length ? '，有问题的: ' + badEv.map(e => e.id || '?').join(', ') : '，字段齐全'));
  const cams = {};
  evs.forEach(e => { cams[e.cam] = (cams[e.cam] || 0) + 1; });
  console.log('  分布: ' + Object.keys(cams).map(k => k + '×' + cams[k]).join('  '));
}

/* ── 随机事件冒烟测试：把一整夜的事件跑一遍，看有没有异常 ── */
if (sandbox.__G.Events) {
  const E = sandbox.__G.Events;
  E.setNight(4);
  const S = { dead: false, running: true, cam: 'gate', time: 0, visitor: null };
  const SFX = { footsteps() {}, doorbell() {} };
  let fires = 0, lastNext = 0;
  try {
    for (let i = 0; i < 60 * 60; i++) {   // 60 秒 × 60 帧
      S.time += 1 / 60;
      const before = E.log.length;
      E.step(1 / 60, S, { SFX });
      if (E.log.length !== before) fires++;
      E.renderPeople(S, [], ['gate', 'lobby', 'stair', 'lobby2'][i % 4]);
      E.tint('gate'); E.visual('stair'); E.hasGlow('lobby');
    }
    console.log('✓ 事件冒烟：60 秒内触发 ' + fires + ' 次，日志 ' + E.log.length + ' 条，无异常');
    console.log('  样例: ' + E.log.slice(0, 3).map(x => x.text).join(' / '));
  } catch (e) {
    console.log('✗ 事件冒烟失败 :: ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n'));
  }
}
