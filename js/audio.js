/* ══════════════════════════════════════════════════════════
   audio.js — 程序化音效（无外部音频文件）
   环境层：低频嗡鸣 + 房间底噪 + 随机静电爆音
   事件层：门铃、脚步、开门、电梯、蜂鸣、错判、惊吓
   ══════════════════════════════════════════════════════════ */

const SFX = (() => {

  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let amb = null;            // 环境层节点集合
  let muted = false;
  let ready = false;

  /* ─────────── 初始化 ─────────── */

  function init() {
    if (ready) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.85;
    master.connect(ctx.destination);

    // 预生成 4 秒噪声，全局复用
    const len = ctx.sampleRate * 4;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;   // 棕噪，比白噪更"房间"
      d[i] = last * 3.2;
    }

    ready = true;
    return true;
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  /* ─────────── 基础积木 ─────────── */

  function noiseSrc(loop) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = !!loop;
    return s;
  }

  function env(node, t0, attack, hold, release, peak, floor) {
    const g = node.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(Math.max(floor || 0.0001, 0.0001), t0);
    g.exponentialRampToValueAtTime(Math.max(peak, 0.0001), t0 + attack);
    g.setValueAtTime(Math.max(peak, 0.0001), t0 + attack + hold);
    g.exponentialRampToValueAtTime(Math.max(floor || 0.0001, 0.0001), t0 + attack + hold + release);
  }

  function tone(type, freq, dur, vol, opts) {
    if (!ready) return;
    opts = opts || {};
    const t0 = ctx.currentTime + (opts.delay || 0);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t0 + dur);
    env(g, t0, opts.atk || 0.006, dur * 0.35, dur * 0.6, vol, 0.0001);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.1);
  }

  function noiseBurst(dur, vol, filterType, freq, q, delay) {
    if (!ready) return;
    const t0 = ctx.currentTime + (delay || 0);
    const s = noiseSrc(false);
    const f = ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q || 1;
    const g = ctx.createGain();
    env(g, t0, 0.004, dur * 0.3, dur * 0.7, vol, 0.0001);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t0); s.stop(t0 + dur + 0.05);
  }

  /* ─────────── 环境层 ─────────── */

  function startAmbience() {
    if (!ready || amb) return;

    const g = ctx.createGain();
    g.gain.value = 0.0;
    g.connect(master);

    // 低频嗡鸣（配电箱 / 荧光灯）
    const hum1 = ctx.createOscillator(); hum1.type = 'sine'; hum1.frequency.value = 49.5;
    const hum2 = ctx.createOscillator(); hum2.type = 'sine'; hum2.frequency.value = 99.0;
    const hg1 = ctx.createGain(); hg1.gain.value = 0.09;
    const hg2 = ctx.createGain(); hg2.gain.value = 0.03;
    hum1.connect(hg1); hum2.connect(hg2);
    hg1.connect(g); hg2.connect(g);

    // 房间底噪
    const hiss = noiseSrc(true);
    const hf = ctx.createBiquadFilter();
    hf.type = 'bandpass'; hf.frequency.value = 850; hf.Q.value = 0.55;
    const hg = ctx.createGain(); hg.gain.value = 0.055;
    hiss.connect(hf); hf.connect(hg); hg.connect(g);

    hum1.start(); hum2.start(); hiss.start();

    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.85, ctx.currentTime + 3.0);

    amb = { g, hum1, hum2, hiss, hissGain: hg, humGain: hg1, base: 0.85 };
    scheduleStatic();
  }

  // 随机静电 / 干扰爆音
  function scheduleStatic() {
    if (!amb) return;
    const wait = 3500 + Math.random() * 11000;
    amb._staticTimer = setTimeout(() => {
      if (amb && !muted) {
        const loud = Math.random() < 0.22;
        noiseBurst(loud ? 0.28 : 0.09, loud ? 0.16 : 0.05, 'highpass', 2400, 0.8, 0);
        if (loud) tone('square', 2600, 0.05, 0.02);
      }
      scheduleStatic();
    }, wait);
  }

  function setTension(t) {   // 0..1
    if (!amb) return;
    const g = amb.g;
    const target = 0.55 + t * 0.45;
    g.gain.cancelScheduledValues(ctx.currentTime);
    g.gain.linearRampToValueAtTime(target, ctx.currentTime + 1.2);
    amb.humGain.gain.linearRampToValueAtTime(0.09 + t * 0.08, ctx.currentTime + 1.2);
    amb.hissGain.gain.linearRampToValueAtTime(0.055 + t * 0.05, ctx.currentTime + 1.2);
  }

  function stopAmbience() {
    if (!amb) return;
    clearTimeout(amb._staticTimer);
    try { amb.g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6); } catch (e) {}
    const a = amb;
    setTimeout(() => {
      try { a.hum1.stop(); a.hum2.stop(); a.hiss.stop(); } catch (e) {}
    }, 750);
    amb = null;
  }

  /* ─────────── 事件音效 ─────────── */

  const api = {

    init, resume, startAmbience, stopAmbience, setTension,

    isMuted: () => muted,

    setMuted(m) {
      muted = m;
      if (master) master.gain.value = m ? 0 : 0.85;
      return muted;
    },

    toggleMute() { return api.setMuted(!muted); },

    /* 门铃：两声金属敲门铃 */
    doorbell() {
      if (!ready) return;
      [0, 0.42].forEach((d, i) => {
        tone('sine', 1180 - i * 40, 0.9, 0.18, { delay: d, to: 900 });
        tone('sine', 1560 - i * 40, 0.75, 0.10, { delay: d, to: 1180 });
        noiseBurst(0.06, 0.05, 'highpass', 3000, 1, d);
      });
    },

    /* 单声"叮"，用于提示可选择 */
    ding() {
      tone('sine', 1480, 0.5, 0.10, { to: 1480 });
      tone('sine', 2220, 0.35, 0.045, { to: 2000 });
    },

    /* 键盘 / 按钮 */
    click() { noiseBurst(0.035, 0.07, 'bandpass', 1800, 2, 0); },

    /* 摄像头切换 */
    camSwitch() {
      noiseBurst(0.16, 0.13, 'highpass', 1500, 0.9, 0);
      noiseBurst(0.34, 0.055, 'bandpass', 600, 0.7, 0.02);
      tone('square', 120, 0.09, 0.03, { to: 60 });
    },

    /* 脚步：2~4 步 */
    footsteps(n) {
      n = n || 2;
      for (let i = 0; i < n; i++) {
        const d = i * (0.44 + Math.random() * 0.12);
        noiseBurst(0.09, 0.09, 'lowpass', 320 + Math.random() * 120, 1.2, d);
        tone('sine', 74 + Math.random() * 16, 0.10, 0.05, { delay: d, to: 48 });
      }
    },

    /* 金属门开 */
    doorOpen() {
      noiseBurst(0.5, 0.09, 'bandpass', 420, 1.6, 0);
      tone('square', 210, 0.30, 0.045, { to: 130 });
      noiseBurst(0.10, 0.16, 'lowpass', 200, 1.4, 0.42);
    },

    /* 门锁落下 */
    lockClick() {
      noiseBurst(0.05, 0.20, 'bandpass', 2600, 3, 0);
      noiseBurst(0.09, 0.13, 'lowpass', 240, 1.4, 0.03);
    },

    /* 电梯到达 / 运行 */
    elevatorArrive() {
      tone('sine', 830, 0.28, 0.07, { to: 830 });
      tone('sine', 1245, 0.55, 0.055, { to: 1245, delay: 0.22 });
      noiseBurst(0.7, 0.05, 'lowpass', 260, 1.1, 0);
    },

    elevatorRun() {
      const t0 = ctx.currentTime;
      const s = noiseSrc(false);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = 1.1;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.10, t0 + 0.3);
      g.gain.linearRampToValueAtTime(0.0001, t0 + 2.4);
      s.connect(f); f.connect(g); g.connect(master);
      s.start(t0); s.stop(t0 + 2.6);
      tone('sine', 58, 2.2, 0.05, { to: 92 });
    },

    /* 判定通过 */
    accept() {
      tone('sine', 660, 0.16, 0.10, { to: 660 });
      tone('sine', 990, 0.30, 0.09, { to: 990, delay: 0.13 });
    },

    /* 判定拒绝 */
    reject() {
      tone('square', 200, 0.22, 0.075, { to: 120 });
      tone('square', 148, 0.38, 0.06, { to: 82, delay: 0.16 });
    },

    /* 错判警告蜂鸣 */
    wrong() {
      for (let i = 0; i < 3; i++) {
        tone('square', 440, 0.14, 0.085, { delay: i * 0.20 });
        tone('square', 330, 0.14, 0.085, { delay: i * 0.20 + 0.03 });
      }
    },

    /* 深夜钟声 / 换夜 */
    bell() {
      [0, 1.1].forEach(d => {
        tone('sine', 196, 2.4, 0.10, { delay: d, to: 190 });
        tone('sine', 392, 1.9, 0.055, { delay: d, to: 380 });
        tone('sine', 587, 1.2, 0.028, { delay: d, to: 570 });
      });
    },

    /* 呼吸声（凑近镜头时） */
    breath(intensity) {
      const v = 0.05 + (intensity || 0) * 0.14;
      noiseBurst(0.55, v, 'bandpass', 620, 1.1, 0);
      noiseBurst(0.65, v * 0.9, 'bandpass', 480, 1.1, 0.55);
    },

    /* 低频压迫感 */
    drone(dur, vol) {
      tone('sine', 42, dur || 2.5, vol || 0.09, { to: 34 });
      tone('sine', 63, (dur || 2.5) * 0.9, (vol || 0.09) * 0.5, { to: 51 });
    },

    /* 惊吓：全频段撕裂 */
    scare() {
      if (!ready) return;
      const t0 = ctx.currentTime;

      const s = noiseSrc(false);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.setValueAtTime(3800, t0);
      f.frequency.exponentialRampToValueAtTime(180, t0 + 1.5);
      f.Q.value = 0.7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.55, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.7);
      s.connect(f); f.connect(g); g.connect(master);
      s.start(t0); s.stop(t0 + 1.9);

      tone('sawtooth', 1500, 0.9, 0.20, { to: 90, atk: 0.002 });
      tone('square', 780, 1.2, 0.14, { to: 55, atk: 0.002 });
      tone('sine', 38, 3.0, 0.22, { to: 26 });
    },

    /* 收尾：一切安静下来 */
    silence(dur) {
      if (!amb) return;
      const a = amb.g.gain.value;
      amb.g.gain.cancelScheduledValues(ctx.currentTime);
      amb.g.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
      setTimeout(() => {
        if (amb) { try { amb.g.gain.linearRampToValueAtTime(a, ctx.currentTime + 1.5); } catch (e) {} }
      }, (dur || 2) * 1000);
    },
  };

  return api;
})();
