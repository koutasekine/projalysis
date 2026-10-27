// 比べる処理の検査。node test/diff_test.cjs で実行する(仕様書 9 章)
'use strict';
const fs = require('fs');
// index.html の計算部と比べる処理を取り出して読む(組み立てたものを検査する)
const html = fs.readFileSync(`${__dirname}/../index.html`, 'utf8');
const core = html.slice(html.indexOf('/*CORE-BEGIN*/'), html.indexOf('/*CORE-END*/'));
const diff = html.slice(html.indexOf('/*DIFF-BEGIN*/'), html.indexOf('/*DIFF-END*/'));
const D = new Function('module', 'require', `${core}; ${diff}; return Projalysis;`)(undefined, undefined);
let fail = 0, pass = 0;
const P_fmt = (d) => { const t = new Date(d * 86400000); return t.toISOString().slice(0, 10); };
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('NG:', msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
const file = (f) => D.load(f, fs.readFileSync(`${__dirname}/${f}`, 'utf8'));
const head = (v) => `version: ${v}\nstart: 2026-04-01\nmembers:\n- A\n- B\n`;
const plan = (v, body) => D.load(`${v}.plan`, head(v) + body);

// ---- 版を読む(3.6 節)
{
  ok(file('v1.plan').comparable && file('v2.plan').comparable && file('v3.plan').comparable, 'v1〜v3 が比べられない');
  const e = file('err.plan');
  ok(!e.comparable && e.nErr === 1 && /見出し/.test(e.firstErr.message), 'エラーのある版の扱い');
  const n = file('nover.plan');
  ok(!n.comparable && n.date === null && n.nErr === 0, 'version: のない版の扱い');
  const m = D.load('m.plan', 'start: 2026-04-01\nversion: 2026-04-01\nmembers:\n- A\nWBS: X\n- a days: 1 by: A\n');
  ok(!m.comparable && m.nErr > 0, '正しくない場所の version: が比べられる');
  const crlf = D.load('c.plan', '﻿version: 2026-04-01\r\nstart: 2026-04-01\r\nmembers:\r\n- A\r\nWBS: X\r\n- a days: 1 by: A\r\n');
  ok(crlf.comparable && !crlf.text.includes('\r') && !crlf.text.startsWith('﻿'), 'BOM・CRLF を読めない');
}
// ---- 足す・並び・版の名前(3.3〜3.5 節)
{
  const [a, b, c] = ['v1.plan', 'v2.plan', 'v3.plan'].map(file);
  let r = D.addEntries([], [c, a, b]);
  eq(r.list.map((e) => e.name), ['v1.plan', 'v3.plan', 'v2.plan'], '日付の順、同じ日付は足した順');
  eq([...D.labels(r.list).values()], ['2026-04-20 版', '2026-05-01 版', '2026-05-01 版 (2)'], '版の名前');
  const r2 = D.addEntries(r.list, [file('v1.plan')]);
  ok(r2.added.length === 0 && r2.skipped.length === 1, '同じテキストが足された');
  const v1b = D.load('v1b.plan', a.text.replace('version: 2026-04-20', 'version: 2026-04-21'));
  ok(D.addEntries(r.list, [v1b]).added.length === 1, '日付だけ違う版が足されない');
  const same = D.load('v1.plan', a.text + '\n');
  ok(D.addEntries(r.list, [same]).added.length === 1, '同じ名前で中身の違う版が足されない');
  const later = D.load('v2late.plan', b.text.replace('- 江藤\n', '- 江藤\n- 小川\n'));
  eq(D.addEntries(r.list, [later]).list.map((e) => e.name), ['v1.plan', 'v3.plan', 'v2.plan', 'v2late.plan'], '後から足した同じ日付の版が後ろにならない');
  ok(D.moveEntry(r.list, 1, 1) !== null && D.moveEntry(r.list, 0, 1) === null, '同じ日付の中だけ並べ替えられる');
  const withBad = D.addEntries(r.list, [file('nover.plan'), file('err.plan')]).list;
  eq(withBad.map((e) => e.name), ['v1.plan', 'v3.plan', 'v2.plan', 'err.plan', 'nover.plan'], '版の日付のない版が最後にない');
}
// ---- 対応づけ(4 章)
{
  // 根の名前の変更は 1 行で、ほかは対応する
  const a = plan('2026-04-01', 'WBS: 甲\n- 設計 by: A\n  - 画面 days: 1\n');
  const b = plan('2026-04-02', 'WBS: 乙\n- 設計 by: A\n  - 画面 days: 1\n');
  const c = D.compare(a, b);
  eq(c.roots, [{ sec: 'WBS', from: '甲', to: '乙' }], '根の名前の変更');
  eq(c.counts.find((x) => x.sec === 'WBS'), { sec: 'WBS', matched: 2, total: 2 }, '根を除いて対応しない');
  eq([c.tasks.added.length, c.tasks.removed.length], [0, 0], '根の名前だけの変更で増減が出た');
}
{
  // 移動: 名前が同じで親が変わった。子も同じ規則で移動になる
  const a = plan('2026-04-01', 'WBS: X\n- 設計\n  - 画面 days: 1 by: A\n- 実装\n  - 処理 days: 2 by: B\n');
  const b = plan('2026-04-02', 'WBS: X\n- 設計\n- 実装\n  - 処理 days: 2 by: B\n  - 画面 days: 1 by: A\n');
  const c = D.compare(a, b);
  eq(c.tasks.moved, [{ key: '実装::画面', from: '設計', to: '実装' }], '移動');
  eq(c.counts.find((x) => x.sec === 'WBS'), { sec: 'WBS', matched: 4, total: 4 }, '移動を対応と数えない');
  // 設計 は子がなくなってタスクになった(増えたタスクに添え書き)
  ok(c.tasks.added.some((r) => r[0] === '設計(子要素がなくなった)'), '子のない要素になった の添え書き');
}
{
  // 同じ名前が片側に 2 つ以上あれば移動にしない
  const a = plan('2026-04-01', 'WBS: X\n- 甲\n  - テスト days: 1 by: A\n- 乙\n  - テスト days: 1 by: A\n');
  const b = plan('2026-04-02', 'WBS: X\n- 丙\n  - テスト days: 1 by: A\n- 丁\n  - テスト days: 1 by: A\n');
  const c = D.compare(a, b);
  eq(c.tasks.moved, [], '同じ名前が 2 つのときに移動にした');
  eq([c.tasks.added.length, c.tasks.removed.length], [2, 2], '同じ名前が 2 つのときの増減');
}
{
  // 名前を変えたタスクは消えた・増えたになる。似た名前は推測しない
  const a = plan('2026-04-01', 'WBS: X\n- 画面設計 days: 1 by: A\n');
  const b = plan('2026-04-02', 'WBS: X\n- 画面の設計 days: 1 by: A\n');
  const c = D.compare(a, b);
  eq([c.tasks.added.map((r) => r[0]), c.tasks.removed.map((r) => r[0])], [['画面の設計'], ['画面設計']], '名前の変更');
}
// ---- 変わったタスク(5.4 節)
{
  const a = plan('2026-04-01', 'WBS: X\n- 設計 by: A\n  - 甲 days: 1\n  - 乙 days: 1 after: 甲\n- 実装\n  - 丙 days: 1 by: B after: 設計\n');
  // 親の by: を変える(受け継いだ値で比べる)。先行の甲を移動する(変わったとしない)。丙の先行は 設計 のまま(下のタスクに広げない)
  const b = plan('2026-04-02', 'WBS: X\n- 設計 by: B\n  - 乙 days: 1 after: 甲\n  - 丁 days: 1\n- 実装\n  - 甲 days: 1 by: A\n  - 丙 days: 1 by: B after: 設計\n');
  const c = D.compare(a, b);
  const ch = Object.fromEntries(c.tasks.changed.map((x) => [x.key, x.items]));
  eq(ch['設計::乙'], [['作成者', 'A', 'B']], '受け継いだ作成者の変化');
  ok(!ch['実装::丙'], '途中の要素を指す先行を広げて比べた(丁が増えただけで変わったになった)');
  ok(!(ch['設計::乙'] || []).some((it) => it[0] === '先行'), '先行の要素の移動で変わったになった');
}
{
  const a = plan('2026-04-01', 'WBS: X\n- 甲 days: 1 by: A status: todo note: x\n- 乙 days: 1 by: A\n');
  const b = plan('2026-04-02', 'WBS: X\n- 甲 days: 1.5 by: A, B review: B status: done note: y\n- 乙 days: 1 by: A status: doing\n');
  const c = D.compare(a, b);
  eq(c.tasks.changed, [{ key: '甲', items: [['日数', '1', '1.5'], ['作成者', 'A', 'A、B'], ['確認者', 'なし', 'B'], ['メモ', 'x', 'y']] }], '変わった項目');
  eq(c.tasks.status, [{ key: '甲', from: '実行前', to: '完了' }, { key: '乙', from: '実行前', to: '実行中' }], '状態の変化を別にする');
  ok(!c.tasks.changed.some((x) => x.key === '乙'), '状態だけの変化が変わったタスクに入った');
}
{
  // 名前の変わった先行は変わったとする。順序は問わない
  const a = plan('2026-04-01', 'WBS: X\n- 甲 days: 1 by: A\n- 乙 days: 1 by: B\n- 丙 days: 1 by: A after: 甲, 乙\n');
  const b = plan('2026-04-02', 'WBS: X\n- 甲 days: 1 by: A\n- 乙2 days: 1 by: B\n- 丙 days: 1 by: A after: 乙2, 甲\n');
  const b2 = plan('2026-04-02', 'WBS: X\n- 甲 days: 1 by: A\n- 乙 days: 1 by: B\n- 丙 days: 1 by: A after: 乙, 甲\n');
  ok(D.compare(a, b).tasks.changed.some((x) => x.key === '丙' && x.items[0][0] === '先行'), '名前の変わった先行が変わったにならない');
  ok(!D.compare(a, b2).tasks.changed.length, '並びの順だけで変わったになった');
}
// ---- 日程・MOP・担当者(5.5〜5.7 節)
{
  const a = plan('2026-04-01', 'WBS: X\n- 甲 days: 2 by: A\n- 乙 days: 1 by: A after: 甲\n');
  const b = plan('2026-04-02', 'WBS: X\n- 甲 days: 4 by: A\n- 乙 days: 1 by: A after: 甲\n');
  const c = D.compare(a, b);
  eq(c.sched.rows.map((s) => [s.key, s.a, s.b, s.diff]), [['甲', '2026-04-02', '2026-04-04', 2], ['乙', '2026-04-03', '2026-04-05', 2]], '日程のずれ');
  eq(c.sched.worst.map((s) => s.key), ['甲', '乙'], 'いちばん遅れたタスク(同じなら全部)');
  ok(D.compare(b, a).sched.worst.length === 0, '早まったときに遅れたタスクが出た');
}
{
  const h = 'start: 2026-04-01\nmembers:\n- A\nWBS: X\n- t days: 1 by: A\n';
  const a = D.load('a', `version: 2026-04-01\n${h}FBS: F\n- 甲 mop: m1 mop: m1 mop*: m2 mop: m3\n- 乙 mop: z\n`);
  const b = D.load('b', `version: 2026-04-02\n${h}FBS: G\n- 甲 mop*: m1 mop: m1 mop: m2 mop: m4\n- 丙 mop: z\n`);
  const c = D.compare(a, b);
  eq(c.mop.checked, [['甲', 'm1']], 'チェック済みになった(同じ文は書いた順に対応)');
  eq(c.mop.unchecked, [['甲', 'm2']], 'チェックを外した');
  eq([c.mop.added, c.mop.removed], [[['甲', 'm4']], [['甲', 'm3']]], 'MOP の増減(増えた・消えた要素の MOP は数えない)');
  eq([c.fbs.added, c.fbs.removed], [[['丙', 'z']], [['乙', 'z']]], 'FBS の増減(要素の行に MOP を含める)');
  const svg = D.render([a, b], 'fbs', [a, b]).svg;
  ok(svg.includes('✓ m1') || svg.includes('>z<'), '増えた・消えた要素の MOP が表に出ない');
}
{
  const a = D.load('a', 'version: 2026-04-01\nstart: 2026-04-01\nmembers:\n- A off: sun\n- B\nWBS: X\n- t days: 2 by: A\n- u days: 1\n');
  const b = D.load('b', 'version: 2026-04-02\nstart: 2026-04-01\nmembers:\n- A off: sat, sun\n- C\nWBS: X\n- t days: 3 by: A\n- u days: 1 by: C\n');
  const c = D.compare(a, b);
  eq([c.people.added, c.people.removed], [['C'], ['B']], '担当者の増減');
  eq(c.people.rows.map((x) => [x.name, x.a, x.b]), [['A', 2000, 3000], ['(担当なし)', 1000, 0]], '作成の日数');
  eq(c.people.off, [{ name: 'A', a: 'sun', b: 'sat, sun' }], '個人の休みの変化');
  eq(c.counts.find((x) => x.sec === 'メンバー'), { sec: 'メンバー', matched: 1, total: 3 }, '担当者の対応した数');
}
// ---- 概要(5.1 節)
{
  const list = D.addEntries([], ['v1.plan', 'v2.plan', 'v3.plan', 'err.plan', 'nover.plan'].map(file)).list;
  const o = D.overview(list);
  eq(o.cols.map((e) => e.name), ['v1.plan', 'v2.plan', 'v3.plan'], '概要の列(比べられない版を入れない)');
  const t = D.build(list, 'overview', null).tables[0];
  ok(t.rows.find((r) => r.cells[0] === 'ファイル').cells.every((x) => typeof x === 'string'), 'ファイル名を太字にした');
  ok(t.rows.find((r) => r.cells[0] === 'タスク数').cells.some((x) => typeof x === 'object' && x.bold), '違う値が太字にならない');
  // 概要の総数の行(5.1 節)
  eq(o.rows.map((r) => r.name), ['版', 'ファイル', '開始日', '期限', '全体の休み', 'クリティカルパスの長さ(日)', '日程の長さ(日)', '終了日', 'メンバー数', 'FBS 要素数', 'PBS 要素数', 'WBS 要素数', 'タスク数', '総日数', 'MOP 総数', '確認した MOP 数', '警告数'], '概要の行の並び');
  const v1 = list[0].r, val = (name) => o.rows.find((r) => r.name === name).values[0];
  const mops = v1.bySec.FBS.flatMap((n) => n.mopChecked);
  eq([val('メンバー数'), val('FBS 要素数'), val('PBS 要素数'), val('WBS 要素数'), val('MOP 総数'), val('確認した MOP 数')],
    [String(v1.members.length), String(v1.bySec.FBS.length - 1), String(v1.bySec.PBS.length - 1), String(v1.bySec.WBS.length - 1), String(mops.length), String(mops.filter(Boolean).length)], '概要の総数(根を除く、MOP は確認済みを含む)');
  ok(+val('WBS 要素数') > +val('タスク数') && +val('確認した MOP 数') <= +val('MOP 総数'), 'WBS 要素数はタスク数より多く、確認した MOP 数は MOP 総数以下');
  const noF = D.addEntries([], [plan('2026-04-01', 'WBS: X\n- t days: 1 by: A\n'), plan('2026-04-02', 'WBS: X\n- t days: 2 by: A\n')]).list;
  const on = D.overview(noF);
  eq(['FBS 要素数', 'PBS 要素数', 'MOP 総数', '確認した MOP 数', 'WBS 要素数'].map((n) => on.rows.find((r) => r.name === n).values[0]), ['―', '―', '―', '―', '1'], 'FBS・PBS がない版の総数');
}
// ---- 表のコピー(6.2 節)
{
  const tsv = D.tsv({ header: ['a', 'b'], rows: [{ cells: ['x\ty', { t: 'p\nq', bold: true }], group: 0 }, { cells: ['x\ty', 'r'], group: 0 }] });
  eq(tsv, 'a\tb\nx y\tp q\nx y\tr\n', 'タブ区切り(まとめたセルは各行に書く。タブと改行は空白)');
}
// ---- plans と SVG(7.1 節・7.3 節)、決定的であること(1.3 節)
{
  const list = D.addEntries([], ['v3.plan', 'v1.plan', 'v2.plan', 'err.plan'].map(file)).list;
  const t1 = D.toPlans(list);
  ok(t1 === D.toPlans(list) && t1.endsWith('\n') && !t1.includes('\r'), 'plans が決定的でない');
  const back = D.fromPlans(t1);
  ok(back.ok, 'plans を読めない');
  const list2 = D.sortList(back.files.map((f) => D.load(f.name, f.text)));
  eq(list2.map((e) => e.name), list.map((e) => e.name), 'plans で並びが戻らない');
  ok(D.toPlans(list2) === t1, 'plans を読み書きして同じにならない');
  ok(!D.fromPlans('{"format":"x","files":[]}').ok && !D.fromPlans('not json').ok, '形の違う plans を読んだ');
  ok(t1.startsWith('{\n  "format": "projalysis-plans",\n  "files": ['), 'plans のキーの順と字下げ');
  const pair = [list2[0], list2[2]];
  for (const v of D.VIEWS) ok(D.render(list, v.id, [list[0], list[2]]).svg === D.render(list2, v.id, pair).svg, `${v.id} の SVG が決定的でない`);
  // 保存する SVG には何も埋め込まないので、開いても読めない(7.3 節)
  const rr = D.render(list, 'tasks', [list[0], list[2]]);
  ok(!D.extract(rr.svg, 'a.svg').ok && !D.extract(rr.tableSvgs[0], 'b.svg').ok && !rr.svg.includes('<metadata'), 'プロジェクト分析の SVG を読めてしまう');
  ok(D.embed === undefined, 'embed が残っている');
  // 表の画像(6.2 節): 表の数だけあり、題を入れず、決定的
  for (const v of D.VIEWS) {
    const r1 = D.render(list, v.id, [list[0], list[2]]), r2 = D.render(list2, v.id, pair);
    ok(r1.tableSvgs.length === r1.tables.length && r1.tableSvgs.every((s, k) => s === r2.tableSvgs[k]), `${v.id} の表の画像の数が合わない、または決定的でない`);
    ok(r1.tables.every((t, k) => !r1.tableSvgs[k].includes(`>${t.title}`)), `${v.id} の表の画像に題が入っている`);
  }
  // プロジェクト計画の SVG(P1)
  const P = new Function('module', `${core}; return Plan;`)(undefined);
  const ps = P.embedSource('<svg xmlns="http://www.w3.org/2000/svg"></svg>', list[0].text);
  const y = D.extract(ps, 'team_gantt.svg');
  ok(y.ok && y.files[0].name === 'team_gantt.plan' && y.files[0].text === list[0].text, 'プロジェクト計画の SVG を読めない');
}
// ---- 印刷のページ分け(7.5 節)
{
  // タスクの多い計画: 行で区切る
  let body = 'WBS: X\n';
  for (let i = 0; i < 120; i++) body += `- タスク${i} days: 1 by: A\n`;
  const a = plan('2026-04-01', 'WBS: X\n- 元 days: 1 by: A\n'), b = plan('2026-04-02', body);
  const pages = D.printPages([a, b], 'tasks', [a, b]);
  ok(pages.length > 1, '長い表がページに分かれない');
  const sz = (s) => /width="(\d+)" height="(\d+)"/.exec(s).slice(1).map(Number);
  ok(pages.every((s) => { const [w, h] = sz(s); return Math.min(1, 1047 / w, 718 / h) >= 0.5; }), 'ページの縮みが半分より小さい');
  ok(pages.slice(1).every((s) => s.includes('(続き)')), '続きのページに題がない');
  // 版の多い概要: 列で区切る
  const many = [];
  for (let i = 1; i <= 25; i++) many.push(plan(`2026-04-${String(i).padStart(2, '0')}`, `WBS: X\n- t days: ${i} by: A\n`));
  const op = D.printPages(many, 'overview', null);
  ok(op.length > 1 && op.every((s) => s.includes('クリティカルパスの長さ')), '概要が列で分かれない(各ページに行の見出しがない)');
}
// ---- レビューの指摘への検査
{
  // 版の名前の番号は、比べられる版だけで数える(3.5 節)
  const a1 = plan('2026-04-01', 'WBS: X\n- t days: 1 by: A\n');
  const e = D.load('e.plan', 'version: 2026-04-02\nstart: 2026-04-01\nmembers:\n- A\nWBS: X\n# x\n- t days: 1 by: A\n');
  const b1 = plan('2026-04-02', 'WBS: X\n- t days: 2 by: A\n');
  const b2 = plan('2026-04-02', 'WBS: X\n- t days: 3 by: A\n');
  const list = D.addEntries([], [a1, e, b1, b2]).list;
  eq(D.overview(list).cols.map((x) => D.labels(list).get(x)), ['2026-04-01 版', '2026-04-02 版', '2026-04-02 版 (2)'], '比べられない版が番号を占める');
  eq(D.labels(list).get(e), '2026-04-02 版', '比べられない版の名前');
}
{
  // 最初のエラーは行の番号がいちばん小さいもの(3.6 節)
  const e = D.load('e.plan', 'version: 2026-04-01\nmembers:\n- A\nWBS: X\n# 見出し\n- t days: 1 by: A\n');
  ok(e.nErr >= 2 && e.firstErr.line === Math.min(...e.r.diags.filter((d) => d.level === 'error').map((d) => d.line)), `最初のエラーが行の順でない: ${e.firstErr.line}`);
}
{
  // 長い 1 行でも印刷が半分より小さく縮まない(7.5 節): 先頭のタスクが遅れて後ろが全部同じだけずれる。長いファイル名
  let a = 'WBS: X\n- t0 days: 1 by: A\n', b = 'WBS: X\n- t0 days: 3 by: A\n';
  for (let i = 1; i < 60; i++) { a += `- タスクの名前がそれなりに長いタスク${i} days: 1 by: A after: ${i === 1 ? 't0' : `タスクの名前がそれなりに長いタスク${i - 1}`}\n`; b += `- タスクの名前がそれなりに長いタスク${i} days: 1 by: A after: ${i === 1 ? 't0' : `タスクの名前がそれなりに長いタスク${i - 1}`}\n`; }
  const va = plan('2026-04-01', a), vb = D.load(`${'とても長いファイル名'.repeat(30)}.plan`, head('2026-04-02') + b);
  const sz = (s) => /width="(\d+)" height="(\d+)"/.exec(s).slice(1).map(Number);
  const sc = (s) => { const [w, h] = sz(s); return Math.min(1, 1047 / w, 718 / h); };
  for (const v of ['tasks', 'sched', 'fbs', 'people']) {
    const pages = D.printPages([va, vb], v, [va, vb]);
    ok(pages.every((s) => sc(s) >= 0.5), `${v} の印刷が半分より小さく縮む: ${pages.map((s) => sc(s).toFixed(3))}`);
  }
  const c = D.compare(va, vb);
  ok(c.sched.worst.length === 60, 'いちばん遅れたタスクの数');
  ok(D.build([va, vb], 'sched', [va, vb]).tables.some((t) => t.title === '最も遅れたタスク' && t.rows.length === 60), 'いちばん遅れたタスクが表になっていない');
}
{
  // 1 行だけでページを超える行の前に、題だけのページを作らない(7.5 節)
  const a = plan('2026-04-01', 'WBS: X\n- t days: 1 by: A\n');
  const b = plan('2026-04-02', `WBS: X\n- t days: 1 by: A note: ${'長いメモ'.repeat(1500)}\n`);
  const pages = D.printPages([a, b], 'tasks', [a, b]);
  ok(!pages.some((s) => s.includes('変更したタスク(1 件)') && !s.includes('長いメモ')), `題だけのページがある(${pages.length} ページ)`);
}
// ---- 推移(5.9 節)・状態が初めて変わった版(5.11 節)・ガントチャート(5.10 節)
{
  const h = (v, body) => D.load(`${v}.plan`, `version: ${v}\nstart: 2026-04-01\nend: 2026-04-10\nmembers:\n- A\n- B\n${body}`);
  const v1 = h('2026-04-01', 'WBS: X\n- 設計\n  - 甲 days: 2 by: A\n- 実装\n  - 乙 days: 3 by: B after: 甲\n');
  const v2 = h('2026-04-03', 'WBS: X\n- 設計\n  - 甲 days: 2 by: A status: done\n- 実装\n  - 乙 days: 4 by: B after: 甲 status: blocked\n  - 丙 days: 1 by: A\n');
  const v3 = h('2026-04-03', 'WBS: X\n- 設計\n  - 甲 days: 2 by: A status: done\n- 実装\n  - 乙 days: 4 by: B after: 甲 status: doing\n  - 丙 days: 1 by: A status: done\n');
  const v4 = D.load('v4.plan', 'version: 2026-04-06\nstart: 2026-04-01\nmembers:\n- A\n- C\nWBS: X\n- 設計\n  - 甲 days: 2 by: A status: done\n- 実装\n  - 乙 days: 4 by: C after: 甲 status: done\n  - 丙改 days: 1 by: A status: done\n- 試験\n  - 丁 days: 1 by: A after: 乙\n');
  const list = D.addEntries([], [v1, v2, v3, v4, file('err.plan')]).list;
  const t = D.trendData(list);
  eq(t.A.length, 4, 'A の版の数(比べられない版を入れない)');
  eq(t.A.map((r) => r.end), [v1.r.sec.end.date, v2.r.sec.end.date, v3.r.sec.end.date, null], 'A の期限(期限のない版は null)');
  eq(t.A.map((r) => r.finish), [v1, v2, v3, v4].map((e) => e.r.sched.finishDate), 'A の終わりの日');
  eq(t.E.map((r) => [r.i, r.total, r.done]), [[0, 5000, 0], [2, 7000, 3000], [3, 8000, 7000]], 'E(同じ日付は一覧で最後の版で代表させる)');
  eq(t.D.map((r) => [r.c.todo, r.c.doing, r.c.done, r.c.blocked, r.total, r.mop]), [[2, 0, 0, 0, 2, null], [1, 0, 1, 1, 3, null], [0, 1, 2, 0, 3, null], [1, 0, 3, 0, 4, null]], 'D の状態ごとの件数');
  eq(t.I.phases, ['設計', '実装', '試験'], 'I の第 1 層の要素の並び');
  eq(t.I.pairs.map((p) => [...p.cnt]), [[['実装', 2]], [], [['実装', 3], ['試験', 1]]], 'I の第 1 層の要素ごとの件数(状態だけの変化は数えない。名前の変更は消えた・増えた)');
  eq(t.H.map((p) => [p.name, p.vals]), [['A', [2000, 3000, 3000, 4000]], ['B', [3000, 4000, 4000, null]], ['C', [null, null, null, 4000]]], 'H の作成の日数(いない版は null)');
  const fc = D.firstChanges(list);
  eq(fc.map((r) => r.slice(0, 4)), [
    ['設計::甲', '―', '2026-04-03 版', '2026-04-01 〜 2026-04-03'],
    ['実装::乙', '2026-04-03 版', '2026-04-06 版', '2026-04-03 〜 2026-04-06'],
    ['実装::丙改', '―', '2026-04-06 版', '〜 2026-04-06'],
    ['試験::丁', '―', '―', '―'],
  ], '状態が初めて変わった版(名前の変わったタスクはさかのぼらない)');
  const o = D.overlayData(list[0], list[3]);
  eq(o.rows.map((r) => r.key + r.suffix), ['設計::甲', '実装::乙', '実装::丙改(追加)', '試験::丁(追加)'], 'ガントチャートの行(増えたタスクは後の版の木の順)');
  eq(o.unplanned, Math.round((2 / 8) * 100), '計画外のタスク');
  const o2 = D.overlayData(list[1], list[3]);
  eq(o2.rows.map((r) => r.key + r.suffix), ['設計::甲', '実装::乙', '実装::丙改(追加)', '試験::丁(追加)', '実装::丙(削除)'], '消えたタスクを最後に並べる');
  eq([o2.removedDays, o2.pairDays], [1000, [6000, 6000]], '消えたタスクの日数と対応するタスクの日数');
  eq(o2.rows[1].p, [v2.r.sched.start + v2.r.tasks[1].d0, v2.r.sched.start + v2.r.tasks[1].d1], 'ガントチャートの棒の位置');
  // 比べられる版が 1 つ: A・D・E・H は描き、I は描かない
  const one = D.build([v1], 'trend', null);
  ok(!one.message && one.blocks.filter((b) => b.kind === 'fig').length === 4, '版が 1 つのときの推移の図');
  ok(D.render([v1], 'gantt', null).svg.includes('比較には 2 つ以上の版が必要です'), '版が 1 つのときのガントチャート');
  // 図の元の数はコピーの対象にしない。図ごとの SVG を作る(6.2 節・7.3 節)
  const rt = D.render(list, 'trend', null);
  eq(rt.tables.map((x) => x.title), ['タスクの進捗が初めて変わった版'], '推移のビューのコピーの対象');
  eq(rt.figures.map((f) => f.id), ['end', 'burnup', 'status', 'changes', 'effort'], '推移の図ごとの SVG');
  ok(rt.figures.every((f) => f.svg.startsWith('<svg') && f.svg.includes(f.title.slice(0, 5))), '図ごとの SVG に題がない');
  const rc = D.render(list, 'gantt', [list[0], list[3]]);
  eq([rc.tables.map((x) => x.title), rc.figures.map((f) => f.id)], [['対応した要素'], ['gantt', 'gantt-people']], 'ガントチャートのビューのコピーの対象と図');
  ok(rc.figures[0].svg.includes('比較:'), 'ガントチャートの図の SVG に比較の版がない');
  // 見積もりの変化は日程のビューの、タスクごとの終了日の後
  const rs = D.render(list, 'sched', [list[0], list[3]]);
  eq([rs.tables.map((x) => x.title), rs.figures.map((f) => f.id)], [['対応した要素', '最も遅れたタスク', 'タスクごとの終了日'], ['estimate']], '日程のビューのコピーの対象と図');
  ok(rs.figures[0].svg.includes('計画外のタスク') && rs.figures[0].svg.includes('比較:'), '日程のビューの見積もりの図に数や版がない');
  ok(rs.svg.indexOf('タスクごとの終了日') < rs.svg.indexOf('見積もりの変化'), '見積もりの変化がタスクごとの終了日の後にない');
  eq(D.render(list, 'tasks', [list[0], list[3]]).figures, [], '図のないビューの図');
  // 図から選ぶ印(5.12 節)
  const sv = D.render(list, 'trend', null).svg;
  ok(sv.includes('data-ver="3"') && sv.includes('data-pair="2"') && !sv.includes('data-pair="3"'), '図から選ぶ印');
}
{
  // I: 移動して、しかも変わったタスクは 1 回だけ数える
  const a = plan('2026-04-01', 'WBS: X\n- 設計\n  - 甲 days: 1 by: A\n- 実装\n  - 乙 days: 1 by: A\n');
  const b = plan('2026-04-02', 'WBS: X\n- 設計\n- 実装\n  - 乙 days: 1 by: A\n  - 甲 days: 3 by: A\n');
  eq([...D.trendData([a, b]).I.pairs[0].cnt], [['設計', 1], ['実装', 1]], 'I で移動して変わったタスクを二重に数えた');
  // 5.11 節: 途中の要素だった版を挟んで、さかのぼらない
  const c1 = plan('2026-04-01', 'WBS: X\n- 甲 days: 1 by: A status: done\n');
  const c2 = plan('2026-04-02', 'WBS: X\n- 甲\n  - 子 days: 1 by: A\n');
  const c3 = plan('2026-04-03', 'WBS: X\n- 甲 days: 1 by: A\n');
  eq(D.firstChanges([c1, c2, c3])[0].slice(0, 3), ['甲', '―', '―'], '途中の要素だった版を挟んでさかのぼった');
}
{
  // 推移・ガントチャートの印刷: 版が多い・タスクが多いときにページを分け、半分より小さく縮まない(7.5 節)
  const sz = (s) => /width="(\d+)" height="(\d+)"/.exec(s).slice(1).map(Number);
  const sc = (s) => { const [w, h] = sz(s); return Math.min(1, 1047 / w, 718 / h); };
  const many = [];
  for (let i = 1; i <= 30; i++) many.push(plan(`2026-04-${String(i).padStart(2, '0')}`, `WBS: X\n- 設計\n  - t days: ${i} by: A${i % 2 ? '' : ' status: done'}\n${i > 10 ? '- 実装\n  - u days: 1 by: B\n' : ''}`));
  const pt = D.printPages(many, 'trend', null);
  ok(pt.length > 6 && pt.every((s) => sc(s) >= 0.5), `推移の印刷: ${pt.length} ページ、縮み ${Math.min(...pt.map(sc)).toFixed(3)}`);
  let a = 'WBS: X\n', b = 'WBS: X\n';
  for (let i = 0; i < 80; i++) { a += `- タスク${i} days: 1 by: A\n`; b += `- タスク${i} days: ${1 + (i % 3)} by: A\n`; }
  const pa = plan('2026-04-01', a), pb = plan('2026-04-02', b);
  const po = D.printPages([pa, pb], 'gantt', [pa, pb]);
  ok(po.length > 2 && po.every((s) => sc(s) >= 0.5) && po.slice(1).some((s) => s.includes('(続き)')), `ガントチャートの印刷: ${po.length} ページ、縮み ${Math.min(...po.map(sc)).toFixed(3)}`);
  const ps = D.printPages([pa, pb], 'sched', [pa, pb]);
  ok(ps.length > 2 && ps.every((s) => sc(s) >= 0.5) && ps.some((s) => s.includes('見積もりの変化(続き)')), `日程の印刷(見積もりの変化を含む): ${ps.length} ページ、縮み ${Math.min(...ps.map(sc)).toFixed(3)}`);
}
{
  // ガントチャート: 長いタスクの名前は先頭の側を縮め、末端の名前と添え書きを残す(5.10 節)
  const long = 'とても長い第一層の要素の名前'.repeat(3);
  const a = plan('2026-04-01', `WBS: X\n- ${long}\n  - 甲 days: 1 by: A\n`);
  const b = plan('2026-04-02', `WBS: X\n- ${long}\n  - 甲 days: 1 by: A\n  - 末端の名前その一 days: 1 by: A\n  - 末端の名前その二 days: 1 by: A\n`);
  const sv = D.render([a, b], 'gantt', [a, b]).svg;
  ok(sv.includes('末端の名前その一(追加)</text>') && sv.includes('末端の名前その二(追加)</text>') && sv.includes('>…'), '長い名前で末端の名前か添え書きが切れた');
}
// ---- 改訂履歴(5.13 節)
{
  const H = (v, body, mem = '- A\n- B\n') => D.load(`${v}.plan`, `version: ${v}\nstart: 2026-04-01\nmembers:\n${mem}${body}`);
  const h1 = H('2026-04-01', 'FBS: F\n- 予定\nWBS: X\n- 設計\n  - 甲 days: 2 by: A\n');
  const h2 = H('2026-04-02', 'FBS: G\n- 予定 mop: 登録できる\n- 通知 mop*: 届く\nWBS: X\n- 設計\n  - 甲 days: 3 by: A status: done\n  - 乙 days: 1 by: B\n', '- A\n- B\n- C\n');
  const h3 = D.load('h3.plan', h2.text.replace('version: 2026-04-02', 'version: 2026-04-03') + '// 注だけを足した\n');
  const bad = D.load('bad.plan', 'version: 2026-04-04\nmembers:\n- A\nWBS: X\n# x\n');
  const list = D.addEntries([], [h1, h2, h3, bad, file('nover.plan')]).list;
  const h = D.revisionHistory(list);
  eq(h.rows.map((r) => [r.cells[2], r.cells[3]]), [['―', '初版'], ['タスク', '追加'], ['タスク', '変更'], ['タスクの進捗', '変更'], ['FBS 要素', '追加'], ['MOP', '追加'], ['FBS の根の名前', '変更'], ['メンバー', '追加'], ['終了日', '変更'], ['―', '変更なし']], '改訂履歴の種類の並び');
  eq(h.rows.map((r) => r.cells[4]), [
    `タスク 1 件、終了日 ${P_fmt(h1.r.sched.finishDate)}`,
    '設計::乙', '設計::甲(日数 2 → 3)', '設計::甲(実行前 → 完了)', '通知(MOP: ✓ 届く)', '予定: 登録できる', 'F → G', 'C',
    `${P_fmt(h1.r.sched.finishDate)} → ${P_fmt(h2.r.sched.finishDate)}(+${h2.r.sched.finishDate - h1.r.sched.finishDate})`, '変更はありません',
  ], '改訂履歴の内容');
  eq(h.rows.map((r) => [r.group, r.ver]), [[0, 0], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [2, 2]], '改訂履歴のまとめる行と押したときの版');
  eq([h.errs.map((e) => e.name), h.nover.map((e) => e.name)], [['bad.plan'], ['nover.plan']], '改訂履歴に入れない版');
  const r = D.render(list, 'history', null);
  ok(r.svg.includes('エラーのため除外: bad.plan') && r.svg.includes('version: がないため除外: nover.plan'), '改訂履歴の警告');
  ok(r.svg.includes('data-ver="2"') && r.tables.length === 1 && r.tables[0].merge === 2, '改訂履歴の表(行を押す印・まとめるセル・コピー)');
  eq(D.tsv(r.tables[0]).split('\n')[2], `${D.labels(list).get(h2)}\th2.plan\tタスク\t追加\t設計::乙`.replace('h2.plan', '2026-04-02.plan'), 'コピーではまとめたセルを各行に書く');
  // 印刷: 長い改訂履歴は行で区切り、半分より小さく縮まない
  const many = [];
  for (let i = 1; i <= 20; i++) { let b = 'WBS: X\n'; for (let k = 0; k < i * 3; k++) b += `- タスク${k} days: ${1 + (k % 2)} by: A\n`; many.push(plan(`2026-04-${String(i).padStart(2, '0')}`, b)); }
  const pages = D.printPages(many, 'history', null);
  const sz = (x) => /width="(\d+)" height="(\d+)"/.exec(x).slice(1).map(Number);
  ok(pages.length > 3 && pages.every((x) => { const [w, hh] = sz(x); return Math.min(1, 1047 / w, 718 / hh) >= 0.5; }), `改訂履歴の印刷: ${pages.length} ページ`);
}
// ---- J. 担当者別ガントチャートの比較(5.10 節)
{
  const a = D.load('a.plan', 'version: 2026-04-01\nstart: 2026-04-01\nend: 2026-04-20\nmembers:\n- A\n- B\nWBS: X\n- 甲 days: 2 by: A\n- 乙 days: 3 by: A, B after: 甲\n- 丙 days: 1\n');
  const b = D.load('b.plan', 'version: 2026-04-02\nstart: 2026-04-01\nmembers:\n- C\n- A\nWBS: X\n- 甲 days: 2 by: A\n- 乙 days: 4 by: C after: 甲\n');
  const o = D.overlayData(a, b);
  eq(o.people.map((r) => [r.name, r.inA, r.inB, r.p.map((x) => x.leaf), r.n.map((x) => x.leaf), r.pd, r.nd]), [
    ['C', false, true, [], ['乙'], 0, 4000],
    ['A', true, true, ['甲', '乙'], ['甲'], 5000, 2000],
    ['B', true, false, ['乙'], [], 3000, 0],
    ['(担当なし)', true, true, ['丙'], [], 1000, 0],
  ], 'J の行(変更後の members の順、いない人は最後、複数人のタスクは全員の行、担当なし)');
  eq(o.people[1].p[1].s, [a.r.sched.start + a.r.tasks[1].d0, a.r.sched.start + a.r.tasks[1].d1], 'J の棒の位置');
  const r = D.render([a, b], 'gantt', [a, b]);
  eq(r.figures.map((f) => f.id), ['gantt', 'gantt-people'], 'ガントチャートのビューの図の並び(F の次に J)');
  ok(r.figures[1].svg.includes('担当者別ガントチャートの比較') && r.figures[1].svg.includes('5 → 2') && r.figures[1].svg.includes('比較:'), 'J の図の題・作成の日数・比較の版');
  ok(r.anchors.some((x) => x.kind === 'fig' && x.id === 'gantt-people'), 'J の題の右にボタンの位置がない');
  // 担当者が多いときは行で区切って印刷する
  let mem = 'members:\n', w = 'WBS: X\n';
  for (let i = 0; i < 60; i++) { mem += `- 人${i}\n`; w += `- タスク${i} days: ${1 + (i % 3)} by: 人${i}\n`; }
  const pa = D.load('pa.plan', `version: 2026-04-01\nstart: 2026-04-01\n${mem}${w}`), pb = D.load('pb.plan', `version: 2026-04-02\nstart: 2026-04-01\n${mem}${w.replace(/days: 1 /g, 'days: 2 ')}`);
  const pages = D.printPages([pa, pb], 'gantt', [pa, pb]);
  const sz = (x) => /width="(\d+)" height="(\d+)"/.exec(x).slice(1).map(Number);
  ok(pages.some((x) => x.includes('担当者別ガントチャートの比較(続き)')) && pages.every((x) => { const [ww, hh] = sz(x); return Math.min(1, 1047 / ww, 718 / hh) >= 0.5; }), `J の印刷: ${pages.length} ページ`);
}
// ---- レビューの指摘を直した所(v0.25)
{
  const txts = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
  const B = (v, o = {}) => D.load(`${v}.plan`, `version: ${v}\nstart: ${o.start ?? '2026-04-23'}\n${o.end ? `end: ${o.end}\n` : ''}${o.off ? `off: ${o.off}\n` : ''}members:\n${(o.members ?? ['甲野', '乙川']).map((m) => `- ${m}`).join('\n')}\nWBS: 計画\n${o.wbs ?? '- 設計\n  - 画面設計 days: 2 by: 甲野\n'}`);
  // 1-1 改訂履歴: 開始日・期限・全体の休み・メンバーの休みの変更(5.13 節)
  const l1 = D.addEntries([], [B('2026-05-01', { end: '2026-05-20' }), B('2026-05-02', { start: '2026-04-24', end: '2026-05-25' }), B('2026-05-03', { start: '2026-04-24', end: '2026-05-25', off: '2026-05-05 // 祝日' }), B('2026-05-04', { start: '2026-04-24', end: '2026-05-25', off: '2026-05-05', members: ['甲野 off: 2026-05-06', '乙川'] })]).list;
  const h1 = D.revisionHistory(l1).rows.map((r) => r.cells.slice(2).join('|'));
  eq(h1.filter((x) => !x.startsWith('―|初版') && !x.startsWith('終了日')), ['開始日|変更|2026-04-23 → 2026-04-24', '期限|変更|2026-05-20 → 2026-05-25', '全体の休み|変更|なし → 2026-05-05', 'メンバーの休み|変更|甲野(なし → 2026-05-06)'], '改訂履歴の開始日・期限・休みの行');
  // 1-3 日数がすべて 0 でも、目盛りは少なくとも 0〜1 日
  const l3 = D.addEntries([], [B('2026-05-01', { wbs: '' }), B('2026-05-02', { wbs: '' })]).list;
  const r3 = D.render(l3, 'trend', null);
  for (const id of ['burnup', 'effort']) { const t = txts(r3.figures.find((f) => f.id === id).svg); ok(t.includes('1') && !t.some((x) => x.startsWith('0.000')), `${id} の目盛りが 1 日に届かない: ${t.join(' ')}`); }
  // 1-12 タスクがないときは F も J も「タスクがありません」
  const r12 = D.render(l3, 'gantt', [l3[0], l3[1]]);
  ok(r12.figures.every((f) => txts(f.svg).includes('タスクがありません')), 'タスクがないときの F・J の表示がそろっていない');
  // 1-4 印刷: G と J の最初のページにも「比較: … → …」
  const many = (v, n) => B(v, { wbs: Array.from({ length: n }, (_, k) => `- 作${k}\n  - 細${k} days: ${1 + (k % 3)} by: 甲野\n`).join('') });
  const l4 = D.addEntries([], [many('2026-05-01', 70), many('2026-05-02', 70)]).list;
  const pS = D.printPages(l4, 'sched', [l4[0], l4[1]]), pG = D.printPages(l4, 'gantt', [l4[0], l4[1]]);
  const first = (pages, title) => pages.find((x) => txts(x).includes(title));
  ok(txts(first(pS, '見積もりの変化')).some((x) => x.startsWith('比較: ')), '印刷した見積もりの変化に比較の行がない');
  ok(txts(first(pG, '担当者別ガントチャートの比較')).some((x) => x.startsWith('比較: ')), '印刷した担当者別ガントチャートに比較の行がない');
  // G の凡例
  ok(txts(D.render(l4, 'sched', [l4[0], l4[1]]).figures[0].svg).filter((x) => x === '変更前' || x === '変更後').length === 2, '見積もりの変化に凡例がない');
  // 1-5・1-6 長い名前でも、変更の多い部分・担当者別ガントチャート・作成の日数は縮みすぎない
  const longP = '長'.repeat(120), longM = '名'.repeat(80);
  const l5 = D.addEntries([], [B('2026-05-01', { members: [longM], wbs: `- ${longP}\n  - 甲 days: 1 by: ${longM}\n` }), B('2026-05-02', { members: [longM], wbs: `- ${longP}\n  - 甲 days: 2 by: ${longM}\n  - 乙 days: 1 by: ${longM}\n` })]).list;
  const w = (svg) => +/width="(\d+)"/.exec(svg)[1];
  const fT = D.render(l5, 'trend', null).figures, fJ = D.render(l5, 'gantt', [l5[0], l5[1]]).figures[1];
  ok(w(fT.find((f) => f.id === 'changes').svg) < 700 && w(fT.find((f) => f.id === 'effort').svg) < 1000 && w(fJ.svg) < 1047, `長い名前で図が広がる: ${w(fT.find((f) => f.id === 'changes').svg)} ${w(fT.find((f) => f.id === 'effort').svg)} ${w(fJ.svg)}`);
}
// ---- ガントチャートの休み(5.10 節)と印刷のページ(7.5 節)
{
  const txts = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
  const B = (v, off) => D.load(`${v}.plan`, `version: ${v}\nstart: 2026-05-01\n${off ? `off: ${off}\n` : ''}members:\n- 甲 off: 2026-05-06\n- 乙\nWBS: 計画\n- 設計\n  - 画面 days: 4 by: 甲\n  - 帳票 days: 3 by: 乙 after: 画面\n- 実装\n  - 本体 days: 5 by: 甲, 乙 after: 帳票\n`);
  const l = D.addEntries([], [B('2026-04-25', '2026-05-04..2026-05-05'), B('2026-04-28', '2026-05-11')]).list;
  const o = D.overlayData(l[0], l[1]);
  // 棒は全体の休みと作成者の個人の休みで切る。変更前の「画面」は 5/1〜5/3、(5/4・5/5 は全体の休み、5/6 は甲の休み)、5/7
  const day = (s) => Math.round(Date.parse(s) / 86400000);
  eq(o.rows.find((r) => r.key === '設計::画面').pS, [[day('2026-05-01'), day('2026-05-03')], [day('2026-05-07'), day('2026-05-07')]], '休みで切った棒(変更前)');
  eq(o.rows.find((r) => r.key === '設計::画面').nS, [[day('2026-05-01'), day('2026-05-04')]], '休みに当たらない棒は 1 本(変更後)');
  eq(o.rows.find((r) => r.key === '実装::本体').nS.length, 2, '変更後の本体は 5/11(全体の休み)で 2 本に切れる');
  const r = D.render(l, 'gantt', [l[0], l[1]]);
  for (const f of r.figures) {
    const t = txts(f.svg);
    ok(t.includes('全体の休み(変更後)') && t.includes('変更前だけの休み') && f.svg.includes('fill="#e6e6e2"') && f.svg.includes('url(#offA)'), `${f.id} に休みの網と凡例がない`);
  }
  const l0 = D.addEntries([], [B('2026-04-25', ''), B('2026-04-28', '')]).list;
  ok(D.render(l0, 'gantt', [l0[0], l0[1]]).figures.every((f) => !txts(f.svg).includes('全体の休み(変更後)') && !f.svg.includes('url(#offA)')), '休みがないのに凡例か網がある');
  // 印刷: 比較の要約は独立したページ、F・J は図だけのページから始まる
  const pages = D.printPages(l, 'gantt', [l[0], l[1]]);
  const first = pages.map((p) => txts(p).slice(0, 2).join(' / '));
  ok(pages.length === 3 && txts(pages[0]).includes('対応した要素') && !txts(pages[0]).includes('ガントチャートの比較')
    && txts(pages[1])[1] === 'ガントチャートの比較' && !txts(pages[1]).includes('対応した要素') && txts(pages[2])[1] === '担当者別ガントチャートの比較', `ガントチャートの印刷のページ: ${first.join(' | ')}`);
}
// ---- プロジェクト計画 v0.31 の取り込みと指摘の修正(v0.31)
{
  const P2 = (v, o = {}) => D.load(`${v}.plan`, `version: ${v}\nstart: 2026-05-01\n${o.off ? `off: ${o.off}\n` : ''}members:\n- 甲${o.moff ? ` off: ${o.moff}` : ''}\n- 乙\nWBS: 計画\n- 設計\n  - 画面 days: 2 by: 甲\n  - 節目 days: 0 by: 乙 after: 画面\n`);
  // 1-3 休みの空白・並びだけの違いは変更としない。実際の違いは変更とする
  const l = D.addEntries([], [P2('2026-05-01', { off: 'sat,sun', moff: 'thu,fri' }), P2('2026-05-02', { off: 'sat, sun', moff: 'thu, fri' }), P2('2026-05-03', { off: 'sun, sat', moff: 'fri, thu' }), P2('2026-05-04', { off: 'sun', moff: 'fri' })]).list;
  const h = D.revisionHistory(l).rows.map((r) => `${r.cells[0]}|${r.cells[2]}|${r.cells[3]}`);
  ok(h.includes('2026-05-02 版|―|変更なし') && h.includes('2026-05-03 版|―|変更なし'), `空白・並びだけの休みの違いが変更になる: ${h.join(' / ')}`);
  ok(h.includes('2026-05-04 版|全体の休み|変更') && h.includes('2026-05-04 版|メンバーの休み|変更'), `休みの実際の違いが変更にならない: ${h.join(' / ')}`);
  const ov = D.build(l, 'overview', null).tables[0].rows.find((r) => r.cells[0] === '全体の休み').cells;
  ok(typeof ov[2] === 'string' && typeof ov[3] === 'string' && typeof ov[4] === 'object', '概要の全体の休みの太字が、空白・並びだけの違いでも付く、または実際の違いで付かない');
  ok(ov[2] === 'sat, sun', '概要の全体の休みは書いたままの文で示す');
  // 1-2 日数 0 のタスクは開始日に幅 2 px の細い棒(1 日分の幅にしない)
  const o = D.overlayData(l[0], l[3]);
  const r0 = o.rows.find((r) => r.key === '設計::節目');
  ok(r0 && r0.nS.length === 1 && r0.nS[0][2] === true, '日数 0 のタスクに細い棒の印がない');
  const svg = D.render(l, 'gantt', [l[0], l[3]]).figures[0].svg;
  // F の棒の高さは 7。日数 0 のタスク(変更前・変更後の 2 本)だけが幅 2 になる
  ok((svg.match(/<rect[^>]*width="2" height="7"/g) ?? []).length === 2, `日数 0 のタスクの棒の幅が 2 でない: ${(svg.match(/<rect[^>]*width="2" height="7"/g) ?? []).length}`);
}
// ---- 3 回目のレビューの指摘の修正(v0.32)
{
  const PX = (v, o = {}) => D.load(`${v}.plan`, `version: ${v}\nstart: 2026-05-04\n${o.off ? `off: ${o.off}\n` : ''}members:\n- 甲\n- 乙\nWBS: 計画\n- 設計\n  - 画面 days: 2 by: 甲\n  - 審査 days: 0 by: 甲 after: 画面\n  - 着手 days: 0 by: 乙\n  - 帳票 days: 2 by: 甲 after: 審査\n  - 本体 days: 3 by: 乙 after: 着手\n`);
  const l = D.addEntries([], [PX('2026-05-01', { off: '2026-05-10..2026-05-12' }), PX('2026-05-02', { off: '2026-05-10 .. 2026-05-12' })]).list;
  // 6 範囲の `..` の前後の空白だけの違いは変更としない
  ok(D.revisionHistory(l).rows.some((r) => r.cells[0].startsWith('2026-05-02') && r.cells[3] === '変更なし'), '`..` の前後の空白だけの違いが変更になる');
  // 2 日数 0 の細い棒は、先行が終わった時刻(先行の最後の日の右端)に立つ
  const o = D.overlayData(l[0], l[1]);
  const pre = o.rows.find((r) => r.key === '設計::画面'), z = o.rows.find((r) => r.key === '設計::審査');
  ok(z.nS[0][2] === true && z.nS[0][0] === pre.n[1] + 1, `細い棒の位置が先行の終わりでない: ${z.nS[0][0]} と ${pre.n[1] + 1}`);
  const f = D.render(l, 'gantt', [l[0], l[1]]).figures;
  const rects = (svg) => [...svg.matchAll(/<rect x="([\d.-]+)" y="([\d.]+)" width="([\d.]+)" height="(7|13)"([^>]*)\/>/g)].map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4], a: m[5] }));
  const fr = rects(f[0].svg), thin = fr.filter((r) => r.w === 2), wide = fr.filter((r) => r.w > 2);
  ok(thin.some((t) => wide.some((b) => Math.abs(b.x + b.w - (t.x + 1)) < 0.01)), '細い棒が先行の棒の右端に立っていない'); // 審査の行の細い棒の中心が、画面の行の棒の右端と同じ x
  // 3 担当者別の細い棒は白い縁を付けない(灰が見えるように)
  const jt = rects(f[1].svg).filter((r) => r.w === 2);
  ok(jt.length > 0 && jt.every((r) => !r.a.includes('stroke')), `担当者別の細い棒に縁が付いている: ${jt.map((r) => r.a).join(' | ')}`);
  // 細い棒は、同じ段(同じ y)のほかの棒より後(上)に描く(隣の棒に隠れない)
  const jr = [...f[1].svg.matchAll(/<rect x="[\d.-]+" y="([\d.]+)" width="([\d.]+)" height="13"/g)].map((m, k) => ({ k, y: m[1], w: +m[2] }));
  ok(jr.filter((r) => r.w === 2).every((t) => jr.filter((r) => r.y === t.y && r.w > 2).every((b) => b.k < t.k)), '担当者別で細い棒が同じ段のほかの棒より先に描かれ、隠れることがある');
  // 4・5 build.py: 写し元がない sync と、知らない命令
  const cp = require('child_process'), os = require('os'), path = require('path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjb-')); fs.mkdirSync(path.join(tmp, 'proj', 'dev'), { recursive: true });
  fs.copyFileSync(`${__dirname}/../dev/build.py`, path.join(tmp, 'proj', 'dev', 'build.py'));
  const run = (arg) => cp.spawnSync('python3', [path.join(tmp, 'proj', 'dev', 'build.py'), arg], { encoding: 'utf8' });
  const r1 = run('sync'), r2 = run('chek');
  ok(r1.status === 1 && r1.stdout.includes('がありません') && !r1.stderr.includes('Traceback'), `写し元がない sync: ${r1.status} ${r1.stdout}${r1.stderr}`);
  ok(r2.status === 2 && r2.stdout.includes('知らない命令'), `知らない命令: ${r2.status} ${r2.stdout}`);
}
console.log(`${pass} 件 OK、${fail} 件 NG`);
process.exit(fail ? 1 : 0);
