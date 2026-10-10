/* ══════════════════════════════════════════════════════════
   events.js — 楼内随机事件
   ──────────────────────────────────────────────────────────
   设计红线（很重要，别破坏）：
     这些事件**只负责氛围和"值得盯一眼"**，绝不参与判定。
     放行/拒收的依据永远只有三样：证件、登记册、来人本人。
     所以这里不会生成"该拒的人"，也不会生成"该放的人"。
     出现的身影一律是错过的、已经进去的、或者根本不是人的东西。

   副作用：事件发生时，左侧对应通道按钮会亮一个小点。
     这是给玩家的"值得切过去看"的提示，不改变任何判定。
   ══════════════════════════════════════════════════════════ */

const Events = (() => {

  /* ═══════════════════════════════════════════════════════
     一、事件表
     ═══════════════════════════════════════════════════════ */

  const EVENTS = [

    /* ── 楼梯间 ── */
    {
      id: 'stair-light', cam: 'stair', w: 10, dur: 2.4,
      log: '楼梯间的灯闪了两下。',
      run(e) {
        e.flicker = true;
      },
    },
    {
      id: 'stair-steps', cam: 'stair', w: 9, dur: 5.0,
      log: '楼梯间里有脚步声，从楼上来，走过这一层，又下去了。',
      run(e) {
        e.audio = 'steps';
      },
    },
    {
      id: 'stair-shadow', cam: 'stair', w: 7, dur: 3.2,
      log: '楼梯转角的墙上有一个影子，比人先到。',
      run(e) {
        e.shadowOnWall = true;
      },
    },
    {
      id: 'stair-figure', cam: 'stair', w: 5, dur: 2.2,
      log: '楼梯口站着一个人。再看时，那里只有扶手。',
      run(e) {
        e.figure = { x: 74, y: 40, scale: 0.42, alpha: 0.5, from: 0.15, to: 0.85 };
      },
    },

    /* ── 楼层走廊 ── */
    {
      id: 'corridor-ajar', cam: 'lobby2', w: 10, dur: 4.2,
      log: '走廊里有一扇门开着一条缝，门里的灯是亮的。',
      run(e) {
        e.ajar = true;
      },
    },
    {
      id: 'corridor-flicker', cam: 'lobby2', w: 9, dur: 2.4,
      log: '走廊顶灯在闪。',
      run(e) {
        e.flicker = true;
      },
    },
    {
      id: 'corridor-exit', cam: 'lobby2', w: 6, dur: 3.4,
      log: '安全出口的绿灯亮了一下——不该亮的时候。',
      run(e) {
        e.exitPulse = true;
      },
    },
    {
      id: 'corridor-walk', cam: 'lobby2', w: 7, dur: 6.0,
      log: '走廊里有人从电梯那边走过去。画面里没看清是谁。',
      run(e) {
        e.figure = { x0: 62, x1: 26, y: 84, scale: 0.68, alpha: 0.8, from: 0.05, to: 0.9 };
      },
    },

    /* ── 一层门厅 ── */
    {
      id: 'lobby-intercom', cam: 'lobby', w: 9, dur: 2.6,
      log: '门厅的对讲机响了一声，只有电流。',
      run(e) {
        e.audio = 'static';
        e.intercom = true;
      },
    },
    {
      id: 'lobby-elev', cam: 'lobby', w: 8, dur: 4.0,
      log: '电梯下来了，门开了一下。没有人出来。',
      run(e) {
        e.elevDoor = true;
      },
    },
    {
      id: 'lobby-pass', cam: 'lobby', w: 7, dur: 6.0,
      log: '有人从门厅横着走过去，没往摄像头这边看。',
      run(e) {
        e.figure = { x0: 40, x1: 120, y: 68, scale: 0.6, alpha: 0.42, from: 0.1, to: 0.95 };
      },
    },

    /* ── 大门外 ── */
    {
      id: 'gate-nobody', cam: 'gate', w: 8, dur: 6.0,
      log: '大门外有人走过去。不是来找你的。',
      run(e) {
        e.figure = { x0: 15, x1: 155, y: 76, scale: 0.72, alpha: 0.55, from: 0.05, to: 0.95 };
      },
    },
    {
      id: 'gate-window', cam: 'gate', w: 7, dur: 3.6,
      log: '对面楼有一扇窗的灯灭了。',
      run(e) {
        e.windowOut = true;
      },
    },

    /* ── 全楼（偏色，任意通道都能看见） ── */
    {
      id: 'tint-cold', cam: 'any', w: 6, dur: 3.0,
      log: '画面整体偏冷了一下。',
      run(e) { e.tint = 'rgba(70,120,180,0.10)'; },
    },
    {
      id: 'tint-red', cam: 'any', w: 3, dur: 2.2,
      log: '画面里泛过一层很淡的红。',
      run(e) { e.tint = 'rgba(150,30,30,0.11)'; },
    },
  ];

  /* ═══════════════════════════════════════════════════════
     二、状态
     ═══════════════════════════════════════════════════════ */

  const st = {
    enabled: true,
    log: [],            // 最近若干条事件文本
    next: 12,           // 距离下一个事件的秒数
    active: [],         // 正在生效的事件实例
    silhouettes: [],    // 画面上要额外画的身影（由事件产生）
    glowed: {},         // camId -> true（通道按钮上亮小点）
    ticks: 0,
    baseGap: 16,        // 平均间隔（秒），调试面板可改
  };

  const MAX_LOG = 40;

  function setNight(night) {
    st.log = [];
    st.active = [];
    st.silhouettes = [];
    st.glowed = {};
    st.ticks = 0;
    st.baseGap = Math.max(6, 20 - night * 1.6);
    // 第 1 夜少一点，让玩家先学会看证件；之后逐渐密起来。
    // 目标：平均 12~25 秒一次，一次持续 2~6 秒 —— 像背景里的杂音，不吃注意力。
    st.next = st.baseGap * (0.5 + Math.random() * 0.7);
  }

  function setGap(sec) {
    st.baseGap = Math.max(1, sec);
    st.next = Math.min(st.next, st.baseGap);
  }

  // 调试用：立刻触发一个事件
  function fireNow(S, ctx) { fire(S, ctx); }

  function setEnabled(on) {
    st.enabled = !!on;
    if (!st.enabled) {
      st.active = [];
      st.silhouettes = [];
      st.glowed = {};
    }
  }

  function pushLog(text) {
    st.log.unshift({ t: st.ticks, text });
    if (st.log.length > MAX_LOG) st.log.pop();
  }

  /* ═══════════════════════════════════════════════════════
     三、推进
     ═══════════════════════════════════════════════════════ */

  // S = game.js 的状态对象；ctx = { SFX, onGlow(cam) }
  function step(dt, S, ctx) {
    if (!st.enabled || S.dead || !S.running) return;
    st.ticks += dt;

    // 生效中的事件
    for (let i = st.active.length - 1; i >= 0; i--) {
      const a = st.active[i];
      a.t += dt;
      if (a.t >= a.e.dur) {
        st.active.splice(i, 1);
        delete st.glowed[a.cam];
      }
    }

    // 身影按进度移动
    st.silhouettes = [];
    st.active.forEach(a => {
      if (!a.e.figure) return;
      const f = a.e.figure;
      const k = Math.max(0, Math.min(1, (a.t / a.e.dur - f.from) / Math.max(0.01, f.to - f.from)));
      const x = f.x0 !== undefined ? f.x0 + (f.x1 - f.x0) * k
                                    : f.x;
      st.silhouettes.push({ cam: a.cam, x, y: f.y, scale: f.scale, alpha: f.alpha, k });
    });

    // 排下一个
    st.next -= dt;
    if (st.next <= 0) {
      fire(S, ctx);
      // 事件越到后半夜越密
      const prog = Math.min(1, Math.max(0, (S.time || 0) / 240));
      st.next = st.baseGap * (0.6 + Math.random() * 1.1) * (1 - prog * 0.35);
    }
  }

  function fire(S, ctx) {
    const camNow = S.cam;
    // 排除掉跟当前剧情冲突的事件：门口有人、或者正在放行/拒收时，不插随机事件
    const busy = S.visitor && S.visitor.mood !== 'gone';

    let pool = EVENTS.filter(e => !busy || e.cam === 'any');
    // 别让同一个事件连着来
    const last = st.lastId;
    pool = pool.filter(e => e.id !== last);
    if (!pool.length) pool = EVENTS.slice();

    const total = pool.reduce((s, e) => s + e.w, 0);
    let r = Math.random() * total;
    let e = pool[pool.length - 1];
    for (const x of pool) { r -= x.w; if (r <= 0) { e = x; break; } }
    st.lastId = e.id;

    const inst = {
      e,
      t: 0,
      cam: e.cam === 'any' ? (Math.random() < 0.5 ? camNow : pickCam(S)) : e.cam,
      tint: null,
    };
    e.run(inst);
    st.active.push(inst);
    st.glowed[inst.cam] = true;
    delete st.glowed[S.cam];          // 玩家正在看的这一路不必提示

    pushLog(e.log);

    if (inst.audio === 'steps' && ctx && ctx.SFX) ctx.SFX.footsteps(2 + Math.floor(Math.random() * 3));
    if (inst.audio === 'static' && ctx && ctx.SFX) {
      if (ctx.SFX.doorbell) ctx.SFX.doorbell();
    }
  }

  function pickCam(S) {
    const cams = ['gate', 'lobby', 'stair', 'lobby2'];
    return cams[Math.floor(Math.random() * cams.length)];
  }

  /* ═══════════════════════════════════════════════════════
     四、给渲染层的接口
     ═══════════════════════════════════════════════════════ */

  // 往 people 数组里追加"身影"（不参与判定，只是画上去）
  function renderPeople(S, people, cam) {
    st.silhouettes.forEach(s => {
      if (s.cam !== cam) return;
      people.push({
        x: s.x, y: s.y, scale: s.scale,
        app: PHANTOM_APP,
        walk: Math.sin(st.ticks * 6) * 0.5,
        facing: 1,
        alpha: s.alpha,
      });
    });
    // 楼梯间没有身影时，也可能画一个墙上的影子
    if (cam === 'stair') {
      st.active.forEach(a => {
        if (!a.e.shadowOnWall) return;
        const g = 0.35 + 0.3 * Math.sin(st.ticks * 2.2);
        people.push({
          x: 44, y: 44, scale: 0.9, app: SHADOW_APP,
          walk: 0, facing: 1, alpha: g * 0.5,
        });
      });
    }
  }

  function tint(cam) {
    let out = null;
    st.active.forEach(a => {
      if (a.cam !== cam || !a.tint) return;
      out = a.tint;
    });
    return out;
  }

  // 画面级的额外状态（灯的闪烁、电梯门、安全出口……）
  function visual(cam) {
    const v = { flicker: false, ajar: false, exitPulse: false, elevatorDoor: false,
                intercom: false, windowOut: false };
    st.active.forEach(a => {
      if (a.cam !== cam) return;
      if (a.flicker) v.flicker = true;
      if (a.ajar) v.ajar = true;
      if (a.exitPulse) v.exitPulse = true;
      if (a.elevDoor) v.elevatorDoor = true;
      if (a.intercom) v.intercom = true;
      if (a.windowOut) v.windowOut = true;
    });
    return v;
  }

  function hasGlow(cam) { return !!st.glowed[cam]; }

  /* ── 身影用的极简外观：看不清脸，只有轮廓 ── */

  const PHANTOM_APP = {
    skin: '#1b1f26', hairStyle: 'short', hairColor: '#14171c',
    eyes: 2, eyeColor: '#000', mouth: 'line',
    coatColor: '#191d23', pantsColor: '#14171b', shoeColor: '#0f1114',
    hScale: 1, sScale: 1, shadow: 1,
    limbHack: false, extraEyes: 0, extraMouth: 0, ghostly: false, headTurn: 0,
    collarStain: false, flicker: false, hairRise: false,
    decoy: null, props: {},
  };
  const SHADOW_APP = Object.assign({}, PHANTOM_APP, {
    skin: '#0d0f12', coatColor: '#0d0f12', hairColor: '#0b0d10', sScale: 1.3,
  });

  /* ═══════════════════════════════════════════════════════
     五、导出
     ═══════════════════════════════════════════════════════ */

  return {
    EVENTS,
    setNight, setEnabled, setGap, fireNow, step, renderPeople, tint, visual, hasGlow,
    get enabled() { return st.enabled; },
    get log() { return st.log; },
    get active() { return st.active; },
    get nextIn() { return st.next; },
    get baseGap() { return st.baseGap; },
  };
})();
