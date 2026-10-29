// チームログの計算部の検査(Node)。node test/team_test.cjs で実行する
'use strict';
const fs = require('fs');
const path = require('path');
const Lg = require('../dev/logcore.js');
const T = require('../dev/team.js');
let n = 0, ng = 0;
const ok = (cond, msg) => { n++; if (!cond) { ng++; console.log(`NG  ${msg}`); } };
const D = Lg.parseDate;
const rd = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const tsvOf = (M, view, name, ctx = {}) => { const t = T.pieces(M, view, ctx).tables.find((x) => x.name === name || x.name.startsWith(name)); return t ? Lg.tsv(t).split('\n').filter((x) => x) : null; };
// 例(付録 A)
const examplePlans = () => Lg.sortList([Lg.loadPlan('sample_old.plan', rd('sample_old.plan')), Lg.loadPlan('sample.plan', rd('sample.plan'))]);
const exampleLogs = (plans, today) => [['青木', 'aoki'], ['井上', 'inoue'], ['上田', 'ueda']].map(([w, k]) => T.loadLog(`${w}.mylog`, rd(`sample_${k}.mylog`), plans, today));

// ---- 9.1 節 plans(計画書の一覧と、マイログの一覧 logs)
{
  const plans = [{ name: 'a.plan', text: 'version: 2026-01-01\nx' }], logs = [{ name: '青木.mylog', text: 'by: 青木\n' }];
  const t1 = T.toPlans(plans, logs), t2 = T.toPlans(plans.map((x) => ({ ...x })), logs.map((x) => ({ ...x, extra: 1 })));
  ok(t1 === t2 && t1.startsWith('{\n  "format": "projalysis-plans",\n  "files": [\n    {\n      "name": "a.plan",\n      "text":') && t1.includes('\n  ],\n  "logs": [\n') && t1.endsWith('}\n'), 'plans: 同じ一覧から同じファイル(キーの順 format・files・logs と字下げを固定)');
  const r = T.fromPlans(`﻿${t1.replace(/\n/g, '\r\n')}`);
  ok(r.ok && JSON.stringify(r.plans) === JSON.stringify(plans) && JSON.stringify(r.logs) === JSON.stringify(logs), 'plans: 読み戻すと同じ 2 つの一覧(BOM・CRLF も読む)');
  const t0 = T.toPlans(plans, []);
  ok(!t0.includes('"logs"') && t0 === `${JSON.stringify({ format: 'projalysis-plans', files: plans }, null, 2)}\n` && T.fromPlans(t0).ok && T.fromPlans(t0).logs.length === 0, 'plans: マイログの一覧が空なら logs を書かず、計画書だけの plans と同じファイル。logs のない plans も読む');
  ok(!T.fromPlans('{"format":"teamlog-files","plans":[],"logs":[]}').ok && !T.fromPlans('not json').ok && !T.fromPlans('{"format":"projalysis-plans","files":[{"name":1}]}').ok && !T.fromPlans('{"format":"projalysis-plans","files":[],"logs":[{"name":"a"}]}').ok, 'plans: 形の合わないファイルは読まない');
}

// ---- 4.2 節 足す規則
{
  const list = [T.loadLog('a.mylog', 'by: 青木\n- 2026-01-01\n  - x hours: 1\n', [], D('2026-01-02'))];
  ok(T.classifyLog(list, 'b.mylog', 'by: 青木\r\n- 2026-01-01\r\n  - x hours: 1\r\n').kind === 'dup', '同じテキスト(改行の違いは同じとみなす)は足さない');
  const c = T.classifyLog(list, 'c.mylog', 'by: 青木\n- 2026-01-02\n  - x hours: 1\n');
  ok(c.kind === 'conflict' && c.index === 0 && c.by === '青木', '同じ by: で違うテキストは尋ねる');
  ok(T.classifyLog(list, 'd.mylog', 'by: 井上\n').kind === 'new', '別の人は足す');
  ok(T.moveLog(list, 0, -1) === null && T.moveLog([...list, list[0]], 0, 1).length === 2, '並べ替え');
}

// ---- 例(付録 A)を基準日 2026-04-30 で
const today = D(T.EXAMPLE_TODAY);
const plans = examplePlans();
const list = exampleLogs(plans, today);
const M = T.model(plans, list, { today });
ok(list.every((x) => x.a.ok && x.nWarn === 0), '例: 3 人のマイログは計画と照合して診断が出ない');
ok(M.ws === 3 && M.notes.length === 0 && M.members.join(',') === '青木,井上,上田', '例: 週の始まりは水曜、注意なし、メンバーは members: の順');
{
  // 7 章 依頼
  const q = tsvOf(M, 'requests', '依頼の一覧');
  ok(q.length === 5 && q[1].endsWith('未対応(5 日)') && q[2].includes('2026-04-28\tSMTP は大学のサーバーを使う\t対応済み') && q[3].includes('\tng\t対応済み') && q[4].endsWith('未対応(1 日)'), '例: 依頼の一覧(4 件。同じ日の返事も対応)');
  const r = tsvOf(M, 'requests', '受けた依頼');
  ok(r[1] === '青木\t1\t1\t0\t―\t1' && r[2] === '井上\t3\t1\t2\t5\t0' && r[3] === '上田\t0\t0\t0\t―\t0', '例: 受けた依頼の表(差し戻しは reviewed: ng の数)');
  // 6 章 要確認
  ok(M.sig.map((x) => x.code).join(',') === 'S3,S4,S5,S5,S5', `例: 要確認は S3・S4・S5(${M.sig.map((x) => x.code).join(',')})`);
  // 9 章 反映候補
  const ch = tsvOf(M, 'reflect', '進捗の変更');
  ok(ch.length === 5 && ch[1].startsWith('2.2.2 ') && ch[2].startsWith('2.2.3 ') && ch[3].startsWith('3.2.2 ') && ch[4].startsWith('3.2.4 '), '例: 進捗の変更の候補 4 件');
  const mc = tsvOf(M, 'reflect', 'MOP のチェック');
  ok(mc.length === 2 && mc[1].startsWith('通知::登録確認メール\t予定の登録から 1 分以内にメールが届く'), '例: MOP のチェックの候補は登録確認メールだけ(日時の設定は計画で確認済み)');
  // 8.3 節 進捗
  const pr = tsvOf(M, 'progress', '進捗');
  const row = (num) => pr.find((x) => x.startsWith(`${num}\t`)).split('\t');
  ok(pr.length === 16 && row('2.2.3')[6] === '遅延(2 日)' && row('2.2.3')[7] === '実行中(確認待ち)' && row('3.1.1')[6] === '遅延(1 日)' && row('3.2.1')[6] === '開始予定日がまだ先' && row('3.2.2')[4] === '04-29' && row('1.1.1')[5] === '04-23' && row('2.2.2')[5] === '―', '例: 進捗の表(区分・始めた日・完了した日・確認待ち)');
  ok(pr.slice(1).map((x) => x.split('\t')[0]).join(',') === '1.1.1,1.2.1,1.2.2,1.2.3,1.2.4,2.1.1,2.2.1,2.2.2,2.2.3,2.3.1,3.1.1,3.2.1,3.2.2,3.2.3,3.2.4', '例: 進捗の表は WBS の木の順');
  // 8.6 節 負荷
  const ld = tsvOf(M, 'load', 'メンバーごとの負荷');
  ok(ld[1] === '青木\t5\t11\t2\t1\t24\t4' && ld[2] === '井上\t1\t7\t0\t0\t14.5\t4' && ld[3] === '上田\t2\t6\t1\t0\t20\t0', '例: メンバーごとの負荷');
  // 6.13 節 影響を受けるタスク
  const im = tsvOf(M, 'impact', '影響を受けるタスク');
  ok(im.length === 5 && im[1].includes('\t3.2.2 テストフェーズ::結合テスト::ユーザ登録APIとデータベースの接続テスト\t直接\t') && im[4].includes('影響を受けるタスクはありません'), '例: 影響を受けるタスク');
  // 8.2 節 作業時間(タスク×週)
  const ht = tsvOf(M, 'hoursTasks', '作業時間(タスク×週)');
  ok(ht[0] === 'WBS 番号\t記録先\t04-22〜\t04-29〜\t合計時間\t計画の日数\t作業日数' && ht.some((x) => x === '2.2.3\t実装フェーズ::API実装::通知用APIの実装\t11.5\t2\t13.5\t3\t4') && ht[ht.length - 1] === '\t合計\t58.5\t8\t66.5\t\t', '例: 作業時間(タスク×週)の WBS 番号・計画の日数・作業日数');
  // 8.1 節 作業時間(人×週)
  const hp = tsvOf(M, 'hoursPeople', '作業時間(人×週)');
  ok(hp.join('|') === 'メンバー\t04-22〜\t04-29〜\t合計時間|青木\t24\t4\t28|井上\t14.5\t4\t18.5|上田\t20\t0\t20|合計\t58.5\t8\t66.5', '例: 作業時間(人×週)。記録のない週は 0');
  ok(T.pieces(M, 'hoursPeople').figs.length === 1 && T.pieces(M, 'trl').figs.length === 1, '例: 人ごとの作業時間と TRL の折れ線の図');
  // 8.5 節 テストの記録
  const te = tsvOf(M, 'tests', 'テストの記録');
  ok(te.slice(1).map((x) => x.split('\t')[0]).join(',') === '新,再,新' && te[3].includes('\t井上\t'), '例: テストの記録の新/再は誰のマイログかによらない');
  // 8.9 節 MOP の達成状況
  const mp = T.render(M, 'mop').svg;
  ok(mp.includes('MOP 全 7 件: ok 2 件、ng 0 件、未実施 5 件') && tsvOf(M, 'mop', 'MOP の達成状況').some((x) => x.startsWith('通知::登録確認メール\t予定の登録から 1 分以内にメールが届く\t\tok\t2026-04-29\t青木\t2')), '例: MOP の達成状況の数と、テストした回数');
  // 8.8 節 週のまとめ
  ok(T.weekOptions(M).map(Lg.fmtDate).join(',') === '2026-04-29,2026-04-22', '例: 週のまとめの週の選択肢(新しい順)');
  const wk = T.pieces(M, 'week').tables.map((x) => x.name);
  ok(['メンバーごとの記録', 'この週の作業時間', 'この週の問題と解決', 'この週の依頼と返事', 'この週のメモ', 'この週のテスト・TRL・TPM'].every((k) => wk.includes(k)), `例: 今週の週のまとめの表(${wk.join('、')})`);
  const wkp = T.pieces(M, 'week', { week: D('2026-04-22') }).tables.map((x) => x.name);
  ok(wkp.includes('この週に完了したタスク'), '例: 前の週には完了したタスクがある');
  ok(tsvOf(M, 'week', 'メンバーごとの記録').join('|') === 'メンバー\t記録日数\t合計時間|青木\t1\t4|井上\t2\t4|上田\t0\t0', '例: メンバーごとの記録(記録のない人も 0)');
  // 決定的
  // マイログは、model に渡すのと同じ計画書の一覧で読む(画面と同じ。計画書を替えたら読み直す)
  for (const v of T.VIEWS) ok(T.render(M, v.id).svg === T.render((() => { const p2 = examplePlans(); return T.model(p2, exampleLogs(p2, today), { today }); })(), v.id).svg, `ビュー ${v.id} は決定的`);
  ok(T.printAll(M, {}).length >= 12, '印刷はすべてのビュー');
}

// ---- 基準日より後の記録は数えない(8 章)
{
  const M2 = T.model(plans, list, { today: D('2026-04-27') });
  const hp = tsvOf(M2, 'hoursPeople', '作業時間(人×週)');
  ok(hp[0] === 'メンバー\t04-22〜\t合計時間' && hp.some((x) => x === '上田\t20\t20') && hp.some((x) => x === '青木\t19\t19'), `基準日より後の記録は数えない(${hp.join('|')})`);
  ok(M2.reqs.length === 2, '基準日より後の依頼は数えない');
}

// ---- 例の日付をずらしても、同じ表が出る(週の区切りも保つ)
for (const td of ['2026-10-28', '2027-02-01', '2027-03-07']) {
  const d = D(td) - today;
  const p2 = Lg.sortList([Lg.loadPlan('sample_old.plan', Lg.shiftExample(rd('sample_old.plan'), d)), Lg.loadPlan('sample.plan', Lg.shiftExample(rd('sample.plan'), d))]);
  const l2 = [['青木', 'aoki'], ['井上', 'inoue'], ['上田', 'ueda']].map(([w, k]) => T.loadLog(`${w}.mylog`, Lg.shiftExample(rd(`sample_${k}.mylog`), d), p2, D(td)));
  const M3 = T.model(p2, l2, { today: D(td) });
  const same = (v, name) => JSON.stringify(tsvOf(M3, v, name).map((x) => x.replace(/\d{4}-\d{2}-\d{2}|\d{2}-\d{2}/g, '#'))) === JSON.stringify(tsvOf(M, v, name).map((x) => x.replace(/\d{4}-\d{2}-\d{2}|\d{2}-\d{2}/g, '#')));
  ok(l2.every((x) => x.a.ok && x.nWarn === 0) && M3.notes.length === 0 && ['hoursPeople', 'hoursTasks', 'progress', 'load', 'requests'].every((v) => T.pieces(M3, v).tables.every((t) => same(v, t.name.replace(/\(.*$/, '')))) && same('week', 'この週の作業時間') && M3.sig.map((x) => x.code).join(',') === 'S3,S4,S5,S5,S5', `例を ${td} に読み込んでも同じ表と兆候(週の区切りも同じ)`);
}

// ---- 8 章 週の区切りが、そろわないとき・マイログがないとき
{
  const l = [T.loadLog('a.mylog', 'by: a\nweek: wed\n- 2026-01-07\n  - x hours: 1\n', [], D('2026-01-10')), T.loadLog('b.mylog', 'by: b\n- 2026-01-07\n  - x hours: 1\n', [], D('2026-01-10'))];
  const m = T.model([], l, { today: D('2026-01-10') });
  ok(m.ws === 1 && m.notes.some((x) => x.includes('week: がそろっていません(a: wed、b: mon)')), 'week: がそろわないときは月曜で区切り、知らせる');
  ok(T.model([], [], { today: D('2026-01-10') }).ws === 1, 'マイログがないときは月曜');
  const e = T.model([], [T.loadLog('e.mylog', '# x\n', [], D('2026-01-10'))], { today: D('2026-01-10') });
  ok(e.notes.includes('エラーのため集計から除外: e.mylog') && e.logs.length === 0, 'エラーのあるマイログは集計から外して知らせる');
  const d2 = T.model([], [T.loadLog('a.mylog', 'by: a\n', [], 0), T.loadLog('a2.mylog', 'by: a\n- 2026-01-01\n  - x note: y\n', [], 0)], { today: D('2026-01-10') });
  ok(d2.notes.some((x) => x.includes('同じ人(a)のマイログが 2 つあります')), '同じ人のマイログが 2 つあるときは知らせる');
}

// ---- 8.2 節: 名前が変わった記録先は別の行、計画にない名前、FBS の行の番号
{
  const p1 = Lg.loadPlan('1.plan', 'version: 2026-01-01\nstart: 2026-01-05\nmembers:\n- a\nFBS: s\n- f mop: m\nWBS: r\n- 親\n  - 旧名 days: 2 by: a');
  const p2 = Lg.loadPlan('2.plan', 'version: 2026-01-08\nstart: 2026-01-05\nmembers:\n- a\nFBS: s\n- f mop: m\nWBS: r\n- 親\n  - 新名 days: 2 by: a');
  const pl = Lg.sortList([p1, p2]);
  const l = [T.loadLog('a.mylog', 'by: a\n- 2026-01-05\n  - 旧名 hours: 1\n- 2026-01-08\n  - 新名 hours: 2\n  - 親 hours: 1\n  - よそ hours: 1\n  - f trl: 1\n', pl, D('2026-01-09'))];
  const m = T.model(pl, l, { today: D('2026-01-09') });
  const ht = tsvOf(m, 'hoursTasks', '作業時間(タスク×週)').slice(1, -1).map((x) => x.split('\t'));
  ok(ht.map((x) => `${x[0]}|${x[1]}|${x[x.length - 2]}`).join(',') === '1|親|―,1.1|親::新名|2,―|親::旧名(計画から削除)|―,―|よそ(計画にない作業)|―', `名前が変わった記録先は別の行、途中の要素は番号だけ、計画にない名前は「―」(${ht.map((x) => `${x[0]}|${x[1]}`).join(',')})`);
}

// ---- 8.6 節 作成者が 2 人以上のタスク、8.7 節 後続のたどり方
{
  const pl = [Lg.loadPlan('p.plan', 'version: 2026-01-01\nstart: 2026-01-05\nmembers:\n- a\n- b\nWBS: r\n- t1 days: 2 by: a, b\n- 群 after: t1\n  - t2 days: 1 by: a\n  - t3 days: 1 by: b\n- t4 days: 1 by: a after: 群\n- t5 days: 1 by: a after: t4\n- t6 days: 1 by: b after: t1')];
  const l = [T.loadLog('a.mylog', 'by: a\n- 2026-01-05\n  - t1 status: doing\n', pl, D('2026-01-08')), T.loadLog('b.mylog', 'by: b\n- 2026-01-05\n  - t6 hours: 1\n- 2026-01-08\n  - t4 status: done\n', pl, D('2026-01-08'))];
  const m = T.model(pl, l, { today: D('2026-01-08') });
  const ld = tsvOf(m, 'load', 'メンバーごとの負荷');
  ok(ld[1].startsWith('a\t3\t4\t') && ld[2].startsWith('b\t3\t4\t'), `作成者が 2 人以上のタスクは、それぞれに全部の日数を数える(${ld.slice(1).join('|')})`);
  const im = tsvOf(m, 'impact', '影響を受けるタスク').slice(1).map((x) => x.split('\t'));
  const succ = im.filter((x) => x[0].includes(' t1')).map((x) => `${x[2].replace(/^\S+ /, '')}:${x[3]}`);
  ok(succ.join(',') === '群::t2:直接,群::t3:直接,t6:直接,t5:間接', `後続: 途中の要素への after: は下のタスクすべて。完了した t4 は入れないが、その先の t5 は間接として入れる(${succ.join(',')})`);
  const pl2 = [Lg.loadPlan('p.plan', 'version: 2026-01-01\nstart: 2026-01-05\nmembers:\n- a\nWBS: r\n- t1 days: 2 by: a\n- t2 days: 1 by: a after: t1\n- t3 days: 1 by: a after: t2')];
  const m2 = T.model(pl2, [T.loadLog('a.mylog', 'by: a\n- 2026-01-05\n  - t1 status: blocked\n', pl2, D('2026-01-05'))], { today: D('2026-01-05') });
  const im2 = tsvOf(m2, 'impact', '影響を受けるタスク').slice(1).map((x) => `${x[2] ?? ''}`.split('\t')[0]);
  const rows2 = tsvOf(m2, 'impact', '影響を受けるタスク').slice(1).map((x) => x.split('\t')).map((x) => `${x[2].replace(/^\S+ /, '')}:${x[3]}`);
  ok(rows2.join(',') === 't2:直接,t3:間接' && im2.length === 2, `後続: 間接のつながりも入れる(${rows2.join(',')})`);
  ok(T.render(T.model(pl2, [], { today: D('2026-01-01') }), 'impact').svg.includes('遅れているタスクはありません'), '遅れているタスクがないとき');
}

// ---- 計画がないとき・一覧が空のとき
{
  const m = T.model([], [T.loadLog('a.mylog', 'by: a\n- 2026-01-05\n  - x hours: 1 status: doing\n', [], D('2026-01-06'))], { today: D('2026-01-06') });
  ok(T.render(m, 'progress').svg.includes('計画書を読み込むと') && T.render(m, 'reflect').svg.includes('計画書を読み込むと候補を示します') && T.pieces(m, 'hoursPeople').tables.length === 1, '計画がないときも、作業時間は出る');
  for (const v of T.VIEWS) { let e = null; try { T.render(T.model([], [], { today: D('2026-01-06') }), v.id); } catch (x) { e = x; } ok(!e, `一覧が空でもビュー ${v.id} が描ける`); }
}

// ---- 2 回目のレビューで見つかった誤りの検査(版 0.9)
{
  const pl = Lg.sortList([Lg.loadPlan('p.plan', 'version: 2026-01-01\nstart: 2026-01-05\nmembers:\n- a\n- b\nWBS: r\n- t1 days: 3 by: a\n- t2 days: 3 by: b\nFBS: f\n- 機能 mop: 動く\n')]);
  const td = D('2026-01-30');
  const la = T.loadLog('a.mylog', 'by: a\nweek: mon\n- 2026-01-05\n  - t1 hours: 1 issue: 詰まった ask: b\n- 2026-01-12 note: 講義の日\n- 2026-01-19\n  - 機能 trl: 3\n', pl, td);
  const lb = T.loadLog('b.mylog', 'by: b\nweek: mon\n- 2026-01-05\n  - t1 solved: 手伝った\n', pl, td);
  const lbErr = T.loadLog('b.mylog', 'by: b\n# 見出し\n', pl, td);
  // T6: 同じ日の別の人の solved: は、一覧の順によらず閉じる
  const s2 = (list) => T.model(pl, list, { today: td }).sig.filter((x) => x.code === 'S2').length;
  ok(s2([la, lb]) === 0 && s2([lb, la]) === 0, 'T6: 同じ日の別の人の solved: は、一覧の順によらず問題を閉じる');
  // T5: エラーのマイログしかない人は「マイログがありません」とせず、S1 にも出さない。依頼の状態にはエラーのためと添える
  const me = T.model(pl, [la, lbErr], { today: td });
  ok(!me.sig.some((x) => x.code === 'S1' && x.who === 'b') && me.errLog.join() === 'b' && !me.noLog.includes('b'), 'T5: エラーのマイログしかない人は、マイログがない人として扱わない');
  ok((tsvOf(me, 'requests', '依頼の一覧') || []).some((x) => x.includes('相手のマイログにエラーがあり')) && me.sig.some((x) => x.code === 'S3' && x.text.includes('エラーがあり')), 'T5: 依頼の一覧と S3 に、相手のマイログのエラーを添える');
  // T8: TRL の列は、作業時間と同じく、最初の記録の週から
  const m = T.model(pl, [la, lb], { today: td });
  const trl = tsvOf(m, 'trl', 'TRLの推移') || tsvOf(m, 'trl', 'TRL');
  ok(trl && trl[0].split('\t')[1] === '01-05〜' && trl[0].split('\t').length === 5, `T8: TRL の列は最初の記録の週から(${trl && trl[0]})`);
  // T9: 日付の行のメモにも、マイログの行を付ける
  const wk = T.blocks(m, 'week', { week: D('2026-01-12') }).find((x) => x.t === 'table' && x.name === 'この週のメモ');
  ok(wk && wk.rows.length === 1 && wk.rows[0].ref && wk.rows[0].ref.line === 5 && wk.rows[0].ref.file === 0 && T.render(m, 'week', { week: D('2026-01-12') }).svg.includes('data-file="0"'), 'T9: 日付の行のメモにもマイログの行を付ける');
  // M6・T4: メモだけの週も選べる。選べる週にない週を受け取ったら基準日の週
  const lm = T.loadLog('c.mylog', 'by: a\nweek: mon\n- 2025-12-30 note: 準備\n- 2026-01-19\n  - t1 hours: 1\n', pl, td);
  ok(T.weekOptions(T.model(pl, [lm], { today: td })).includes(D('2025-12-29')), 'メモだけの週(最初の記録より前)も週のまとめで選べる');
  ok(T.render(m, 'week', { week: D('2025-06-02') }).svg.includes('週のまとめ(2026-01-26〜2026-02-01)'), 'T4: 選べる週にない週は、基準日の週にする');
  // T2: 完了したタスクの先もたどる(rows2 の検査と合わせて)
}

// ---- 基準日で使う版(6.2 節): 基準日以前の版のうち一覧でいちばん後ろ
{
  const v = (d, st) => Lg.loadPlan(`${d}.plan`, `version: ${d}\nstart: 2026-01-05\nmembers:\n- a\nWBS: r\n- t1 days: 3 by: a${st}`);
  const pl = Lg.sortList([v('2026-01-01', ''), v('2026-01-10', ' status: doing'), v('2026-01-20', ' status: done')]);
  const lg = (td) => [T.loadLog('a.mylog', 'by: a\n- 2026-01-06\n  - t1 hours: 1 status: doing\n- 2026-01-18\n  - t1 hours: 1 status: done\n', pl, td)];
  const used = (d) => { const td = D(d); return T.model(pl, lg(td), { today: td }).L.date; };
  ok(used('2026-01-15') === D('2026-01-10') && used('2026-01-25') === D('2026-01-20') && used('2026-01-10') === D('2026-01-10'), '基準日以前の版のうち、いちばん後ろの版を使う(基準日と同じ日付の版を含む)');
  ok(used('2025-12-31') === D('2026-01-01'), '基準日以前の版がなければ、一覧でいちばん前の版');
  const td = D('2026-01-15'), M = T.model(pl, lg(td), { today: td });
  ok(T.render(M, 'reflect').svg.includes('基準日の版: 2026-01-10 版') && (tsvOf(M, 'reflect', '進捗の変更') === null), `基準日を過去にすると、その時点の版で反映候補を出す(${JSON.stringify(tsvOf(M, 'reflect', '進捗の変更'))})`);
}

// ---- 7.2 節 作業の概要と、8.3 節 開いたときのビュー(例を基準日 2026-04-30 で)
{
  const plans = examplePlans(), td = D('2026-04-30');
  const M = T.model(plans, exampleLogs(plans, td), { today: td });
  const ws = T.workSummary(M);
  ok(ws.rows.map((r) => r[0]).join() === 'マイログ,計画への反映候補,要確認,タスクの区分,作業時間,依頼,MOP' && ws.head.includes('基準日 2026-04-30') && ws.head.includes('基準日の版: 2026-04-22 版'), `作業の概要: 行と表の上の文(${ws.head})`);
  const v = Object.fromEntries(ws.rows);
  ok(v['計画への反映候補'] === '5 件(進捗の変更 4、MOP のチェック 1)' && v['要確認'] === '5 件(S3 1、S4 1、S5 3)' && v['MOP'] === 'ok 2、ng 0、未実施 5(全 7 件)' && v['依頼'] === '未対応 2 件(最も長いもの 5 日)', `作業の概要: 例の数(${JSON.stringify(v)})`);
  ok(v['タスクの区分'].startsWith('遅延 3、問題発生 1、開始予定日を過ぎた未着手 0、実行中 2、開始予定日がまだ先 2、完了 7'), `作業の概要: 区分は 6.9 節の判定の順(${v['タスクの区分']})`);
  ok(T.openingView(M) === 'reflect', '開いたときのビュー: 反映候補があれば反映候補');
  // 反映候補を書き写した版を足すと、要確認、それもなければ概要
  const L0 = rd('sample.plan').split('\n');
  const fix = (key, f) => { const k = L0.findIndex((x) => x.includes(key)); L0[k] = f(L0[k]); };
  fix('ユーザ登録CRUD用APIの実装 for', (x) => x.replace('status: done', 'status: doing'));
  fix('通知用APIの実装 for', (x) => x.replace('status: blocked', 'status: doing'));
  fix('ユーザ登録APIとデータベースの接続テスト for', (x) => `${x} status: doing`);
  fix('予定入力画面と予定登録APIの接続テスト for', (x) => `${x} status: blocked`);
  fix('登録確認メール mop:', (x) => x.replace('mop:', 'mop*:'));
  const p2 = Lg.sortList([...plans, T.loadPlan('new.plan', L0.join('\n').replace('version: 2026-04-22', 'version: 2026-04-30'))]);
  const M2 = T.model(p2, exampleLogs(p2, td), { today: td });
  ok(T.reflectData(M2).total === 0 && T.openingView(M2) === 'alerts', '開いたときのビュー: 反映候補が 0 で要確認があれば要確認');
  const M4 = T.model(plans, [], { today: td });
  ok(T.openingView(M4) === 'overview', '開いたときのビュー: マイログの一覧が空なら概要');
  const pz = [T.loadPlan('z.plan', 'version: 2026-01-01\nstart: 2026-01-05\nmembers:\n- a\nWBS: r\n- t days: 1 by: a status: done')];
  const Mz = T.model(pz, [T.loadLog('a.mylog', 'by: a\n- 2026-01-05\n  - t hours: 1 status: done\n', pz, D('2026-01-06'))], { today: D('2026-01-06') });
  ok(T.reflectData(Mz).total === 0 && Mz.sig.length + Mz.notes.length === 0 && T.openingView(Mz) === 'overview', '開いたときのビュー: 反映候補も要確認もなければ概要');
  ok(pz[0].comparable === true && T.loadPlan('y.plan', 'start: 2026-01-05\nmembers:\n- a\nWBS: r\n- t days: 1 by: a').comparable === false, '計画書の版: 比べられる版 = 照合に使える版');
}

// ---- 夜のバグ探しで見つかった誤りの検査(版 0.41): 2 人分のマイログで、同じ日の blocked と solved: / 別の状態
{
  const plans = [Lg.loadPlan('v1.plan', 'version: 2026-01-01\nstart: 2026-01-01\nmembers:\n- a\n- b\nWBS: r\n- 子 days: 2 by: a')];
  const today = D('2026-01-20');
  const lg = (who, t) => T.loadLog(`${who}.mylog`, `by: ${who}\n- 2026-01-05\n  - 子 ${t}\n`, plans, today);
  const run = (xs) => {
    const t0 = Date.now();
    const M = T.model(plans, xs, { today });
    const r = { ms: Date.now() - t0, s2: M.sig.filter((x) => x.code === 'S2').length, prog: tsvOf(M, 'progress', '進捗').slice(1).join('|') };
    return r;
  };
  const A = lg('a', 'status: blocked'), Bs = lg('b', 'solved: 手伝った'), Bd = lg('b', 'status: doing');
  const r1 = run([A, Bs]), r2 = run([Bs, A]);
  ok(r1.ms < 5000 && r2.ms < 5000 && r1.s2 === 0 && r2.s2 === 0, `ある人の blocked と別の人の同じ日の solved: で、集計が終わり、どちらの順でも閉じる(${r1.ms} ms・${r2.ms} ms)`);
  const d1 = run([A, Bd]), d2 = run([Bd, A]);
  ok(d1.s2 === d2.s2 && d1.prog === d2.prog && d1.s2 === 1 && d1.prog.includes('問題発生'), `同じタスクの別の人の報告は、一覧の順によらず、人ごとの最後の報告でまとめる。1 人でも問題発生なら問題発生(${d1.prog} / ${d2.prog})`);
}

// ---- 記録先の版をまたいだ対応(マイログの仕様書 5.6 節)
{
  // 計画書分析の対応づけ(4 章の match)と、同じ対応になること
  const core = fs.readFileSync(path.join(__dirname, '../dev/core.js'), 'utf8'), diff = fs.readFileSync(path.join(__dirname, '../dev/diff.js'), 'utf8');
  const Dx = new Function('module', 'require', `${core}; ${diff}; return Projalysis;`)(undefined, undefined);
  const P1 = 'version: 2026-03-02\nstart: 2026-03-02\nmembers:\n- 青木\n- 井上\nWBS: r\n- 実装\n  - 画面 days: 3 by: 青木\n  - 部品 days: 3 by: 青木\n- 試験 days: 2 by: 井上\nFBS: f\n- 通知\n  - メール';
  const P2 = 'version: 2026-03-09\nstart: 2026-03-02\nmembers:\n- 青木\n- 井上\nWBS: r2\n- 開発\n  - 画面 days: 3 by: 青木\n- 実装\n  - 部品改 days: 3 by: 青木\n- 試験 days: 2 by: 井上\n  - 画面 days: 1 by: 井上\nFBS: f\n- 連絡\n  - メール';
  const pairs = [['v1.plan', 'v2.plan'], ['v2.plan', 'v3.plan'], ['v1.plan', 'v3.plan'], ['sample_old.plan', 'sample.plan']].map(([x, y]) => [Lg.loadPlan(x, rd(x)), Lg.loadPlan(y, rd(y))]);
  pairs.push([Lg.loadPlan('p1.plan', P1), Lg.loadPlan('p2.plan', P2)]);
  let bad = [];
  for (const [a, b] of pairs) for (const sec of ['WBS', 'FBS']) {
    const m = Dx.match(a.r, b.r, sec);
    const want = [...m.map].map(([x, y]) => `${Lg.keyOf(x)}>${Lg.keyOf(y)}`).sort();
    const got = [...Lg.verMap(a, b)].filter(([x]) => x.startsWith(`${sec}:`)).map(([x, y]) => `${x}>${y}`).sort();
    if (JSON.stringify(want) !== JSON.stringify(got)) bad.push(`${a.name}→${b.name} ${sec}`);
  }
  ok(!bad.length, `版をまたいだ記録先の対応が、計画書分析の対応づけと同じ(${bad.join('、')})`);
  // 作業分析: 記録先は基準日の版の要素に寄せる。移動した前の報告も、移動の後のタスクの報告になる
  const v1 = Lg.loadPlan('p1.plan', P1), v2 = Lg.loadPlan('p2.plan', P2.replace('  - 画面 days: 1 by: 井上\n', '').replace('\n  - 画面 days: 1 by: 井上', ''));
  const lg = T.loadLog('青木.mylog', 'by: 青木\n- 2026-03-03\n  - 画面 hours: 2 status: done progress: 100\n- 2026-03-04\n  - 調査 hours: 3\n', [v1, v2], D('2026-03-20'));
  const M2 = T.model([v1, v2], [lg], { today: D('2026-03-20') });
  const prog = tsvOf(M2, 'progress', '進捗');
  ok(prog.some((x) => x.includes('開発::画面') && x.includes('完了') && x.includes('2026-03-03')), `作業分析: 移動したタスクに、移動の前の報告が結び付く(${prog.join(' / ')})`);
  const M1 = T.model([v1, v2], [lg], { today: D('2026-03-05') });
  ok(M1.L === v1 && M1.recs.find((r) => r.name === '画面').key === 'WBS:実装::画面', '作業分析: 基準日を戻すと、その日の版の記録先に寄せ直す');
  const v3 = Lg.loadPlan('p3.plan', P2.replace('2026-03-09', '2026-03-12').replace('\n  - 画面 days: 1 by: 井上', '\n- 調査 days: 1 by: 青木'));
  ok(v3.usable, '検査の版 p3 が使える');
  const R = T.reflectData(T.model([v1, v2, v3], [T.loadLog('青木.mylog', lg.text, [v1, v2, v3], D('2026-03-20'))], { today: D('2026-03-20') }));
  ok(R && R.extra.size === 0 && [...R.extra.keys()].every((k) => !k.includes('調査')), '計画にない作業は、基準日の版に同じ名前の要素ができたら候補から外す');
}

// ---- 版 0.46: 印刷と一覧の低の項目
{
  // P10 最初のエラーは行の番号のいちばん小さいもの
  const e = T.loadLog('e.mylog', 'version: 2026-04-01\n- 2026-04-02\n# 見出し\n', [], D('2026-04-05'));
  ok(e.firstErr && e.firstErr.line === 1, `マイログの最初のエラーは行の番号のいちばん小さいもの(${e.firstErr && e.firstErr.line})`);
  // P13 幅の広い表は列でも区切る(先頭の列を残す)
  const pl = Lg.loadPlan('s.plan', rd('sample.plan'));
  let t = 'by: 青木\n';
  for (let i = 0; i < 210; i += 7) t += `- ${Lg.fmtDate(D('2026-01-05') + i)}\n  - カレンダデザイン hours: 1\n`;
  const M = T.model([pl], [T.loadLog('a.mylog', t, [pl], D('2026-08-01'))], { today: D('2026-08-01') });
  const pages = T.printAll(M, {});
  const tp = pages.find((p) => p.includes('作業時間(タスク×週)'));
  ok(tp && tp.includes('(列 1/') && tp.includes('(列 2/') && +/width="(\d+)"/.exec(tp)[1] <= 1280 && (tp.match(/カレンダデザイン/g) || []).length >= 2, '幅の広い表は列で区切り、先頭の列(番号・記録先)を各部分に残す');
  // P5 列で区切った概要の印刷で、作業の概要は最初のページだけ
  const core = fs.readFileSync(path.join(__dirname, '../dev/core.js'), 'utf8'), diff = fs.readFileSync(path.join(__dirname, '../dev/diff.js'), 'utf8');
  const Dx = new Function('module', 'require', `${core}; ${diff}; return Projalysis;`)(undefined, undefined);
  const vs = Array.from({ length: 20 }, (_, i) => Dx.load(`v${i}.plan`, rd('sample.plan').replace(/^version: .*$/m, `version: ${Lg.fmtDate(D('2026-01-01') + i)}`)));
  const op = Dx.printPages(vs, 'overview', [vs[0], vs[19]], { work: { head: '基準日 2026-04-30', rows: [['マイログ', '1 人']] } });
  ok(op.length >= 2 && op.filter((p) => p.includes('作業の概要')).length === 1, `列で区切った概要の印刷で、作業の概要は最初のページだけ(${op.length} ページ中 ${op.filter((p) => p.includes('作業の概要')).length})`);
}

// ---- 分担のタスク(マイログの仕様書 4.2 節・4.4 節): 人ごとの最後の報告でまとめる。一覧の順によらない
{
  const pl = Lg.loadPlan('w.plan', 'version: 2026-01-01\nstart: 2026-01-05\nmembers:\n- a\n- b\nWBS: r\n- 共同 days: 5 by: a, b\nFBS: f\n- 機能\n  - 部品 mop: 速い');
  const today = D('2026-01-08');
  const lg = (w, t) => T.loadLog(`${w}.mylog`, `by: ${w}\n${t}`, [pl], today);
  const A = lg('a', '- 2026-01-06\n  - 共同 status: done progress: 100\n  - 部品 test: ok mop: 速い trl: 4\n');
  const B = lg('b', '- 2026-01-05\n  - 共同 status: doing progress: 0\n- 2026-01-06\n  - 部品 test: ng mop: 速い trl: 3\n');
  for (const order of [[A, B], [B, A]]) {
    const M = T.model([pl], order, { today });
    const t = M.tasks[0];
    const R = T.reflectData(M);
    const trl = tsvOf(M, 'trl', 'TRL の推移');
    ok(t.status === 'doing' && t.pg.val.progress === 50 && !M.sig.some((s) => s.code === 'S6'), `分担のタスク: 片方が完了・片方が 0 % なら実行中・50 %(${order.map((x) => x.by)}: ${t.status} ${t.pg.val.progress})`);
    ok(R.mopOk.length === 0 && R.mopNg.length === 0 && T.mopCounts(M).ng === 1, `同じ日の ok と ng は ng(${order.map((x) => x.by)})`);
    ok(trl && trl[1].endsWith('\t3'), `同じ日の違う TRL は小さい方(${order.map((x) => x.by)}: ${trl && trl[1]})`);
  }
}

// ---- 結合テスト(2 回目)の指摘
{
  const pl = [Lg.loadPlan('v.plan', 'version: 2026-10-01\nstart: 2026-10-01\nmembers:\n- 青木\n- 井上\nWBS: R\n- 画面 days: 5 by: 青木\n- 部品 days: 5 by: 井上\n')];
  const lg = (name, t) => T.loadLog(name, t, pl, D('2026-10-10'));
  const A = 'by: 青木\n- 2026-10-03\n  - 画面 status: doing review: 井上 note: あ hours: 3\n';
  const I1 = 'by: 井上\n- 2026-10-03\n  - 部品 hours: 2 note: い\n  - 画面 hours: 1\n';
  const I2 = I1 + '- 2026-10-04\n  - 画面 reviewed: ok\n';
  const st = (list) => tsvOf(T.model(pl, list, { today: D('2026-10-10') }), 'progress', '進捗').find((x) => x.startsWith('1\t')).split('\t')[7];
  // J4: 依頼した相手の全員が確認の結果を書いたら、確認待ちを終える
  ok(st([lg('a.mylog', A), lg('i.mylog', I1)]) === '実行中(確認待ち)' && st([lg('a.mylog', A), lg('i.mylog', I2)]) === '実行中', `確認の結果がそろったら確認待ちを終える(${st([lg('a.mylog', A), lg('i.mylog', I2)])})`);
  // B8: 同じ日付の中の行の並びは、マイログの一覧の順によらない(メンバーの順)
  const memo = (list) => tsvOf(T.model(pl, list, { today: D('2026-10-10') }), 'week', 'この週の作業時間', { week: D('2026-09-28') });
  const m1 = memo([lg('a.mylog', A), lg('i.mylog', I1)]), m2 = memo([lg('i.mylog', I1), lg('a.mylog', A)]);
  ok(m1 && JSON.stringify(m1) === JSON.stringify(m2) && m1.some((x) => x.includes('青木・井上')), `マイログの一覧の順を変えても、週のまとめの行の並びは変わらない(${m1 && m1.join('|')} / ${m2 && m2.join('|')})`);
  // B6: 影響を受けるタスクの表の列名
  const M = T.model(pl, [lg('a.mylog', 'by: 青木\n- 2026-10-03\n  - 画面 status: blocked\n')], { today: D('2026-10-10') });
  const h = tsvOf(M, 'impact', '影響を受けるタスク');
  ok(!!h && (h[0].includes('遅れているタスクの区分') && h[0].includes('影響を受けるタスクの区分') && !h[0].includes('その今の区分')), `影響を受けるタスクの表の列名(${h && h[0]})`);
}

{
  // J6: 計画から削除した記録先は、反映候補の「計画にない作業」に出さない
  const pl = Lg.sortList([Lg.loadPlan('v1.plan', 'version: 2026-10-01\nstart: 2026-10-01\nmembers:\n- 青木\nWBS: R\n- 実装 days: 2 by: 青木\n- 試作 days: 1 by: 青木\n'), Lg.loadPlan('v2.plan', 'version: 2026-10-08\nstart: 2026-10-01\nmembers:\n- 青木\nWBS: R\n- 実装 days: 2 by: 青木\n')]);
  const M = T.model(pl, [T.loadLog('a.mylog', 'by: 青木\n- 2026-10-02\n  - 試作 hours: 2\n  - 雑務 hours: 1\n', pl, D('2026-10-10'))], { today: D('2026-10-10') });
  const ex = tsvOf(M, 'reflect', '計画にない作業');
  ok(!!ex && ex.length === 2 && ex[1].startsWith('雑務\t'), `計画から削除した記録先は反映候補に出さない(${ex && ex.join('|')})`);
}

{
  // 6.5 節: 複数の相手、1 つの返事で複数の依頼を閉じる、相手のマイログがない
  const pl = [Lg.loadPlan('v.plan', 'version: 2026-10-01\nstart: 2026-10-01\nmembers:\n- 青木\n- 井上\n- 上田\nWBS: R\n- 画面 days: 9 by: 青木\n')];
  const lg = (name, t) => T.loadLog(name, t, pl, D('2026-10-10'));
  const A = lg('a.mylog', 'by: 青木\n- 2026-10-02\n  - 画面 ask: 井上, 上田\n- 2026-10-03\n  - 画面 ask: 井上\n');
  const I = lg('i.mylog', 'by: 井上\n- 2026-10-04\n  - 画面 answered: 調べた\n');
  const M = T.model(pl, [A, I], { today: D('2026-10-10') });
  const q = M.reqs.map((x) => `${x.date}|${x.to}|${x.reply ? '済' : '未'}`);
  ok(M.reqs.length === 3 && M.reqs.filter((x) => x.to === '井上').every((x) => x.reply) && !M.reqs.find((x) => x.to === '上田').reply, `複数の相手は相手ごとに 1 件、1 つの返事で前の依頼をすべて閉じる(${q})`);
  const t = tsvOf(M, 'requests', '依頼の一覧');
  ok(!!t && t.some((x) => x.includes('\t上田\t') && x.includes('相手のマイログがありません')), `相手のマイログがないときは、そう添える(${t && t.join(' / ')})`);
}

console.log(`${n} 件中 ${ng} 件失敗`);
process.exit(ng ? 1 : 0);
