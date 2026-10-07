/* ══════════════════════════════════════════════════════════
   visitor.js — 访客生成
   身份 / 证件 / 外观基线 / 篡改 / 异常特征 / 无辜的"看着不对劲"
   ══════════════════════════════════════════════════════════ */

const Visitors = (() => {

  /* ─────────── 随机工具 ─────────── */

  // 默认走 Math.random；setSeed(n) 之后改成可复现的伪随机，只用于调试/截图
  let rnd = Math.random;

  const R = {
    int: (a, b) => a + Math.floor(rnd() * (b - a + 1)),
    pick: arr => arr[Math.floor(rnd() * arr.length)],
    chance: p => rnd() < p,
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    sample(arr, n) { return R.shuffle(arr).slice(0, n); },
  };

  function setSeed(n) {
    let s = (n >>> 0) || 1;
    rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /* ─────────── 姓名库 ─────────── */

  const SURNAMES = ['陈', '林', '黄', '张', '李', '王', '吴', '刘', '蔡', '杨',
                    '许', '郑', '谢', '郭', '洪', '曾', '廖', '赖', '徐', '周'];
  const GIVEN_M = ['志明', '建国', '伟', '强', '俊杰', '文彬', '嘉豪', '子轩',
                   '浩宇', '明辉', '思远', '天佑'];
  const GIVEN_F = ['淑芬', '秀英', '丽华', '雅婷', '欣怡', '梦洁', '诗涵',
                   '雨萱', '静', '美玲', '晓彤', '若曦'];
  const FOREIGN = ['D. Halloway', 'M. Kessler', 'R. Adeyemi', 'L. Marchetti',
                   'S. Novak', 'T. Bergstrom', 'A. Villanueva', 'K. Osei'];
  const WORKER = ['快递员 · 中通', '外卖骑手 · 美团', '自来水公司', '电力检修',
                  '疏通管道', '保洁 · 万家园', '燃气安检'];

  /* ─────────── 外观基线 ─────────── */

  const SKINS = ['#e8c9a8', '#d9b08c', '#c08a5e', '#9c6b45', '#7a4f33', '#f0dcc4'];
  const HAIRS = ['#1b1512', '#2b1d14', '#3d2a1a', '#5a3a22', '#6e4a2c', '#8a8078',
                 '#c9c4bc', '#a33b2a', '#2e3a44'];
  const HAIRSTYLES = ['short', 'short', 'bob', 'long', 'bald', 'bun', 'messy'];
  const COATS = ['#2c333d', '#3a2f2a', '#1f2a33', '#413a33', '#2f3a2f', '#4a3a3a',
                 '#26303a', '#3b3b42', '#5a4a3a', '#33404a'];
  const PANTS = ['#1c2027', '#26262b', '#2b2620', '#1a1f26', '#302c28'];
  const SHOES = ['#15171a', '#241f1c', '#1d2126'];
  const BAGCOL = ['#7a2f2f', '#2f4a7a', '#3a3a3a', '#5a4a2a', '#2f5a4a'];

  function baseAppearance(ageBand) {
    return {
      skin: R.pick(SKINS),
      hairStyle: R.pick(HAIRSTYLES),
      hairColor: ageBand === 'old' ? R.pick(['#c9c4bc', '#8a8078', '#6b6560']) : R.pick(HAIRS),
      eyes: 2,
      eyeColor: '#1a1a1a',
      mouth: 'line',
      coatColor: R.pick(COATS),
      pantsColor: R.pick(PANTS),
      shoeColor: R.pick(SHOES),
      hScale: 1,
      sScale: 1,
      shadow: 1,            // 1 正常 / 0 无 / -1 反向
      limbHack: false,      // 四肢关节反向
      extraEyes: 0,
      extraMouth: 0,
      ghostly: false,
      headTurn: 0,
      collarStain: false,
      flicker: false,
      hairRise: false,
      // 无辜但看着不对劲的道具 / 特征（证件照上同样存在）
      decoy: null,
      props: {},
    };
  }

  /* ═══════════════════════════════════════════════════════
     一、真正的问题：会动到"人"身上的突变
     这些一律属于守则6「异常特征」→ 必须拒收
     ═══════════════════════════════════════════════════════ */

  const PERSON_MUTATIONS = [
    { id: 'shadow-flip', w: 10, tell: '地上的影子朝向了灯那边',
      apply(a) { a.shadow = -1; } },
    { id: 'shadow-none', w: 7, tell: '他脚下没有影子',
      apply(a) { a.shadow = 0; } },
    { id: 'eyes-extra', w: 9, tell: '脸上多出了一只眼睛',
      apply(a) { a.extraEyes = 1; } },
    { id: 'mouth-extra', w: 7, tell: '脸颊上又开了一张嘴',
      apply(a) { a.extraMouth = 1; a.mouth = 'line'; } },
    { id: 'head-turn', w: 8, tell: '脖子转过的角度不对',
      apply(a) { a.headTurn = R.chance(0.5) ? 1 : -1; } },
    { id: 'eyes-black', w: 7, tell: '眼白被填成了纯黑',
      apply(a) { a.eyeColor = '#000000'; a.eyes = 2; a.inkEyes = true; } },
    { id: 'gaunt', w: 8, tell: '四肢被拉得过长，比例不对',
      apply(a) { a.hScale = 1.0; a.limbHack = true; a.sScale = 0.62; } },
    { id: 'huge', w: 6, tell: '这个人明显比正常身高高出一截',
      apply(a) { a.hScale = 1.42; } },
    { id: 'ghostly', w: 5, tell: '整个人是半透的，像隔着一层水',
      apply(a) { a.ghostly = true; a.shadow = 0; a.skinAlpha = 0.55; } },
    { id: 'stain', w: 6, tell: '领口有一片深色污渍',
      apply(a) { a.collarStain = true; } },
    { id: 'twitch', w: 6, tell: '身体在无规律地闪动',
      apply(a) { a.flicker = true; a.eyes = 2; } },
    { id: 'hair-up', w: 5, tell: '头发朝着天花板立着',
      apply(a) { a.hairRise = true; } },
    { id: 'tall-thin', w: 5, tell: '肩膀窄得不正常，整个人像一根杆',
      apply(a) { a.hScale = 1.22; a.sScale = 0.7; a.gaunt = true; } },
  ];

  /* ═══════════════════════════════════════════════════════
     二、证件被动手脚（守则 2 / 3 抓）
     ═══════════════════════════════════════════════════════ */

  const DOC_MUTATIONS = [
    { id: 'doc-expired', w: 10, field: 'tamper', tell: '有效期那一栏被人重新写过',
      apply(v) { v.tamper = true; v.tamperFields.push('date'); } },
    { id: 'doc-room', w: 9, field: 'tamper', tell: '房号那一栏被人重新写过',
      apply(v) { v.tamper = true; v.tamperFields.push('room'); } },
    { id: 'doc-name', w: 7, field: 'tamper', tell: '姓名那一栏被人重新写过',
      apply(v) { v.tamper = true; v.tamperFields.push('name'); } },
    { id: 'doc-clean', w: 6, field: 'tamper', tell: '证件被重新打印过，但数据看起来是对的',
      apply(v) { v.tamper = true; v.hardForgery = true; } },
  ];

  /* ═══════════════════════════════════════════════════════
     三、无辜的"看着不对劲"（守则6 的陷阱）
     证件照上完全一致 → 绝不能因此拒收
     ═══════════════════════════════════════════════════════ */

  const DECOYS = [
    { id: 'hood', w: 8, tell: '把兜帽扣在头上，脸看不太清',
      apply(a) { a.props.hood = true; a.hairStyle = 'short'; } },
    { id: 'mask', w: 7, tell: '戴着医用口罩',
      apply(a) { a.props.mask = true; } },
    { id: 'glasses', w: 6, tell: '戴着一副很厚的黑框眼镜',
      apply(a) { a.props.glasses = true; } },
    { id: 'hat', w: 6, tell: '帽檐压得很低',
      apply(a) { a.props.hat = true; a.hairStyle = 'short'; } },
    { id: 'cast', w: 5, tell: '右腿打着石膏，走路一瘸一拐',
      apply(a) { a.props.cast = true; } },
    { id: 'pet', w: 5, tell: '怀里抱着一个鼓鼓的宠物包',
      apply(a) { a.props.pet = true; } },
    { id: 'suitcase', w: 5, tell: '拖着一个很大的行李箱',
      apply(a) { a.props.suitcase = true; } },
    { id: 'tall-ok', w: 6, tell: '个子很高',
      apply(a) { a.hScale = 1.2; } },
    { id: 'hunch', w: 5, tell: '背驼得很厉害',
      apply(a) { a.props.hunch = true; a.hScale = 0.88; } },
    { id: 'parcel', w: 5, tell: '一个人扛着三个纸箱',
      apply(a) { a.props.parcel = true; a.sScale = 0.92; } },
    { id: 'uniform', w: 5, tell: '穿着反光条工装背心',
      apply(a) { a.props.vest = true; } },
    { id: 'wet', w: 4, tell: '浑身湿透，头发贴在额头上',
      apply(a) { a.props.wet = true; a.hairRise = false; } },
  ];

  /* ═══════════════════════════════════════════════════════
     四、楼栋数据
     ═══════════════════════════════════════════════════════ */

  // 已入住居民：房号 → { 姓名, 证件有效期 }
  const RESIDENTS = {};

  // 房号统一为四位：楼层两位 + 房位两位（0301 … 1804）
  const roomNo = f => String(f).padStart(2, '0') + '0' + R.int(1, 4);

  function genResidents() {
    const rooms = [];
    for (let f = 3; f <= 18; f++) rooms.push(roomNo(f));
    R.shuffle(rooms).slice(0, 26).forEach(room => {
      const fem = R.chance(0.5);
      RESIDENTS[room] = {
        name: R.pick(SURNAMES) + R.pick(fem ? GIVEN_F : GIVEN_M),
        valid: '20' + R.int(26, 28) + '-' + String(R.int(1, 12)).padStart(2, '0'),
      };
    });
    return RESIDENTS;
  }

  // 本夜空置、可取钥匙的房号
  function vacantRooms() {
    const out = [];
    for (let i = 0; i < 24; i++) {
      const room = roomNo(R.int(3, 18));
      if (!RESIDENTS[room] && !out.includes(room)) out.push(room);
    }
    return out.slice(0, 2);
  }

  // 被物业标记的房间 → 跨夜固定，按夜数解锁（第 5 夜开始出现）
  function flaggedRooms() {
    return ['1504', '0702', '1201'];
  }

  /* ═══════════════════════════════════════════════════════
     五、访客生成
     ═══════════════════════════════════════════════════════ */

  let seq = 0;

  function makeVisitor(opts) {
    const night   = opts.night;
    const occupied = opts.occupied || {};   // 本夜已放行的房号 → 姓名
    const vacancies = opts.vacancies || [];
    const flagged  = opts.flagged || [];

    seq++;
    const isBug = R.chance(opts.bugRate);

    const v = {
      seq,
      id: 'v' + night + '_' + seq,
      kind: 'resident',
      name: '—',
      room: '—',
      docNumber: 'A' + R.int(100000, 999999),
      issue: '',
      valid: '',
      photo: null,
      outer: null,
      // 判定用的标记
      isBug: isBug,
      tamper: false,
      hardForgery: false,
      tamperFields: [],
      mustReject: isBug,
      tells: [],
      decoyIds: [],
      mutationIds: [],
    };

    /* ── 1. 先决定身份类型 ── */

    const roll = rnd();

    if (roll < 0.20 && vacancies.length) {
      // 新住户：来取钥匙（房号在册子上是空置的）
      // 封存房号不能派新住户：物业封存期不会有钥匙交付，否则第 5 条会冤枉一个合法的人
      v.kind = 'newtenant';
      const openVac = vacancies.filter(r => !flagged.includes(r));
      v.room = R.pick(openVac.length ? openVac : vacancies);
      v.name = R.pick(SURNAMES) + R.pick(R.chance(0.5) ? GIVEN_F : GIVEN_M);
    } else if (roll < 0.32) {
      // 外来人员：维修 / 快递 / 抄表（证上姓名仍是该房号登记住户，工种印在职务栏）
      // 封存房号不派维修单，同理
      v.kind = 'worker';
      const openRooms = Object.keys(RESIDENTS).filter(r => !flagged.includes(r));
      v.room = R.pick(openRooms.length ? openRooms : Object.keys(RESIDENTS));
      v.job = R.pick(WORKER);
    } else {
      // 回住的住户本人
      v.kind = 'resident';
      v.room = R.pick(Object.keys(RESIDENTS));
      v.name = RESIDENTS[v.room].name;
    }

    // 非新住户的证件姓名一律等于该房号的登记住户
    if (v.kind === 'worker') v.name = RESIDENTS[v.room].name;

    /* ── 2. 证件日期 ── */

    if (v.kind === 'resident') {
      v.valid = RESIDENTS[v.room].valid;
    } else if (v.kind === 'newtenant') {
      v.valid = '20' + R.int(27, 29) + '-' + String(R.int(1, 12)).padStart(2, '0');
    } else if (v.kind === 'worker') {
      v.valid = '20' + R.int(26, 27) + '-' + String(R.int(1, 12)).padStart(2, '0');
    } else {
      v.valid = '20' + R.int(26, 27) + '-' + String(R.int(1, 12)).padStart(2, '0');
    }
    v.issue = '温岸市 · 住宅通行证';
    if (v.kind === 'worker') v.issue = '温岸市 · 来访通行证（' + v.job + '）';

    /* ── 3. 基线外观（证件照 = 基线） ── */

    const ageBand = R.chance(0.18) ? 'old' : 'adult';
    const base = baseAppearance(ageBand);

    // 体型差异
    if (v.kind === 'worker') { base.hScale = R.chance(0.5) ? 1.06 : 0.97; }

    v.outer = deepCopy(base);
    v.photo = deepCopy(base);

    /* ── 4. 无辜特征：证件照和本人一致（先于突变套用） ── */

    if (R.chance(0.34)) {
      const n = R.chance(0.25) ? 2 : 1;
      const picked = R.sample(DECOYS, n);
      picked.forEach(d => {
        d.apply(v.photo);
        d.apply(v.outer);
        v.decoyIds.push(d.id);
        v.tells.push({ kind: 'decoy', id: d.id, text: d.tell });
      });
    }

    /* ── 5. 真正的问题（在无辜特征之后套用，保证异常一定压得住诱饵） ── */

    // 证件类突变单独抽出来，供"没有任何可看出破绽"时兜底使用
    function applyDocMutation(m, keepCleanTell) {
      m.apply(v);
      v.mutationIds.push(m.id);
      if (!v.hardForgery || keepCleanTell) v.tells.push({ kind: 'doc', id: m.id, text: m.tell });

      if (m.id === 'doc-expired') {
        // 有效期倒退成去年的日期
        v.valid = '20' + R.int(24, 25) + '-' + String(R.int(1, 12)).padStart(2, '0');
      }
      if (m.id === 'doc-room') {
        // 房号改成同层另一个真实房号
        const floor = v.room.slice(0, 2);
        let alt = floor + '0' + R.int(1, 4);
        if (alt === v.room) alt = floor + '0' + ((R.int(1, 4) + 1) % 4 + 1);
        v.docRoom = alt;
      }
      if (m.id === 'doc-name') {
        v.docName = R.pick(SURNAMES) + R.pick(R.chance(0.5) ? GIVEN_F : GIVEN_M);
      }
    }

    function pickDoc(k) {
      // 第 1 夜还没启用「房号栏不得涂改」这条守则，涂改房号会变成无解的破绽
      let pool = DOC_MUTATIONS.filter(m => (night >= 2 || m.id !== 'doc-room'));
      // 新住户的房号是空置房，姓名本来就无从比对 → "干净的重印证"无据可查
      if (v.kind === 'newtenant') pool = pool.filter(m => m.id !== 'doc-clean');
      return weightedPick(pool.slice(0, k === undefined ? pool.length : k));
    }

    if (isBug) {
      const root = rnd();
      const tellsBefore = v.tells.length;   // 诱饵不计入，只统计"真正的破绽"

      if (root < 0.46) {
        // (a) 人本身不对劲
        const m = weightedPick(PERSON_MUTATIONS);
        m.apply(v.outer);
        v.mutationIds.push(m.id);
        v.tells.push({ kind: 'person', id: m.id, text: m.tell });

        // 高风险夜晚：再叠一层
        if (opts.doubleRate && R.chance(opts.doubleRate)) {
          const m2 = weightedPick(PERSON_MUTATIONS.filter(x => x.id !== m.id));
          m2.apply(v.outer);
          v.mutationIds.push(m2.id);
          v.tells.push({ kind: 'person', id: m2.id, text: m2.tell });
        }

      } else if (root < 0.74) {
        // (b) 证件被涂改（human=false：这些异常不加在"人"身上）
        applyDocMutation(pickDoc());

      } else {
        // (c) 身份信息与楼栋记录完全对不上，但证件本身很干净
        //     外来人员不能走这条路（无法凭外观识破"假冒的快递员"）
        if (v.kind === 'worker') {
          applyDocMutation(pickDoc());
        } else {
          v.kind = 'resident';
          // 封存房号在登记册里只有红字备注、查不到真名，届时姓名比对整条跳过 → 换个房号
          let pool = Object.keys(RESIDENTS).filter(r => !flagged.includes(r));
          if (!pool.length) pool = Object.keys(RESIDENTS);
          v.room = R.pick(pool);
          // 姓名照实印，但这个人根本不住这个房号 —— 由"身份不符"抓住
          v.name = R.pick(SURNAMES) + R.pick(R.chance(0.5) ? GIVEN_F : GIVEN_M);
          // 避免巧合撞上真名
          if (v.name === RESIDENTS[v.room].name) v.name = R.pick(SURNAMES) + '默';
          v.mutationIds.push('identity-mismatch');
          v.tells.push({ kind: 'doc', id: 'identity', text: '这个房号的登记住户不是他' });
        }
      }

      // 兜底①：新住户 + 空置房时姓名无从比对；外来人员又只有"证上姓名"可比。
      //        一旦没有任何可见破绽，补一处证件涂改，保证假证 100% 有迹可循。
      if (v.tells.length - tellsBefore === 0 && v.kind !== 'newtenant') {
        applyDocMutation(pickDoc(), true);
      }

      // 兜底②：凡是"重印的干净证件"（hardForgery）——包括身份与楼栋记录对不上的那种——
      //        都必须留下一处肉眼可见的涂改，否则规则上无据可依。
      if (v.hardForgery) {
        v.hardForgery = false;
        const fld = R.pick(['date', 'room', 'name']);
        v.tamper = true;
        v.tamperFields.push(fld);
        if (!v.mutationIds.includes('doc-' + fld)) v.mutationIds.push('doc-' + fld);
        if (fld === 'date') v.valid = '20' + R.int(24, 25) + '-' + String(R.int(1, 12)).padStart(2, '0');
        if (fld === 'room') {
          const floor = v.room.slice(0, 2);
          let alt = floor + '0' + R.int(1, 4);
          if (alt === v.room) alt = floor + '0' + ((R.int(1, 4) + 1) % 4 + 1);
          v.docRoom = alt;
        }
        if (fld === 'name') v.docName = R.pick(SURNAMES) + R.pick(R.chance(0.5) ? GIVEN_F : GIVEN_M);
        v.tells.push({ kind: 'doc', id: 'worker-forgery', text: '证件有涂改痕迹' });
      }
    }

    /* ── 6. 已知被标记的房间 ── */

    if (!isBug && flagged.includes(v.room) && (v.kind === 'newtenant' || v.kind === 'worker') && R.chance(0.75)) {
      v.isBug = true;
      v.mustReject = true;
      v.mutationIds.push('flagged-room');
      v.tells.push({ kind: 'doc', id: 'flagged', text: '该房号在物业黑名单上' });
    }

    /* ── 7. 一室一人的冲突（由主循环在放行后触发） ── */

    return v;
  }

  /* ─────────── 辅助 ─────────── */

  function weightedPick(list) {
    const total = list.reduce((s, x) => s + x.w, 0);
    let r = rnd() * total;
    for (const x of list) { r -= x.w; if (r <= 0) return x; }
    return list[list.length - 1];
  }

  function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }

  /* ─────────── 对外的生成入口 ─────────── */

  function buildNight(night) {
    const rate = Math.min(0.34 + night * 0.05, 0.62);
    const count = Math.min(3 + night, 8);
    const vacancies = vacantRooms();
    const flagged = night >= 5 ? flaggedRooms() : [];

    const queue = [];
    for (let i = 0; i < count; i++) {
      let v = null;
      // 同一夜不允许出现两组"同房号+同姓名"的真访客，否则守则 4 会冤枉第二个人
      for (let tries = 0; tries < 24; tries++) {
        const cand = makeVisitor({
          night,
          bugRate: rate,
          doubleRate: night >= 4 ? 0.22 : 0,
          vacancies,
          flagged,
        });
        const clash = queue.some(x => x.room === cand.room && x.name === cand.name);
        // 空置房号是每夜共享的，新住户撞同一间不算冲突
        const vacant = vacancies.includes(cand.room);
        if (!clash || vacant) { v = cand; break; }
      }
      queue.push(v || makeVisitor({
        night, bugRate: rate, doubleRate: night >= 4 ? 0.22 : 0, vacancies, flagged,
      }));
    }

    // 第 3 夜起「一室一夜只放行一次」生效：保证本夜至少有一次同房号的二次到访，
    // 否则玩家可能整夜看不到这条守则的作用。二次到访必须排在真住户之后，
    // 这样"第一位被放行、第二位才暴露"的教学顺序才是确定的。
    if (night >= 3 && count >= 3) {
      const srcIdx = [];
      queue.forEach((x, i) => { if (!x.isBug && x.kind === 'resident') srcIdx.push(i); });
      if (srcIdx.length) {
        const si = R.pick(srcIdx);
        const src = queue[si];
        const pool = [];
        for (let i = si + 1; i < queue.length; i++) if (!queue[i].isBug) pool.push(i);

        if (pool.length) {
          const dupe = makeVisitor({ night, bugRate: 1, doubleRate: 0, vacancies: [], flagged: [] });
          dupe.kind = 'resident';
          dupe.room = src.room;
          dupe.name = src.name;
          dupe.isBug = true;
          dupe.mustReject = true;
          dupe.mutationIds.push('room-dupe');
          dupe.tells.push({ kind: 'doc', id: 'dupe', text: '这个房号今夜已经有人回来了' });
          queue[R.pick(pool)] = dupe;
        }
      }
    }

    return { night, queue, vacancies, flagged, rate };
  }

  return {
    R, setSeed, buildNight, makeVisitor, deepCopy,
    RESIDENTS, genResidents, vacantRooms, flaggedRooms,
    PERSON_MUTATIONS, DOC_MUTATIONS, DECOYS,
    SURNAMES, GIVEN_M, GIVEN_F,
  };
})();
