// 結合の検査(Node): 計画 → マイログ → 分析 → 計画 → … を 4 週間たどる筋書き(test/flow/)。node test/flow_test.cjs で実行する
// 版: v1(11-01)・v2(11-07。名前の変更・移動・計画にない作業を計画に足す)・v3 と v3b(どちらも 11-14)・v4(11-21)。マイログ: 青木・井上・上田(4 週目に江藤)
'use strict';
const fs = require('fs');
const path = require('path');
const Lg = require('../dev/logcore.js');
const T = require('../dev/team.js');
let n = 0, ng = 0;
const ok = (cond, msg) => { n++; if (!cond) { ng++; console.log(`NG  ${msg}`); } };
const D = Lg.parseDate;
const rd = (f) => fs.readFileSync(path.join(__dirname, 'flow', f), 'utf8');
const ALL = [['v1.plan', '2026-11-01', 'v1_src.plan'], ['v2.plan', '2026-11-07', 'v2_src.plan'], ['v3.plan', '2026-11-14', 'v3_src.plan'], ['v3b.plan', '2026-11-14', 'v3b_src.plan'], ['v4.plan', '2026-11-21', 'v4_src.plan']].map(([nm, d, f]) => [nm, `version: ${d}\n${rd(f)}`]);
const plansUpTo = (day) => Lg.sortList(ALL.filter(([, t]) => t.slice(9, 19) <= day).map(([nm, t]) => T.loadPlan(nm, t)));
const logUpTo = (who, day) => rd(`w4_${who}.mylog`).split('\n- ').filter((b, i) => i === 0 || b.slice(0, 10) <= day).join('\n- ');
const tables = (p) => Object.fromEntries(p.tables.map((t) => [t.name, Lg.tsv(t).trimEnd().split('\n')]));
const DAYS = ['2026-11-07', '2026-11-14', '2026-11-21', '2026-12-01'];
const model = (day, who = ['青木', '井上', '上田']) => { const P = plansUpTo(day); return T.model(P, who.map((w) => T.loadLog(`${w}.mylog`, logUpTo(w, day), P, D(day))), { today: D(day) }); };

// 1. 各週: 全員のマイログと版を集めて、全ビューと印刷が描ける。マイログ単体でも描ける
for (const day of DAYS) {
  let err = '';
  try {
    const M = model(day);
    for (const v of T.VIEWS) T.render(M, v.id, {});
    T.printAll(M, {});
    for (const w of ['青木', '井上', '上田']) { const a = Lg.analyze(logUpTo(w, day), plansUpTo(day), { today: D(day) }); for (const v of Lg.VIEWS) Lg.render(a, v.id, { today: D(day) }); }
  } catch (e) { err = e.message; }
  ok(err === '', `${day}: 全ビューと印刷が描ける(${err})`);
}
// 2. 1 人分なら、マイログの表と作業分析の表の値が一致する(区分・始めた日・今の状態・進捗率・合計時間)
{
  let bad = [];
  for (const day of DAYS) for (const w of ['青木', '井上', '上田']) {
    const a = Lg.analyze(logUpTo(w, day), plansUpTo(day), { today: D(day) });
    const my = tables(Lg.pieces(a, 'mytasks', { today: D(day) }));
    const pr = tables(T.pieces(model(day, [w]), 'progress', {}))[`進捗(${day})`] || [];
    for (const [name, t] of Object.entries(my)) if (/タスク$/.test(name) && name !== '確認するタスク') for (const r of t.slice(1)) {
      const c = r.split('\t'), p = pr.find((x) => x.split('\t')[0] === c[0])?.split('\t');
      if (!p) { bad.push(`${day} ${w} ${c[0]} 進捗に行がない`); continue; }
      const st = p[7] === '―' ? p[11] : p[7];
      if (c[3] !== p[4] || c[7].replace('(確認待ち)', '') !== st.replace('(確認待ち)', '') || c[8] !== p[8]) bad.push(`${day} ${w} ${c[0]}`);
    }
  }
  ok(!bad.length, `1 人分なら、マイログと作業分析の表が一致する(${bad.slice(0, 3).join('、')})`);
}
// 3. 計画にない作業(井上の 11-06 の「環境構築」)は、v2 で計画に足すと反映候補から外れる
{
  const R1 = T.reflectData(model('2026-11-06'));
  const R2 = T.reflectData(model('2026-11-07'));
  ok([...R1.extra.keys()].some((k) => k.includes('環境構築')) && ![...R2.extra.keys()].some((k) => k.includes('環境構築')), '計画にない作業は、計画に足した版を足すと反映候補から外れる');
}
// 4. 移動したタスク(書誌APIの実装: 実装 → サーバー実装)は、移動の前の報告が移動の後のタスクの報告になる。依頼と返事も対応する
{
  const M = model('2026-12-01');
  const pr = tables(T.pieces(M, 'progress', {}))['進捗(2026-12-01)'] || [];
  const row = pr.find((x) => x.includes('サーバー実装::書誌APIの実装'));
  ok(row && row.split('\t')[4] === '11-04', `移動したタスクに、移動の前の報告が結び付く(${row})`);
  ok(!M.sig.some((s) => s.code === 'S3' && s.label.includes('書誌APIの実装')), '移動をまたいだ依頼と返事が対応する(S3 が出ない)');
  const tasks = new Set(M.L.r.tasks.map((t) => Lg.labelOfNode(t)));
  ok(M.sig.filter((s) => s.code === 'S8').every((s) => tasks.has(s.label) || !s.label.includes('::')), 'S8 は基準日の版のタスクだけに出る');
}
// 5. 名前を変えたタスク・移動したタスクの問題も「解決を記録」で書けて、閉じる
{
  const P = plansUpTo('2026-11-10'), today = D('2026-11-10');
  for (const [w, extra] of [['青木', ''], ['井上', '- 2026-11-06\n  - 書誌APIの実装 issue: 認証が通らない\n']]) {
    const text = logUpTo(w, '2026-11-09') + extra;
    const a = Lg.analyze(text, P, { today });
    const open = Lg.openProblems(Lg.allRecs([{ who: a.who, recs: a.recs }], today));
    let all = open.length > 0;
    for (const { r } of open) {
      const res = Lg.writeSolved(text, {}, a, today, r.key, r.name, '直した');
      const b = res.error ? null : Lg.analyze(res.text, P, { today });
      if (!b || Lg.openProblems(Lg.allRecs([{ who: b.who, recs: b.recs }], today)).some((x) => x.r.line === r.line)) all = false;
    }
    ok(all, `${w}: 名前の変更・移動の後の問題も、解決を記録で閉じる`);
  }
}
// 6. 同じ日付に 2 回保存した版(v3・v3b): マイログの計画の変更は、前の日付の版(v2)と比べる
{
  const a = Lg.analyze(logUpTo('上田', '2026-11-14'), plansUpTo('2026-11-14'), { today: D('2026-11-14') });
  const pc = Lg.planChanges(a);
  ok(pc && pc.A.name === 'v2.plan' && pc.B.name === 'v3b.plan' && pc.rows.length > 0, `同じ日付に 2 回保存しても、計画の変更は前の日付の版と比べる(${pc && pc.A.name} → ${pc && pc.B.name}、${pc && pc.rows.length} 行)`);
}
// 7. 4 週目に途中で入った人(江藤)のマイログも集計に入る
{
  const M = model('2026-12-01', ['青木', '井上', '上田', '江藤']);
  ok(M.members.includes('江藤') && M.logs.some((l) => l.who === '江藤'), '途中で入った人のマイログも集計に入る');
}
// 8. 途中で足したタスク(v3 の予約APIの実装)は、版の日付より前に置かれず、足した日に遅延にならない(プロジェクト計画の仕様書 6.3 節)
{
  const M = model('2026-11-14');
  const t = M.tasks.find((x) => x.t.name === '予約APIの実装');
  ok(t && t.s >= D('2026-11-14') && t.cat !== 'late' && !M.sig.some((s) => s.code === 'S5' && s.label.includes('予約APIの実装')), `途中で足したタスクは、足した日に遅延にならない(${t && Lg.fmtDate(t.s)}、${t && t.cat})`);
}
console.log(`${n} 件中 ${ng} 件失敗`);
process.exit(ng ? 1 : 0);
