/* 外观系统探针：
   1) 房号格式                   2) 同一夜内同一房号的脸必须完全一致
   3) 同一夜内不同房号的脸应当不重样  4) 换一夜应当换一批脸
   5) 本夜脸表的覆盖率           6) 新增的 build / extra / 发型 分布
   7) identity-mismatch 是否带上了视觉标记
*/
'use strict';

global.document = { getElementById: () => null, createElement: () => ({ getContext: () => ({}) }) };
const fs = require('fs');
const path = require('path');
const vm = require('vm');
for (const f of ['visitor.js', 'registry.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), { filename: f });
}
const V = vm.runInThisContext('Visitors');
const Reg = vm.runInThisContext('Registry');

const line = (s) => console.log(s);
let fail = 0;
const bad = (s) => { fail++; line('  ✗ ' + s); };

V.setSeed(20240607);
const rooms = Object.keys(V.genResidents());
Reg.loadLedger(V.RESIDENTS);
line('住户数 = ' + rooms.length);

const HAIRSTYLES = new Set(), BUILDS = new Set(), EXTRAS = new Set(), SKINS = new Set();

/* 只有这些字段是"这个人的长相"的不变量。
   诱饵会动 hairStyle / hScale / sScale / props，
   突变会动 shadow / eyes / eyeColor / mouth / hScale / sScale / extraEyes 等，
   所以判定"照片是不是本夜该房号的脸"时只比肤色、发色、衣着颜色、附加特征。 */
function coreKey(a) {
  return [a.skin, a.hairColor, a.coatColor, a.pantsColor, a.shoeColor, a.extra].join('|');
}

// 保留全字段版本，仅用于"今晚生成过哪些不同的脸"的统计
function faceKey(a) {
  return [a.skin, a.hairStyle, a.hairColor, a.coatColor, a.pantsColor, a.shoeColor,
          a.hScale, a.sScale, a.eyes, a.eyeColor, a.mouth, a.extra].join('|');
}

const nightTable = {};   // night -> { room: key }
const allHair = new Set();
const allFaces = new Set();

for (let night = 1; night <= 6; night++) {
  const built = V.buildNight(night);
  const tbl = {};
  let idmismatchSeen = 0, markedOk = 0;

  built.queue.forEach(v => {
    const f = V.faceFor(v.room);
    if (!f) { bad('第' + night + '夜 ' + v.room + ' faceFor 返回空'); return; }

    // 2) 证件照应当就是"本夜该房号的脸"（诱饵与突变会动别的字段，这里只比不变量）
    if (coreKey(v.photo) !== coreKey(f)) {
      bad('第' + night + '夜 ' + v.room + ' 证件照的核心长相 ≠ 本夜该房号的脸' +
          '  [' + coreKey(v.photo) + '] vs [' + coreKey(f) + ']');
    }

    if (tbl[v.room] && tbl[v.room] !== coreKey(f)) {
      bad('第' + night + '夜 ' + v.room + ' 同一夜出现两张不同的脸');
    }
    tbl[v.room] = coreKey(f);
    allFaces.add(faceKey(f));
    allHair.add(f.hairStyle);
    HAIRSTYLES.add(f.hairStyle);
    BUILDS.add(f.build);
    EXTRAS.add(f.extra);
    SKINS.add(f.skin);

    if (v.mutationIds.includes('identity-mismatch')) {
      idmismatchSeen++;
      // 7) 必须有视觉标记 + 能被 strange 规则抓住
      if (v.outer.idMismatch === true) markedOk++;
      else bad('第' + night + '夜 ' + v.room + ' identity-mismatch 没有视觉标记');
      const ev = Reg.evaluate(v, { activeRules: ['valid','name','room','dupe','shadow','flagged','strange'],
                                   released: {}, vacancies: built.vacancies, flagged: built.flagged });
      if (ev.verdict !== 'deny') bad('第' + night + '夜 ' + v.room + ' identity-mismatch 在守则全开时仍被放行');
    }
  });

  nightTable[night] = tbl;
  // 2) 同房号在不同"取脸时刻"必须稳定：再取一次
  built.queue.forEach(v => {
    if (coreKey(V.faceFor(v.room)) !== tbl[v.room]) {
      bad('第' + night + '夜 ' + v.room + ' 同一夜两次取脸不一致');
    }
  });

  const keys = Object.keys(tbl);
  line(`第${night}夜  生成脸=${keys.length}  identity-mismatch=${idmismatchSeen}(有标记 ${markedOk})`);
}

// 4) 换夜换脸
let sameAcrossNights = 0;
Object.keys(nightTable[1]).forEach(r => {
  if (nightTable[5] && nightTable[5][r] && nightTable[1][r] === nightTable[5][r]) sameAcrossNights++;
});
const overlap = Object.keys(nightTable[1]).filter(r => nightTable[5] && nightTable[5][r]).length;
line('');
line('第1夜与第5夜共同房号 = ' + overlap + '，其中脸完全相同的 = ' + sameAcrossNights);
if (overlap > 2 && sameAcrossNights === overlap) bad('换夜没有换脸');

// 3) 同夜不同房号不重样
let dup = 0;
Object.keys(nightTable).forEach(n => {
  const seen = {};
  Object.keys(nightTable[n]).forEach(r => {
    const k = nightTable[n][r];
    if (seen[k]) dup++;
    seen[k] = true;
  });
});
if (dup) bad('同一夜内有 ' + dup + ' 组重复的脸');

line('');
line('用到的发型 = ' + Array.from(HAIRSTYLES).sort().join(', '));
line('用到的体态 = ' + Array.from(BUILDS).sort().join(', '));
line('用到的附加 = ' + Array.from(EXTRAS).sort().join(', '));
line('用到的肤色 = ' + SKINS.size + ' 种，不同脸总数 = ' + allFaces.size);
line('');
line(fail ? '结果：' + fail + ' 处问题' : '结果：外观系统全部通过');
process.exit(fail ? 1 : 0);
