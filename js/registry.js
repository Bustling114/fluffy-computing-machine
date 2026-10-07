/* ══════════════════════════════════════════════════════════
   registry.js — 楼栋登记册 + 守则判定
   所有"能不能放行"的判断都收在这里，叙事规则与逻辑一一对应
   ══════════════════════════════════════════════════════════ */

const Registry = (() => {

  /* ═══════════════════════════════════════════════════════
     守 则 手 册
     ═══════════════════════════════════════════════════════ */

  // 伪造/过期的日期以 2019 年为起点，绝不会误伤真实日期
  const EXPIRY_FLOOR = '2019-12';

  const RULES = [
    {
      id: 'valid',
      name: '第 1 条 · 证件必须仍在有效期内',
      desc: '有效期已经过去的通行证一律作废。哪怕对方说得再有道理，也请让他明天带新证来。',
      tags: ['证'],
    },
    {
      id: 'name',
      name: '第 2 条 · 证件上的姓名必须与该房号的登记住户一致',
      desc: '登记册上写的是谁，来的就必须是谁。姓名对不上，说明这张证不是他的。',
      tags: ['证', '册'],
    },
    {
      id: 'room',
      name: '第 3 条 · 房号栏不得有涂改痕迹',
      desc: '被重新写过的房号一律视为伪造。哪怕改后的房号确实存在，也不能放行。',
      tags: ['证'],
    },
    {
      id: 'dupe',
      name: '第 4 条 · 同一房号，当夜只放行一次',
      desc: '一个房间一夜只该回来一个人。同房号的第二位来客，让他去物业办公室等天亮。',
      tags: ['册'],
    },
    {
      id: 'flagged',
      name: '第 5 条 · 封存房号不得放入外人',
      desc: '登记册备注栏里带红字的房号，属于封存或纠纷单位。取钥匙的新住户、上门维修和快递——都不许进。本来就是那间屋的住户除外。',
      tags: ['册'],
    },
    {
      id: 'shadow',
      name: '第 6 条 · 影子不对的，不是人',
      desc: '门厅吊灯在来客正前方偏左。影子该落在他身后偏右。影子方向不对、或者根本没有影子的——不要开门，不要出声。',
      tags: ['眼'],
    },
    {
      id: 'strange',
      name: '第 7 条 · 人身上出现不该有的东西，一律拒收',
      desc: '多出来的眼睛和嘴、转过头的脖子、被拉长的四肢、领口的深色痕迹。证件照上是什么样，站在门口的就该是什么样。',
      tags: ['眼'],
    },
  ];

  /* ═══════════════════════════════════════════════════════
     单据语义比对（模拟 OCR：逐栏核对外观）
     ═══════════════════════════════════════════════════════ */

  function docName(v) {
    return v.docName !== undefined ? v.docName : v.name;
  }
  function docRoom(v) {
    return v.docRoom !== undefined ? v.docRoom : v.room;
  }

  /**
   * 对外公布的单据内容（画面/文案用）
   * 涂改的栏位会被标记出来，交给渲染层加"重新写过"的视觉效果
   */
  function docFields(v) {
    return {
      name: { value: docName(v), tampered: v.tamperFields.includes('name') },
      room: { value: docRoom(v), tampered: v.tamperFields.includes('room') },
      date: { value: v.valid, tampered: v.tamperFields.includes('date') },
      issue: { value: v.issue, tampered: false },
      number: { value: v.docNumber, tampered: false },
    };
  }

  /* ═══════════════════════════════════════════════════════
     登记册数据 -> 对内查询
     ═══════════════════════════════════════════════════════ */

  // 已入住居民 房号 -> { name, valid, note }
  const ledger = {};

  function loadLedger(residents) {
    Object.keys(ledger).forEach(k => delete ledger[k]);
    Object.keys(residents).forEach(room => {
      ledger[room] = {
        room,
        name: residents[room].name,
        valid: residents[room].valid,
        note: '',
        noteLevel: 0,
      };
    });
  }

  function setNightNotes(flaggedRooms, vacancies) {
    // 清理上一夜的临时备注
    Object.keys(ledger).forEach(r => {
      if (ledger[r].noteLevel === 2) { ledger[r].note = ''; ledger[r].noteLevel = 0; }
    });
    (flaggedRooms || []).forEach(room => {
      if (ledger[room]) {
        ledger[room].note = '物业封存 · 禁止放行';
        ledger[room].noteLevel = 2;
      } else {
        ledger[room] = { room, name: '—', valid: '—', note: '物业封存 · 禁止放行', noteLevel: 2 };
      }
    });
    return vacancies || [];
  }

  /* ═══════════════════════════════════════════════════════
     判定核心
     ═══════════════════════════════════════════════════════ */

  /**
   * @param v        访客对象
   * @param state    { night, activeRules:[id], released:{} 房号->姓名, flagged:[], vacancies:[] }
   * @returns { items:[{rule, pass, why, checked}], verdict:'allow'|'deny'|null, failed:[...] }
   */
  function evaluate(v, state) {
    if (!v) return { items: [], verdict: null, failed: [] };

    const active = state.activeRules || RULES.map(r => r.id);
    const f = docFields(v);
    const rec = ledger[v.room];
    const items = [];
    const failed = [];

    const isWorker = v.kind === 'worker';
    const isVacant = (state.vacancies || []).includes(v.room);
    // 同房号 + 同姓名 = 一室一夜的第二位来客（工作人员不占额度）
    const prevSame = (state.released || {})[v.room];
    const isDupe = !isWorker && !!prevSame && prevSame === v.name;

    for (const rule of RULES) {
      if (!active.includes(rule.id)) continue;

      let pass = true;
      let why = '';
      let checked = true;

      switch (rule.id) {

        case 'valid': {
          if (f.date.tampered) {
            pass = false;
            why = '有效期栏有重新书写的痕迹';
          } else if (f.date.value <= EXPIRY_FLOOR) {
            pass = false;
            why = '证件已于 ' + f.date.value + ' 过期';
          }
          break;
        }

        case 'name': {
          if (f.name.tampered) {
            pass = false;
            why = '姓名栏有重新书写的痕迹';
          } else if (v.hardForgery) {
            // 重新打印的干净假证：只能靠登记册发现
            pass = false;
            why = '该房号在登记册上不是这个名字';
          } else if (isVacant && v.kind === 'newtenant') {
            checked = true;                       // 空置房 + 新住户来取钥匙，姓名无从比对，视为通过
          } else if (isVacant) {
            pass = false;
            why = '这个房号今夜空置，没有登记住户';
          } else if (!rec) {
            pass = false;
            why = '登记册上没有这个房号';
          } else if (rec.noteLevel === 2 && (rec.name === '—' || docName(v) === rec.name)) {
            // 封存房号：住户本人（姓名对得上）或册上本来就没有住户名时，交给第 5 条处理
          } else if (docName(v) !== rec.name) {
            pass = false;
            why = '登记住户是「' + rec.name + '」';
          }
          break;
        }

        case 'room': {
          if (f.room.tampered) {
            pass = false;
            why = '房号栏的字迹被覆盖过';
          }
          break;
        }

        case 'dupe': {
          if (isDupe) {
            pass = false;
            why = '这个房号今夜已经放行过「' + prevSame + '」了';
          }
          break;
        }

        case 'flagged': {
          // 封存房号不能再让外来的人进去（新住户取钥匙、维修/快递都不行）；
          // 但原本就住在那儿的人要回家，没有理由拦下他。
          if (rec && rec.noteLevel === 2 && (v.kind === 'newtenant' || v.kind === 'worker')) {
            pass = false;
            why = '该房号已封存（' + rec.note + '），不能让外来的人进去';
          }
          break;
        }

        case 'shadow': {
          const a = v.outer;
          if (a.shadow === 0) {
            pass = false;
            why = '他脚下没有影子';
          } else if (a.shadow === -1) {
            pass = false;
            why = '影子朝向光源那一侧';
          }
          break;
        }

        case 'strange': {
          const a = v.outer;
          const flags = [];
          if (a.extraEyes > 0) flags.push('多出的眼睛');
          if (a.extraMouth) flags.push('多出的嘴');
          if (a.headTurn) flags.push('颈部角度异常');
          if (a.inkEyes) flags.push('眼窝全黑');
          if (a.limbHack) flags.push('四肢比例异常');
          if (a.collarStain) flags.push('领口污渍');
          if (a.ghostly) flags.push('身体半透');
          if (a.flicker) flags.push('躯体闪烁');
          if (a.hairRise) flags.push('毛发逆重力');
          if (a.gaunt) flags.push('肩宽与身高不成比例');
          if (a.hScale > 1.3) flags.push('身高异常');

          // 肩宽/身高比：只抓明显不成比例的（正常体型含"驼背""偏瘦"都在安全区内）
          const sh = 1 - (1 - Math.min(Math.max(a.sScale || 1, 0.85), 1.1)) * 0.35;
          const ratio = (6.2 * sh) / (30 * (a.hScale || 1));
          if (ratio < 0.155) flags.push('身形细得像一根杆');
          if (flags.length) {
            pass = false;
            why = flags.join('、');
          }
          break;
        }
      }

      if (!pass) failed.push(rule.id);
      items.push({ rule, pass, why, checked });
    }

    // 记录（登记册）类守则在没人递证时也该被核对
    const verdict = failed.length ? 'deny' : 'allow';
    return { items, verdict, failed, docFields: f, record: rec || null };
  }

  /* ═══════════════════════════════════════════════════════
     每夜启用的守则
     ═══════════════════════════════════════════════════════ */

  function activeRulesForNight(night) {
    const plan = {
      1: ['valid', 'name'],
      2: ['valid', 'name', 'room'],
      3: ['valid', 'name', 'room', 'dupe'],
      4: ['valid', 'name', 'room', 'dupe', 'shadow'],
      5: ['valid', 'name', 'room', 'dupe', 'shadow', 'flagged'],
      6: ['valid', 'name', 'room', 'dupe', 'shadow', 'flagged', 'strange'],
    };
    if (plan[night]) return plan[night];
    return RULES.map(r => r.id);      // 第 7 夜起：全部守则
  }

  function rulesForNight(night) {
    const ids = activeRulesForNight(night);
    return RULES.filter(r => ids.includes(r.id));
  }

  function newRulesAt(night) {
    const prev = night <= 1 ? [] : activeRulesForNight(night - 1);
    return rulesForNight(night).filter(r => !prev.includes(r.id));
  }

  /* ═══════════════════════════════════════════════════════
     登记册视图（只显示与来客有关的行，避免信息过载）
     ═══════════════════════════════════════════════════════ */

  function ledgerView(v, state, max) {
    max = max || 12;
    const all = Object.values(ledger).sort((a, b) => a.room.localeCompare(b.room));
    if (!v) return all.slice(0, max);

    const target = v.room;
    const floor = target.slice(0, 2);
    const near = all.filter(r => r.room.slice(0, 2) === floor);
    const rest = all.filter(r => r.room.slice(0, 2) !== floor);

    // 本层优先，其次补充
    const out = near.concat(rest);
    return out.slice(0, max);
  }

  function recordFor(room) { return ledger[room] || null; }

  return {
    RULES, evaluate, docFields, docName, docRoom, recordFor,
    loadLedger, setNightNotes, ledgerView, ledger,
    activeRulesForNight, rulesForNight, newRulesAt,
  };
})();
