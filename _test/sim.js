/* 无头模拟：逐夜生成访客 -> 用 registry 的守则判定
   目的：验证
   1) 房号格式与楼栋数据一致
   2) 每个假货都有可被"本夜已启用的守则"抓住的破绽（或属于设计内的后期守则）
   3) 真住户不会被规则误拒（保底：不得因为 dupe 规则错拒住户）
   4) 二次到访的假货一定排在真住户之后 */
'use strict';

// ── 浏览器桩：registry.js 需要 document ──
global.document = { getElementById: () => null, createElement: () => ({ getContext: () => ({}) }) };

// 这些文件声明的是顶层 const，用 vm 在同一上下文里执行，才能取到
const fs = require('fs');
const path = require('path');
const vm = require('vm');
for (const f of ['visitor.js', 'registry.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), { filename: f });
}
const V = vm.runInThisContext('Visitors');
const Reg = vm.runInThisContext('Registry');

const DOC_IDS = ['doc-expired', 'doc-room', 'doc-name', 'doc-clean'];
const PERSON_IDS = V.PERSON_MUTATIONS.map(m => m.id);

let visitors = 0, bugs = 0, dupes = 0;
let falseDeny = 0, realLeak = 0, lateOnly = 0, noTell = 0, unfairDupe = 0;
const problems = [];

V.genResidents();
Reg.loadLedger(V.RESIDENTS);

const rooms = Object.keys(V.RESIDENTS);
const badRoom = rooms.filter(r => !/^\d{4}$/.test(r));
console.log('住户数 =', rooms.length, ' 房号格式异常 =', badRoom.length);

for (let night = 1; night <= 9; night++) {
  const active = Reg.activeRulesForNight(night);
  const built = V.buildNight(night);
  Reg.setNightNotes(built.flagged, built.vacancies);
  const released = {};

  let nBugs = 0, nDupes = 0, nLeak = 0;

  built.queue.forEach((v, qi) => {
    visitors++;
    if (v.isBug) { bugs++; nBugs++; }

    const ev = Reg.evaluate(v, {
      activeRules: active, released, vacancies: built.vacancies, flagged: built.flagged,
    });

    /* 1. 真住户（未被人为标记的）绝不能被拒。
         注意：封存房号的外来人员（新住户/工作人员）是"规则上就该拒"的合法拒收，
         它们可能没有 isBug 标记，所以用 mustReject 排除，只报真正的冤枉。 */
    const forced = v.mutationIds.includes('flagged-room') || v.mutationIds.includes('room-dupe');
    if (!v.isBug && ev.verdict === 'deny' && !(v.mustReject && !v.isBug)) {
      falseDeny++;
      problems.push(`[错拒] 第${night}夜 ${v.room} ${v.name} 类型=${v.kind} 规则=${ev.failed.join(',')}`);
    }

    /* 2. 假货必须要么被拦下，要么属于"守则还没启用"的后期破绽 */
    if (v.isBug && ev.verdict === 'allow') {
      // identity-mismatch 的抓手是肉眼可见的「证件照和本人对不上」，
      // 由守则 6（strange）抓，所以它跟人身异常一样要等 strange 启用
      const docOnly = v.mutationIds.some(id => DOC_IDS.includes(id));
      const needsShadow = v.mutationIds.some(id => ['shadow-flip', 'shadow-none', 'ghostly'].includes(id));
      const needsStrange = v.mutationIds.some(id =>
        (PERSON_IDS.includes(id) && !['shadow-flip', 'shadow-none', 'ghostly'].includes(id)) ||
        id === 'identity-mismatch');
      const late = (needsShadow && !active.includes('shadow')) || (needsStrange && !active.includes('strange'));
      if (late) { lateOnly++; nLeak++; }
      else if (docOnly && v.mutationIds.includes('doc-clean') && v.mutationIds.length === 1) {
        // 重印的干净证件只靠"登记册姓名"抓：空置房新住户无册可查（见兜底逻辑，不应发生）
        noTell++; problems.push(`[无据可查] 第${night}夜 ${v.room} ${v.name} ${v.kind}`);
      } else {
        realLeak++;
        problems.push(`[漏放] 第${night}夜 ${v.room} ${v.name} 类型=${v.kind} 突变=${v.mutationIds.join(',')} 破绽=${v.tells.filter(t => t.kind !== 'decoy').map(t => t.id).join(',') || '无'}`);
        if (process.env.DBG) {
          console.log('  DBG v=', JSON.stringify({
            kind: v.kind, room: v.room, name: v.name, hardForgery: v.hardForgery,
            tamper: v.tamper, tamperFields: v.tamperFields, docRoom: v.docRoom, docName: v.docName,
            valid: v.valid, issue: v.issue, mutationIds: v.mutationIds,
            active, rel: JSON.stringify(released), rooms: Object.keys(V.RESIDENTS).length,
            hasRec: !!V.RESIDENTS[v.room], recName: V.RESIDENTS[v.room] && V.RESIDENTS[v.room].name,
          }));
          console.log('  DBG items=', ev.items.map(i => i.rule.id + ':' + (i.pass ? 'ok' : 'NO(' + i.why + ')')).join(' | '));
        }
      }
    }

    /* 3. 二次到访的假货必须排在此房号第一位到访者之后 */
    if (v.mutationIds.includes('room-dupe')) {
      dupes++; nDupes++;
      const firstIdx = built.queue.findIndex(x => x.room === v.room && x.name === v.name);
      if (firstIdx > qi) { unfairDupe++; problems.push(`[顺序] 第${night}夜 ${v.room} 二次到访排在第一位之前`); }
    }

    if (!v.isBug) released[v.room] = v.name;
  });

  console.log(`第${night}夜  守则=${active.length}  到访=${built.queue.length}  假货=${nBugs}  二次到访=${nDupes}  放行后走规则=${nLeak}`);
}

console.log('\n总访客 =', visitors, ' 假货 =', bugs, ' 二次到访 =', dupes);
console.log('错拒真住户 =', falseDeny, ' 真漏放 =', realLeak,
            ' 守则未启用的后期破绽 =', lateOnly, ' 无据可查 =', noTell, ' 顺序错误 =', unfairDupe);
problems.slice(0, 40).forEach(p => console.log('  ' + p));
console.log(problems.length ? '\n结果：仍有 ' + problems.length + ' 处需要关注' : '\n结果：全部不变量通过');
