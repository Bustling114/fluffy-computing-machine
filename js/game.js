/* ══════════════════════════════════════════════════════════
   game.js — 主循环 / 夜班流程 / 台账 / 结算
   ══════════════════════════════════════════════════════════ */

(() => {

  /* ═══════════════════════════════════════════════════════
     常量
     ═══════════════════════════════════════════════════════ */

  const NIGHT_CLOCK_START = 22 * 60;     // 22:00
  const NIGHT_CLOCK_END   = 5 * 60 + 30; // 次日 05:30（按 22:00 起算的分钟偏移）
  const NIGHT_MINUTES = 7 * 60 + 30;

  const CAMS = [
    { id: 'gate',   name: 'CAM 1 · 大门外',   short: '大门外' },
    { id: 'lobby',  name: 'CAM 2 · 一层门厅', short: '一层门厅' },
    { id: 'stair',  name: 'CAM 3 · 楼梯间',   short: '楼梯间' },
    { id: 'lobby2', name: 'CAM 4 · 楼层走廊', short: '楼层走廊' },
  ];

  /* ═══════════════════════════════════════════════════════
     状态
     ═══════════════════════════════════════════════════════ */

  const S = {
    running: false,
    paused: true,
    night: 1,
    clock: NIGHT_CLOCK_START,
    cam: 'gate',
    flashlight: false,
    visitor: null,          // 当前门口的访客
    queue: [],
    spawned: 0,
    total: 0,
    release: {},            // 房号 -> 姓名（今夜已放行）
    readFlags: {},          // 守则 id -> 是否已把证件铺在桌上
    mistakes: 0,
    correct: 0,
    decisions: 0,
    misses: 0,
    history: [],
    nextArrival: 0,         // 秒
    activeRules: [],
    vacancies: [],
    flagged: [],
    glitch: { next: 6, until: 0, cam: null },
    interior: [],           // 楼内正在行走的人
    dead: false,
    won: false,
    tension: 0,
    time: 0,
  };

  /* ═══════════════════════════════════════════════════════
     DOM
     ═══════════════════════════════════════════════════════ */

  const $ = id => document.getElementById(id);
  const D = {
    screen: $('screen'), camName: $('cam-name'), camLive: $('cam-live'),
    camButtons: $('cam-buttons'),
    clock: $('clock'), clockfill: $('clockfill'),
    statNight: $('stat-night'), statPassed: $('stat-passed'), statMistake: $('stat-mistake'),
    prompt: $('prompt'), promptSub: $('prompt-sub'),
    statusText: $('status-text'),
    noise: $('noise-overlay'), glitchBar: $('glitch-bar'), scanlines: $('scanlines'),
    // 证件
    idEmpty: $('id-empty'), idCard: $('id-card'), idStatus: $('id-status'),
    idPhoto: $('id-photo'),
    fName: $('f-name'), fRoom: $('f-room'), fDate: $('f-date'), fIssue: $('f-issue'),
    idTamper: $('id-tamper'),
    // 登记册
    logBody: $('log-body'), logCount: $('log-count'),
    // 清单
    checklist: $('checklist'),
    // 按钮
    btnLet: $('btn-let'), btnDeny: $('btn-deny'),
    // 覆盖层
    rulesModal: $('rules-modal'), rulesList: $('rules-list'), btnRules: $('btn-rules'),
    btnRulesClose: $('btn-rules-close'),
    introModal: $('intro-modal'), introTitle: $('intro-title'), introBody: $('intro-body'),
    btnIntro: $('btn-intro'),
    endModal: $('end-modal'), endTitle: $('end-title'), endBody: $('end-body'), btnEnd: $('btn-end'),
    scare: $('scare'), scareCanvas: $('scare-canvas'),
  };

  /* ═══════════════════════════════════════════════════════
     工具
     ═══════════════════════════════════════════════════════ */

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  function fmtClock(minutes) {
    const m = ((minutes % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }

  function setStatus(txt, cls) {
    D.statusText.textContent = txt;
    D.statusText.className = cls || '';
  }

  /* ═══════════════════════════════════════════════════════
     夜晚流程
     ═══════════════════════════════════════════════════════ */

  function startGame() {
    Visitors.genResidents();
    Registry.loadLedger(Visitors.RESIDENTS);
    S.night = 1;
    S.mistakes = 0;
    startNight(1);
  }

  function startNight(night) {
    S.night = night;
    const built = Visitors.buildNight(night);
    S.queue = built.queue;
    S.total = built.queue.length;
    S.spawned = 0;
    S.vacancies = built.vacancies;
    S.flagged = built.flagged;
    S.release = {};
    S.correct = 0;
    S.decisions = 0;
    S.misses = 0;
    S.history = [];
    S.interior = [];
    S.visitor = null;
    S.clock = NIGHT_CLOCK_START;
    S.time = 0;
    S.dead = false;
    S.won = false;
    S.activeRules = Registry.activeRulesForNight(night);
    S.readFlags = {};
    S.nextArrival = 3.2;
    S.idShownFor = null;

    Registry.setNightNotes(built.flagged, built.vacancies);

    S.cam = 'gate';
    buildCamButtons();
    renderLedger();
    clearIdCard();
    renderChecklist();

    SFX.init();
    SFX.resume();
    SFX.startAmbience();
    SFX.setTension(0.15);
    SFX.bell();

    D.statNight.textContent = night;
    D.statPassed.textContent = 0;
    D.statMistake.textContent = S.mistakes;
    setStatus('第 ' + night + ' 夜 · 值班开始', '');

    D.prompt.textContent = '值班开始。先把守则看一遍。';
    D.promptSub.textContent = '门铃随时会响。';
    D.prompt.className = '';

    S.paused = false;
    S.running = true;

    updateClockUI();
    showRules(night, true);
  }

  /* ─────────── 换夜 / 结算 ─────────── */

  function finishNight() {
    S.running = false;
    S.paused = true;
    SFX.setTension(0.05);
    const ok = S.mistakes === 0;

    if (ok) {
      showModal(D.endModal, {
        title: '第 ' + S.night + ' 夜 · 交班',
        body: nightSummaryHTML(true),
        btn: '进入第 ' + (S.night + 1) + ' 夜',
        onBtn: () => {
          hide(D.endModal);
          startNight(S.night + 1);
        },
      });
    } else {
      showModal(D.endModal, {
        title: '天亮之前，你被调离了',
        body: nightSummaryHTML(false) +
          '<p>物业经理没有多说什么，只是让你把工牌留在桌上。</p>' +
          '<p class="modal-note">本局共值 ' + S.night + ' 个夜班，累计失误 ' + S.mistakes + ' 次。</p>',
        btn: '重新开始',
        onBtn: () => { hide(D.endModal); SFX.stopAmbience(); startGame(); },
      });
    }
  }

  function nightSummaryHTML(passed) {
    const rows = S.history.map(h =>
      '<tr class="' + (h.correct ? '' : 'bad') + '">' +
      '<td class="room">' + h.room + '</td>' +
      '<td class="name">' + h.name + '</td>' +
      '<td>' + (h.letIn ? '放行' : '拒收') + '</td>' +
      '<td>' + (h.correct ? '正确' : (h.letIn ? '不该放' : '不该拒')) + '</td>' +
      '</tr>').join('');

    return '' +
      '<div class="summary-grid">' +
        '<div><b>' + S.total + '</b><span>今夜到访</span></div>' +
        '<div><b>' + S.correct + '</b><span>判定正确</span></div>' +
        '<div><b>' + S.mistakes + '</b><span>失误</span></div>' +
      '</div>' +
      '<table id="summary-table"><thead><tr><th>房号</th><th>来访者</th><th>你的处置</th><th>结果</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="4">今夜无人到访。</td></tr>') + '</tbody></table>' +
      (passed
        ? '<p>你把这一夜的登记册合上。窗外已经开始泛灰。</p>'
        : '<p>登记册上有几处被红笔圈了起来。圈错了人。</p>');
  }

  /* ═══════════════════════════════════════════════════════
     访客到达
     ═══════════════════════════════════════════════════════ */

  function spawnVisitor() {
    if (S.spawned >= S.queue.length) return;
    const v = S.queue[S.spawned++];
    v.mood = 'approach';
    v.phase = 0;
    v.leaned = false;
    v.leanT = 0;
    v.bored = 0;
    v.targetFloor = Visitors.R.chance(0.5) ? v.room.slice(0, 2) : String(Visitors.R.int(3, 18)).padStart(2, '0');
    if (v.isBug && Visitors.R.chance(0.6)) {
      // 假货多半会去错楼层
      v.targetFloor = String(Visitors.R.int(3, 18)).padStart(2, '0');
    }
    S.visitor = v;

    SFX.doorbell();
    D.prompt.textContent = '门铃响了。有人站在单元门外。';
    D.promptSub.textContent = '把通道切到「大门外」。';
    D.prompt.className = '';

    if (S.cam !== 'gate') {
      D.camButtons.querySelector('[data-cam="gate"]')?.classList.add('alert');
    }
  }

  /* ═══════════════════════════════════════════════════════
     判定
     ═══════════════════════════════════════════════════════ */

  function currentEvaluation() {
    const v = S.visitor;
    if (!v) return null;
    return Registry.evaluate(v, {
      activeRules: S.activeRules,
      released: S.release,
      vacancies: S.vacancies,
      flagged: S.flagged,
    });
  }

  function decide(letIn) {
    const v = S.visitor;
    if (!v || v.mood === 'gone' || v.mood === 'entering' || v.decided) return;

    const ev = currentEvaluation();
    const correct = (letIn && ev.verdict === 'allow') || (!letIn && ev.verdict === 'deny');

    v.decided = true;
    v.letIn = letIn;
    S.decisions++;
    if (correct) S.correct++;
    else S.mistakes++;

    S.history.push({ room: v.room, name: v.name, letIn, correct });

    D.statMistake.textContent = S.mistakes;

    if (!correct) {
      SFX.wrong();
      S.tension = clamp(S.tension + 0.35, 0, 1);
      SFX.setTension(S.tension);
    }

    if (letIn && ev.verdict === 'deny') {
      // 放进了不该放的人
      setStatus('你放进了不该放的人。', 'bad');
      D.prompt.textContent = '门锁弹开的声音在门厅里回响。';
      D.promptSub.textContent = '他进来了。';
      triggerScare(v);
      return;
    }

    if (letIn) {
      SFX.accept();
      SFX.doorOpen();
      S.release[v.room] = v.name;
      D.statPassed.textContent = Object.keys(S.release).length;
      setStatus('已放行 ' + (v.room) + ' · ' + v.name, 'good');
      v.mood = 'entering';
      v.phase = 0;
      D.prompt.textContent = '你按下了开门键。';
      D.promptSub.textContent = '看着他进楼。别急着松手。';
      D.prompt.className = '';
      renderLedger();
    } else {
      SFX.reject();
      SFX.footsteps(3);
      setStatus(correct ? '拒收 · 正确' : '拒收 · 但他是住户', correct ? '' : 'bad');
      v.mood = 'leaving';
      v.phase = 0;
      D.prompt.textContent = correct ? '他把证件收回去，转身走了。' : '他站在门外愣了几秒，然后走了。';
      D.promptSub.textContent = correct ? '登记册上记一笔。' : '你明天会收到投诉。';
      D.prompt.className = correct ? '' : 'noise';
    }

    clearIdCard();
    updateButtons();
    renderChecklist();
  }

  /* ═══════════════════════════════════════════════════════
     门内行走（放行后追踪）
     ═══════════════════════════════════════════════════════ */

  function pushInterior(v) {
    S.interior.push({
      v,
      x: 95, z: 0,
      target: 1,
      speed: 0.14,
      done: false,
    });
  }

  function updateInterior(dt) {
    S.interior.forEach(p => {
      if (p.done) {
        if (p.v && !p.knocked) {
          p.knocked = true;
          p.knockAt = S.time + 2 + Math.random() * 2;
        }
        return;
      }
      const dx = p.target - p.z;
      const step = p.speed * dt;
      if (Math.abs(dx) <= step) { p.z = p.target; p.done = true; }
      else p.z += Math.sign(dx) * step;
    });
  }

  // 正在门厅 / 楼上走廊里走动的人，按摄像机求屏幕坐标
  function interiorPos(p, cam) {
    const z = clamp(p.z, 0, 1);
    if (cam === 'lobby') {
      return { x: lerp(95, 70, z), y: lerp(86, 70, z), scale: lerp(1.05, 0.52, z), facing: -1 };
    }
    if (cam === 'lobby2') {
      // 出电梯（左，远）→ 走到自己那扇门（右，近）；高度受限，不能顶穿天花板
      return { x: lerp(70, 116, z), y: lerp(83, 85, z), scale: lerp(0.62, 0.76, z), facing: 1 };
    }
    return null;
  }

  /* ═══════════════════════════════════════════════════════
     惊吓 / 结局
     ═══════════════════════════════════════════════════════ */

  function triggerScare(v) {
    S.paused = true;
    S.dead = true;
    SFX.setTension(1);
    SFX.scare();
    D.scare.classList.remove('hidden');

    const sc = D.scareCanvas.getContext('2d');
    const t0 = performance.now();
    const app = v.outer;

    function frame() {
      const el = (performance.now() - t0) / 1000;
      const cw = D.scareCanvas.width, ch = D.scareCanvas.height;
      sc.setTransform(1, 0, 0, 1, 0, 0);
      sc.fillStyle = '#000';
      sc.fillRect(0, 0, cw, ch);

      // 逼近的脸
      const zoom = 1 + el * 3.2;
      const shake = el < 1.4 ? 22 * (1 - el / 1.4) : 0;
      sc.setTransform(cw / Cameras.W, 0, 0, ch / Cameras.H,
                      (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake * 0.6);
      sc.imageSmoothingEnabled = false;

      Cameras.drawPerson(85, 74 + el * 6, 1.15 * zoom, app, {
        facing: 1, phase: el * 6, walk: 0,
      });

      // 噪点撕裂
      const nz = noiseFrames[Math.floor(el * 30) % noiseFrames.length];
      sc.globalAlpha = 0.24 + Math.random() * 0.25;
      sc.drawImage(nz, 0, 0, cw / (cw / Cameras.W), ch / (ch / Cameras.H));
      sc.globalAlpha = 1;

      // 白色闪光
      if (el < 0.32) {
        sc.setTransform(1, 0, 0, 1, 0, 0);
        sc.fillStyle = 'rgba(255,60,60,' + (0.35 * (1 - el / 0.32)) + ')';
        sc.fillRect(0, 0, cw, ch);
      }

      if (el < 2.6) requestAnimationFrame(frame);
      else {
        setTimeout(() => {
          D.scare.classList.add('hidden');
          gameOver();
        }, 350);
      }
    }
    frame();
  }

  const noiseFrames = [];
  function buildNoiseFrames() {
    for (let k = 0; k < 8; k++) {
      const c = document.createElement('canvas');
      c.width = Cameras.W; c.height = Cameras.H;
      const cc = c.getContext('2d');
      const im = cc.createImageData(c.width, c.height);
      for (let i = 0; i < im.data.length; i += 4) {
        const v = Math.random() * 255;
        im.data[i] = im.data[i + 1] = im.data[i + 2] = v;
        im.data[i + 3] = 255;
      }
      cc.putImageData(im, 0, 0);
      noiseFrames.push(c);
    }
  }

  function gameOver() {
    SFX.stopAmbience();
    S.running = false;
    const rows = S.history.map(h =>
      '<tr class="' + (h.correct ? '' : 'bad') + '"><td class="room">' + h.room + '</td>' +
      '<td class="name">' + h.name + '</td><td>' + (h.letIn ? '放行' : '拒收') + '</td>' +
      '<td>' + (h.correct ? '正确' : (h.letIn ? '不该放' : '不该拒')) + '</td></tr>').join('');

    showModal(D.endModal, {
      title: '你把它放进来了',
      body: '' +
        '<p>门厅的灯闪了两下就灭了。监控画面停在第 ' + S.night + ' 夜 ' +
        fmtClock(Math.floor(S.clock)) + '。</p>' +
        '<p>第二天早上，物业在 1504 的门口发现了一整夜的登记记录——<em>全是同一个人</em>。</p>' +
        '<table id="summary-table"><thead><tr><th>房号</th><th>来访者</th><th>处置</th><th>结果</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>' +
        '<p class="modal-note">你的值班日志停在最后一行。那一行是空的。</p>',
      btn: '重新开始',
      onBtn: () => { hide(D.endModal); startGame(); },
    });
  }

  /* ═══════════════════════════════════════════════════════
     界面渲染
     ═══════════════════════════════════════════════════════ */

  function buildCamButtons() {
    D.camButtons.innerHTML = CAMS.map(c =>
      '<button class="cam-btn" type="button" data-cam="' + c.id + '">' +
        '<span class="num">CH ' + (CAMS.indexOf(c) + 1) + '</span>' + c.short +
      '</button>').join('');
    D.camButtons.querySelectorAll('.cam-btn').forEach(b => {
      b.addEventListener('click', () => switchCam(b.dataset.cam));
    });
    markActiveCam();
  }

  function markActiveCam() {
    D.camButtons.querySelectorAll('.cam-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.cam === S.cam);
    });
    const c = CAMS.find(x => x.id === S.cam);
    D.camName.textContent = c ? c.name : '—';
  }

  function switchCam(id) {
    if (id === S.cam) return;
    S.cam = id;
    SFX.camSwitch();
    markActiveCam();
    const btn = D.camButtons.querySelector('[data-cam="' + id + '"]');
    if (btn) btn.classList.remove('alert');
    renderChecklist();
  }

  function updateClockUI() {
    D.clock.textContent = fmtClock(Math.floor(S.clock));
    const p = clamp((S.clock - NIGHT_CLOCK_START) / NIGHT_MINUTES, 0, 1);
    D.clockfill.style.width = (p * 100).toFixed(1) + '%';
  }

  /* ─────────── 证件 ─────────── */

  function showIdCard(v) {
    const f = Registry.docFields(v);
    D.idEmpty.classList.add('hidden');
    D.idCard.classList.remove('hidden');
    D.idStatus.textContent = '已递交';
    D.idStatus.className = 'tag ok';

    Cameras.drawPhoto(D.idPhoto, v.photo);

    D.fName.textContent = f.name.value;
    D.fRoom.textContent = f.room.value;
    D.fDate.textContent = f.date.value;
    D.fIssue.textContent = f.issue.value;

    D.fName.className = f.name.tampered ? 'suspect' : '';
    D.fRoom.className = f.room.tampered ? 'suspect' : '';
    D.fDate.className = f.date.tampered ? 'suspect' : '';

    const anyTamper = f.name.tampered || f.room.tampered || f.date.tampered;
    D.idTamper.classList.toggle('hidden', !anyTamper);

    S.readFlags.id = true;
    updateButtons();
    renderChecklist();
  }

  function clearIdCard() {
    D.idEmpty.classList.remove('hidden');
    D.idCard.classList.add('hidden');
    D.idStatus.textContent = '空';
    D.idStatus.className = 'tag';
    D.idTamper.classList.add('hidden');
  }

  function updateButtons() {
    const v = S.visitor;
    const live = !!v && !v.decided && (v.mood === 'wait' || v.mood === 'arrive');
    D.btnLet.disabled = !live;
    D.btnDeny.disabled = !live;
  }

  /* ─────────── 登记册 ─────────── */

  function renderLedger() {
    const rows = Registry.ledgerView(S.visitor, S, 14);
    const v = S.visitor;
    const used = S.release;

    D.logBody.innerHTML = rows.map(r => {
      const cls = [];
      if (r.noteLevel === 2) cls.push('row-danger');
      if (used[r.room]) cls.push('row-used');
      if (v && r.room === v.room) cls.push('row-match');

      let note = r.note;
      if (used[r.room] && note) note = '今夜已放行 · ' + note;
      else if (used[r.room]) note = '今夜已放行「' + used[r.room] + '」';
      if (!note) note = '常住';

      return '<tr class="' + cls.join(' ') + '">' +
        '<td class="room">' + r.room + '</td>' +
        '<td class="name">' + r.name + '</td>' +
        '<td>' + r.valid + '</td>' +
        '<td class="note">' + note + '</td>' +
      '</tr>';
    }).join('');

    const usedCount = Object.keys(used).length;
    D.logCount.textContent = usedCount ? usedCount + ' 户已放行' : rows.length + ' 条';
  }

  /* ─────────── 核验清单 ─────────── */

  function renderChecklist() {
    const v = S.visitor;
    const ev = currentEvaluation();

    if (!v || !ev) {
      D.checklist.innerHTML = Registry.rulesForNight(S.night).map(r =>
        '<li class="skip"><span class="mark">·</span>' + shortRule(r) + '</li>').join('');
      return;
    }

    const items = Registry.rulesForNight(S.night).map(r => shortRule(r));
    // 用 evaluate 的结果逐条显示（未启用的守则灰掉）
    const all = Registry.RULES.map(r => {
      const active = S.activeRules.includes(r.id);
      const hit = ev.items.find(i => i.rule.id === r.id);
      if (!active) {
        return '<li class="skip"><span class="mark">·</span>' + shortRule(r) + '</li>';
      }
      if (!hit) {
        return '<li><span class="mark">○</span>' + shortRule(r) + '</li>';
      }
      if (hit.pass) {
        return '<li class="done"><span class="mark">✓</span>' + shortRule(r) + '</li>';
      }
      return '<li class="fail"><span class="mark">✕</span>' + shortRule(r) +
             '<span class="why">' + hit.why + '</span></li>';
    });
    D.checklist.innerHTML = all.join('');
  }

  function shortRule(r) {
    return r.name.replace(/^第 \d+ 条 · /, '');
  }

  /* ─────────── 守则手册 ─────────── */

  function showRules(night, isNightStart) {
    const isNew = isNightStart ? Registry.newRulesAt(night) : [];
    const list = Registry.rulesForNight(night);
    D.rulesList.innerHTML = list.map(r => {
      const fresh = isNew.some(x => x.id === r.id);
      return '<li class="' + (fresh ? 'new' : '') + '"><b>' + r.name + '</b>' + r.desc + '</li>';
    }).join('') +
    '<li style="border-left-color:#2f3945"><b>判定</b>证件、登记册、来人，三者一致才放行。' +
    '放进了不该放的人，你的班就到此为止；错拒住户三次，同样会被调离。</li>';

    if (isNightStart) {
      D.rulesModal.classList.remove('hidden');
    }
  }

  function hide(el) { el.classList.add('hidden'); }

  function showModal(el, opt) {
    el.querySelector('h1').textContent = opt.title;
    const bodyId = el === D.introModal ? D.introBody : D.endBody;
    if (bodyId) bodyId.innerHTML = opt.body;
    const btn = el === D.introModal ? D.btnIntro : D.btnEnd;
    btn.textContent = opt.btn;
    btn.onclick = opt.onBtn;
    el.classList.remove('hidden');
  }

  /* ═══════════════════════════════════════════════════════
     主循环
     ═══════════════════════════════════════════════════════ */

  let last = performance.now();
  let timeScale = 1;   // >1 只用于调试快进
  let frames = 0, pageStart = last, realElapsed = 0;

  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, ((now - last) / 1000) * timeScale);
    last = now;
    frames++;
    if (probeEl) realElapsed = now - pageStart;

    if (S.running && !S.paused) tick(dt);
    renderView(dt);
    renderOverlays(dt);
    updateProbe();
  }

  /* ─── 仅供调试：?probe=1 时把内部状态画到屏上，方便截图核对 ─── */
  let probeEl = null;

  function updateProbe() {
    if (!probeEl) return;
    const v = S.visitor;
    const pos = v ? gatePersonPos(v) : null;
    const lines = [
      'frames=' + frames + ' real=' + (realElapsed / 1000).toFixed(2) + 's scale=' + timeScale +
        ' S.time=' + S.time.toFixed(1),
      'time=' + S.time.toFixed(1) + ' cam=' + S.cam + ' running=' + S.running + ' paused=' + S.paused,
      'spawned=' + S.spawned + '/' + S.queue.length + ' next=' + S.nextArrival.toFixed(1) +
        ' interior=' + S.interior.length + ' clock=' + fmtClock(Math.floor(S.clock)),
      'visitor=' + (v ? (v.mood + ' phase=' + v.phase.toFixed(1) + ' decided=' + !!v.decided) : 'null'),
      'gatePos=' + (pos ? (pos.x.toFixed(1) + ',' + pos.y + ' sc=' + pos.sc.toFixed(2)) : '-') +
        ' mistakes=' + S.mistakes + ' tension=' + S.tension.toFixed(2),
    ];
    probeEl.innerHTML = lines.map(t => '<div>' + t + '</div>').join('');
  }

  window.addEventListener('error', e => {
    (window.__errs = window.__errs || []).push(String(e.message) + ' @' + e.lineno + ':' + e.colno);
  });

  function tick(dt) {
    S.time += dt;
    S.clock += dt * (NIGHT_MINUTES / (S.total * 26 + 40));
    if (S.clock > NIGHT_CLOCK_START + NIGHT_MINUTES) S.clock = NIGHT_CLOCK_START + NIGHT_MINUTES;
    updateClockUI();

    updateInterior(dt);

    const v = S.visitor;

    /* 访客状态机 */
    if (v) {
      v.phase += dt;
      switch (v.mood) {
        case 'approach':
          if (v.phase > 3.4) { v.mood = 'wait'; v.phase = 0; }
          break;

        case 'wait':
          v.bored += dt;
          // 门口的等待：每 14 秒按一次铃
          if (v.phase > 14 && !v.rang2) { v.rang2 = true; SFX.doorbell(); v.phase = 0; v.bored = 0; }
          if (v.bored > 40 && !v.leaving) {
            v.leaving = true;
            S.misses++;
            S.mistakes++;
            D.statMistake.textContent = S.mistakes;
            S.history.push({ room: v.room, name: v.name, letIn: false, correct: false });
            setStatus('你让一个访客在门外站走了。', 'bad');
            D.prompt.textContent = '门外的人走了。';
            D.promptSub.textContent = '你没理他。登记册上留了一行空白。';
            v.mood = 'leaving';
            v.phase = 0;
            clearIdCard();
            updateButtons();
          }
          // 玩家迟迟不看门外 → 他会凑近镜头
          if (S.cam !== 'gate' && v.bored > 6) {
            v.leanT += dt;
            if (v.leanT > 3.2 && !v.leaned) {
              v.leaned = true;
              SFX.breath(0.6);
              D.prompt.textContent = '监控画面里，他已经贴到镜头前了。';
              D.promptSub.textContent = '他一直知道你在这儿。';
              D.prompt.className = 'noise';
            }
          }
          break;

        case 'entering':
          if (v.phase > 1.0 && !v.pushed) {
            v.pushed = true;
            pushInterior(v);
            SFX.elevatorRun();
            S.tension = clamp(S.tension + 0.2, 0, 1);
            SFX.setTension(S.tension);
          }
          if (v.phase > 7.6) { v.mood = 'inside'; v.phase = 0; }
          break;

        case 'inside':
          if (v.phase > 8.0) { v.mood = 'gone'; v.phase = 0; clearIdCard(); updateButtons(); }
          break;

        case 'leaving':
          if (v.phase > 4) { v.mood = 'gone'; v.phase = 0; clearIdCard(); updateButtons(); }
          break;

        case 'gone':
          if (v.phase > 1.0) {
            S.visitor = null;
            S.nextArrival = Math.max(5.5, 12 - S.night * 0.6) + Math.random() * 6;
            S.tension = clamp(S.tension - 0.25, 0, 1);
            SFX.setTension(S.tension);
          }
          break;
      }
    } else {
      /* 空档期 */
      S.nextArrival -= dt;
      if (S.nextArrival <= 0) {
        const waiting = S.interior.some(p => !p.done);
        if (S.spawned < S.queue.length) spawnVisitor();
        else if (!waiting) finishNight();
        else S.nextArrival = 2;
      }
      // 空档期的氛围
      if (Math.random() < dt * 0.08) {
        SFX.footsteps(1 + Math.floor(Math.random() * 2));
        if (S.cam === 'stair') {
          D.prompt.textContent = '楼梯间里有脚步声，楼上两层的位置。';
          D.promptSub.textContent = '画面里没有人。';
          D.prompt.className = 'noise';
        }
      }
    }

    /* 摄像头故障 */
    S.glitch.next -= dt;
    if (S.glitch.next <= 0) {
      S.glitch.until = S.time + 1.4 + Math.random() * 2.2;
      S.glitch.cam = Math.random() < 0.35 ? S.cam : CAMS[Visitors.R.int(0, 3)].id;
      S.glitch.next = 22 + Math.random() * 26;
      if (S.glitch.cam === S.cam) SFX.camSwitch();
    }

    /* 楼道提示 */
    const insideLobby = S.interior.filter(p => !p.done);
    if (insideLobby.length && S.cam === 'lobby' && !D.prompt.dataset.lock) {
      const p = insideLobby[0];
      if (p.z > 0.25 && p.v.decided && p.v.letIn) {
        D.prompt.textContent = '他进了门厅，正往电梯走。';
        D.promptSub.textContent = '看他按哪一层。';
      }
    }
  }

  /* ═══════════════════════════════════════════════════════
     画面组装
     ═══════════════════════════════════════════════════════ */

  function gatePersonPos(v) {
    let x = 95, sc = 1.15, walk = 0, facing = -1;

    if (v.mood === 'approach') {
      const t = ease(clamp(v.phase / 3.4, 0, 1));
      x = lerp(148, 95, t);
      sc = lerp(0.92, 1.15, t);
      walk = Math.sin(v.phase * 8) * 0.6;
      facing = -1;
    } else if (v.mood === 'wait') {
      x = 95;
      sc = v.leaned ? lerp(1.15, 1.85, clamp((v.leanT - 3.2) / 2.5, 0, 1))
                    : 1.15 + Math.sin(S.time * 1.4) * 0.012;
      walk = 0;
      facing = -1;
    } else if (v.mood === 'leaving') {
      x = lerp(95, 148, ease(clamp(v.phase / 4, 0, 1)));
      sc = lerp(1.15, 0.9, clamp(v.phase / 4, 0, 1));
      walk = Math.sin(v.phase * 7) * 0.6;
      facing = 1;
    }
    return { x, y: 78, sc, walk, facing };
  }

  function renderView(dt) {
    const v = S.visitor;
    const people = [];

    if (S.cam === 'gate' && v && v.mood !== 'inside' && v.mood !== 'gone' && v.mood !== 'entering') {
      const p = gatePersonPos(v);
      people.push({ x: p.x, y: p.y, scale: p.sc, app: v.outer, walk: p.walk, facing: p.facing });
    }

    if (S.cam === 'lobby' || S.cam === 'lobby2') {
      // 门厅 / 楼上走廊里正在行走的人
      S.interior.forEach(p => {
        const pos = interiorPos(p, S.cam);
        if (!pos || p.done) return;
        people.push({ x: pos.x, y: pos.y, scale: pos.scale, app: p.v.outer,
                      walk: Math.sin(S.time * 9) * 0.55, facing: pos.facing });
      });
    }

    if (S.cam === 'stair') {
      // 楼梯间的"东西"：偶发
      const seed = Math.sin(S.time * 0.31) * Math.sin(S.time * 0.07);
      if (seed > 0.94 && v && v.isBug) {
        people.push({ x: 74, y: 42, scale: 0.4, app: v.outer, walk: 0, facing: 1, alpha: 0.45 });
      }
    }

    Cameras.render({
      cam: S.cam,
      people,
      targetFloor: v ? v.targetFloor : 8,
      showFloor: null,
      flashlight: S.flashlight,
      shake: S.dead ? 0.6 : 0,
      overlay: (S.glitch.cam === S.cam && S.time < S.glitch.until) ? 'glitch' : 'none',
    }, dt);

    // 直播状态
    const off = (S.glitch.cam === S.cam && S.time < S.glitch.until);
    D.camLive.textContent = off ? 'SIGNAL LOST' : 'LIVE';
    D.camLive.className = off ? 'offline' : '';
    D.noise.classList.toggle('on', off);
  }

  function renderOverlays(dt) {
    // 门口递交证件：站定后自动给证
    const v = S.visitor;
    if (v && !v.decided && v.mood === 'wait' && S.cam === 'gate') {
      showIdCard(v);
    }
  }

  /* ═══════════════════════════════════════════════════════
     输入
     ═══════════════════════════════════════════════════════ */

  function bindInput() {
    window.addEventListener('keydown', e => {
      // 弹窗优先
      if (!D.introModal.classList.contains('hidden')) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); D.btnIntro.click(); }
        return;
      }
      if (!D.endModal.classList.contains('hidden')) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); D.btnEnd.click(); }
        return;
      }
      if (!D.rulesModal.classList.contains('hidden')) {
        if (e.key === 'Escape' || e.key === 'r' || e.key === 'R') {
          e.preventDefault(); D.rulesModal.classList.add('hidden');
        }
        return;
      }
      if (S.dead) return;

      switch (e.key) {
        case '1': switchCam('gate'); break;
        case '2': switchCam('lobby'); break;
        case '3': switchCam('stair'); break;
        case '4': switchCam('lobby2'); break;
        case 'f': case 'F':
          S.flashlight = !S.flashlight;
          SFX.click();
          break;
        case 'm': case 'M': {
          const m = SFX.toggleMute();
          setStatus(m ? '声音已关闭' : '声音已打开', '');
          break;
        }
        case 'r': case 'R': showRules(S.night, false); D.rulesModal.classList.remove('hidden'); break;
        case 'Enter': case 'ArrowUp':
          if (!D.btnLet.disabled) { e.preventDefault(); decide(true); }
          break;
        case 'Backspace': case 'ArrowDown':
          if (!D.btnDeny.disabled) { e.preventDefault(); decide(false); }
          break;
        case ' ': {
          e.preventDefault();
          // 放大门外
          if (S.cam !== 'gate') switchCam('gate');
          break;
        }
      }
    });

    D.btnLet.addEventListener('click', () => decide(true));
    D.btnDeny.addEventListener('click', () => decide(false));
    D.btnRules.addEventListener('click', () => { showRules(S.night, false); D.rulesModal.classList.remove('hidden'); SFX.click(); });
    D.btnRulesClose.addEventListener('click', () => { D.rulesModal.classList.add('hidden'); SFX.click(); });
    D.btnIntro.addEventListener('click', () => { SFX.resume(); SFX.click(); });
    D.btnEnd.addEventListener('click', e => e.preventDefault());
  }

  /* ═══════════════════════════════════════════════════════
     启动
     ═══════════════════════════════════════════════════════ */

  function boot() {
    Cameras.attach(D.screen);
    buildNoiseFrames();
    buildCamButtons();
    bindInput();

    D.introTitle.textContent = '夜班 · 门房';
    D.introBody.innerHTML = '' +
      '<p>你签了一份短期合同：温岸公寓，夜班门房，02:00 到 05:30，时薪不错，没有人愿意接。</p>' +
      '<div class="quote">' +
        '「规矩不多。<br>' +
        '看证件，看册子，看人。<br>' +
        '三样都对得上，才开门。<br>' +
        '看错了……别开门。千万别开门。」' +
      '</div>' +
      '<ul>' +
        '<li>左侧是四个监控通道，一次只能看一个。门铃响时，来人在<b>大门外</b>。</li>' +
        '<li>有人递证件时，右上是他的通行证——<b>证件照是他该有的样子</b>。</li>' +
        '<li>登记册只列出与本楼住户有关的信息，注意备注栏。</li>' +
        '<li><b>放进了不该放的人，班就到此为止</b>；错拒住户三次，同样被调离。</li>' +
      '</ul>' +
      '<p class="modal-note">键盘：1–4 切换通道 · Enter 放行 · Backspace 拒收 · F 手电 · M 静音 · R 守则</p>';

    D.btnIntro.onclick = () => {
      hide(D.introModal);
      SFX.init();
      SFX.resume();
      startGame();
    };

    /* 调试用：index.html?auto=1&night=3&cam=lobby&mute=1 —— 跳过开场弹窗直接进夜班。
       不带参数时完全不影响正常游玩。 */
    const q = new URLSearchParams(location.search);
    if (q.has('auto')) {
      const n = Math.max(1, Math.min(30, parseInt(q.get('night') || '1', 10) || 1));
      hide(D.introModal);
      if (q.get('mute') === '1') { SFX.setMuted(true); SFX.init(); }
      if (q.has('seed')) Visitors.setSeed(parseInt(q.get('seed'), 10) || 1);
      startGame();
      if (n > 1) startNight(n);
      if (q.has('cam')) { const cam0 = q.get('cam'); if (CAMS.some(c => c.id === cam0)) switchCam(cam0); }
      if (q.has('warp')) timeScale = clamp(parseFloat(q.get('warp')) || 1, 1, 60);
      if (q.has('flash')) S.flashlight = true;   // 截图用：开手电
      if (q.has('norules')) {   // 截图用：别让守则手册挡住画面
        hide(D.rulesModal);
        const st = document.createElement('style');
        st.textContent = '.modal{display:none!important}';
        document.head.appendChild(st);
      }
      if (q.has('probe')) {     // 调试用：把内部状态叠在画面左上角
        window.__probe = () => ({
          frames, time: +S.time.toFixed(2), real: +(realElapsed / 1000).toFixed(2),
          cam: S.cam, running: S.running, paused: S.paused,
          spawned: S.spawned, queue: S.queue.length, next: +S.nextArrival.toFixed(2),
          interior: S.interior.length, clock: fmtClock(Math.floor(S.clock)),
          visitor: S.visitor ? { mood: S.visitor.mood, phase: +S.visitor.phase.toFixed(2),
                                 decided: !!S.visitor.decided, name: S.visitor.name,
                                 room: S.visitor.room, kind: S.visitor.kind } : null,
          mistakes: S.mistakes, tension: +S.tension.toFixed(2),
        });
        probeEl = document.createElement('pre');
        probeEl.style.cssText = 'position:fixed;left:6px;top:6px;z-index:9999;margin:0;' +
          'padding:6px 8px;background:rgba(0,0,0,.86);color:#7ef0a8;' +
          'font:12px/1.5 Consolas,monospace;white-space:pre;pointer-events:none';
        document.body.appendChild(probeEl);
      }
      if (q.has('errs')) {   // 调试用：把运行时异常铺在页面上，好让无头截图能看见
        const el = document.createElement('pre');
        el.id = 'errbox';
        el.style.cssText = 'position:fixed;right:6px;bottom:6px;z-index:9999;margin:0;max-width:640px;' +
          'padding:8px;background:rgba(0,0,0,.9);color:#ff8a8a;font:12px/1.5 Consolas,monospace;' +
          'white-space:pre-wrap;pointer-events:none';
        document.body.appendChild(el);
        setInterval(function () {
          const e = window.__errs || [];
          el.textContent = 'ERR_COUNT=' + e.length + (e.length ? '\n' + e.join('\n') : '');
        }, 120);
      }

      /* 调试钩子：截图脚本用它摆好姿势再拍，正常游玩不会碰到 */
      function poseVisitor(mood, phase) {
        const v = S.visitor; if (!v) return null;
        v.mood = mood; v.phase = phase; v.hold = true;
        if (mood === 'wait') { v.decided = false; showIdCard(v); }
        renderView(0.016); renderOverlays(0.016);
        return v;
      }

      window.__dbg = {
        state: () => S,
        errs: () => window.__errs,
        spawnNow: () => { S.nextArrival = 0; S.running = true; S.paused = false; spawnVisitor(); return S.visitor; },
        decide,
        switchCam,
        release: () => { if (S.visitor) decide(true); },
        deny: () => { if (S.visitor) decide(false); },
        set: poseVisitor,
      };

      // 截图用：?pose=wait:0 —— 直接把第一个访客摆成指定姿势，免等
      if (q.has('pose')) {
        const spec = (q.get('pose') || '').split(':');
        const mood = spec[0] || 'wait';
        const phase = spec.length > 1 ? parseFloat(spec[1]) : 0;
        spawnVisitor();
        // ?mut=eyes-extra,mouth-extra 把指定身体异常强行加在这位访客身上（截图核对用）
        if (q.has('mut') && S.visitor && S.visitor.outer) {
          (q.get('mut') || '').split(',').forEach(function (id) {
            const m = Visitors.PERSON_MUTATIONS.filter(function (x) { return x.id === id; })[0];
            if (m) {
              m.apply(S.visitor.outer);
              S.visitor.mutationIds.push(id);
              S.visitor.tells.push({ kind: 'person', id: id, text: m.tell });
            }
          });
        }
        poseVisitor(mood, phase);
      }

      // 截图用：?decide=wrong / ?decide=right —— 直接判一次，用来看结果画面
      if (q.has('decide')) {
        spawnVisitor();
        if (S.visitor) {
          S.visitor.mood = 'wait'; S.visitor.phase = 0;
          showIdCard(S.visitor);
          const shouldAllow = currentEvaluation().verdict === 'allow';
          // wrong = 做出与判定相反的选择（放错人时会触发跳脸）
          decide(q.get('decide') === 'wrong' ? !shouldAllow : shouldAllow);
        }
      }

      // 截图用：?finish=1 立刻结算这一夜，看交班画面
      if (q.has('finish')) {
        hide(D.rulesModal); hide(D.introModal);
        S.mistakes = parseFloat(q.get('finish')) || 0;
        finishNight();
      }
    }

    requestAnimationFrame(loop);
  }

  window.addEventListener('DOMContentLoaded', boot);

})();
