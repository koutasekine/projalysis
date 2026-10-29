/*DIFF-BEGIN*/
// ---- 比べる処理(DOM を使わない。Node でも動く)。計算部(core.js の Plan)は書き換えずに使う
const Projalysis = (() => {
'use strict';
/* global Plan */
const P = typeof Plan !== 'undefined' ? Plan : require('./core.js');

// ================= 版(仕様書 3 章) =================
const norm = (t) => t.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
// 版を読む。r は計算部の解析の結果。date は版の日付(1970-01-01 からの日数。なければ null)
function load(name, text0) {
  const text = norm(text0);
  const r = P.analyze(text);
  const v = r.parse.sec.version;
  const date = v && typeof v.date === 'number' ? v.date : null;
  const errs = r.diags.filter((d) => d.level === 'error');
  return {
    name, text, r, date,
    // 最初のエラーは、行の番号がいちばん小さいもの(計算部は必須の節の欠けを最後に積むため、並びの先頭とは限らない)
    nErr: errs.length, firstErr: errs.length ? errs.reduce((x, y) => (y.line < x.line ? y : x)) : null,
    nWarn: r.diags.filter((d) => d.level === 'warn').length,
    comparable: !!r.ok && date !== null,
  };
}
// 一覧の並び: 版の日付の古い順。同じ日付の中は今の並びを保つ(安定な並べ替え)。版の日付のない版は最後
const dateKey = (e) => (e.date === null ? Infinity : e.date);
const sortList = (list) => list.map((e, i) => [e, i]).sort((a, b) => dateKey(a[0]) - dateKey(b[0]) || a[1] - b[1]).map((x) => x[0]);
// 足す(仕様書 3.3 節)。テキストが一覧のどれかと同じ版は足さない。戻り値 { list, added, skipped }
function addEntries(list, entries) {
  const out = list.slice(), added = [], skipped = [];
  for (const e of entries) {
    const dup = out.find((x) => x.text === e.text);
    if (dup) { skipped.push({ name: e.name, dup: dup.name }); continue; }
    out.push(e); added.push(e);
  }
  return { list: sortList(out), added, skipped };
}
// 同じ日付の中だけ、1 つ前(dir = -1)か後ろ(dir = 1)と入れ替える。入れ替えられなければ null
function moveEntry(list, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= list.length || list[i].date === null || list[j].date !== list[i].date) return null;
  const out = list.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
const canMove = (list, i, dir) => moveEntry(list, i, dir) !== null;
// 版の名前(仕様書 3.5 節)。同じ日付の比べられる版の 2 つ目から (2)、(3)…。比べられない版は番号を数えず、付けない
function labels(list) {
  const m = new Map(), seen = new Map();
  for (const e of list) {
    if (e.date === null) { m.set(e, 'version: なし'); continue; }
    if (!e.comparable) { m.set(e, `${P.fmtDate(e.date)} 版`); continue; }
    const k = (seen.get(e.date) ?? 0) + 1;
    seen.set(e.date, k);
    m.set(e, `${P.fmtDate(e.date)} 版${k > 1 ? ` (${k})` : ''}`);
  }
  return m;
}

// ================= 対応づけ(仕様書 4 章) =================
// 対応名: 根を除いた祖先と自分の名前を :: でつなぐ。根は空
const qn = (n) => { const a = []; for (let x = n; x && x.parent; x = x.parent) a.unshift(x.name); return a.join('::'); };
// 表に出す名前: 根は「名前(根)」
const disp = (n) => (n.parent ? qn(n) : `${n.name}(根)`);
const parentDisp = (n) => (n.parent && n.parent.parent ? qn(n.parent) : '(根)');
const isTask = (n) => !!n.parent && !n.children.length;
function match(rA, rB, key) {
  const has = (r) => !!r.sec[key];
  const all = (r) => (has(r) ? r.bySec[key] : []);
  const A = all(rA).filter((n) => n.parent), B = all(rB).filter((n) => n.parent);
  const map = new Map(), inv = new Map(), moved = new Set();
  const pair = (a, b) => { map.set(a, b); inv.set(b, a); };
  const rootA = has(rA) ? rA.sec[key].root : null, rootB = has(rB) ? rB.sec[key].root : null;
  if (rootA && rootB) pair(rootA, rootB);
  const byKey = new Map(B.map((b) => [qn(b), b]));
  for (const a of A) { const b = byKey.get(qn(a)); if (b) pair(a, b); }
  // 移動: 対応しなかった要素のうち、同じ名前が消えた側と増えた側にちょうど 1 つずつあるもの(仕様書 4.3 節)
  const uA = A.filter((a) => !map.has(a)), uB = B.filter((b) => !inv.has(b));
  const cnt = (list) => { const c = new Map(); for (const n of list) c.set(n.name, (c.get(n.name) ?? 0) + 1); return c; };
  const cA = cnt(uA), cB = cnt(uB);
  for (const a of uA) {
    if (cA.get(a.name) !== 1 || cB.get(a.name) !== 1) continue;
    const b = uB.find((x) => x.name === a.name);
    pair(a, b); moved.add(a);
  }
  return { map, inv, moved, A, B, rootA, rootB, hasA: has(rA), hasB: has(rB) };
}
// 対応した要素の数(仕様書 4.5 節): 根は数えない。移動は対応したと数える
const countOf = (m) => { const matched = m.A.filter((a) => m.map.has(a)).length; return { matched, total: m.A.length + m.B.length - matched }; };

// ================= 比べる(仕様書 5 章) =================
const uniq = (a) => [...new Set(a)];
const setEq = (x, y) => { const a = uniq(x), b = uniq(y); return a.length === b.length && a.every((v) => b.includes(v)); };
const listText = (a) => (a.length ? a.join('・') : 'なし'); // 人や名前の並びは「・」でつなぐ(項目の区切りの「、」と見分けるため)
const offText = (r) => (r.sec.off ? r.text.slice(r.sec.off.start, r.sec.off.end).replace(/^off:/, '').trim() : '');
// 休みの値を比べるための形(カンマで区切り、空白を除いて並べ替える)。空白や並びだけの違いは変更としない(5.13 節)
const offKey = (s) => (s ?? '').split(',').map((x) => x.replace(/\s+/g, '')).filter(Boolean).sort().join(','); // 値の中の空白(`..` の前後など)も除く
const memberOff = (m) => (m.attrList.find((a) => a.key === 'off')?.text ?? '').trim();
// タスクに効いている先行: そのタスクと祖先に書いた after: が指す要素(下のタスクには広げない。仕様書 5.4 節)
function effAfter(t) { const out = []; for (let x = t; x; x = x.parent) for (const y of x.R.after ?? []) if (!out.includes(y)) out.push(y); return out; }

// サマリー(全版。仕様書 5.1 節)の行
const elemCount = (r, key) => (r.sec[key] ? String(r.bySec[key].filter((n) => n.parent).length) : '―');
const OVERVIEW_ROWS = [
  ['版', (e, lab) => lab.get(e)],
  ['ファイル', (e) => e.name],
  ['開始日', (e) => P.fmtDate(e.r.sec.start.date)],
  ['期限', (e) => (e.r.sec.end ? P.fmtDate(e.r.sec.end.date) : '―')],
  ['全体の休み', (e) => offText(e.r) || '―'],
  ['クリティカルパスの長さ(日)', (e) => P.fmtDays(e.r.cp.T)],
  ['日程の長さ(日)', (e) => String(e.r.sched.spanDays)],
  ['終了日', (e) => (e.r.sched.finishDate === null ? '―' : P.fmtDate(e.r.sched.finishDate))],
  ['メンバー数', (e) => String(e.r.members.length)],
  // 要素数は 4.5 節と同じ数え方(途中の要素を含み、根は数えない)。節がなければ「―」
  ['FBS の要素の数', (e) => elemCount(e.r, 'FBS')],
  ['PBS の要素の数', (e) => elemCount(e.r, 'PBS')],
  ['WBS の要素の数', (e) => elemCount(e.r, 'WBS')],
  ['タスク数', (e) => String(e.r.tasks.length)],
  ['総日数', (e) => P.fmtDays(e.r.tasks.reduce((a, t) => a + t.days, 0))],
  // MOP 総数は mop: と mop*: の合計。チェック済みの MOP 数は mop*: の数
  ['MOP 総数', (e) => (e.r.sec.FBS ? String(e.r.bySec.FBS.reduce((a, n) => a + n.mops.length, 0)) : '―')],
  ['チェック済みの MOP 数', (e) => (e.r.sec.FBS ? String(e.r.bySec.FBS.reduce((a, n) => a + n.mopChecked.filter(Boolean).length, 0)) : '―')],
  ['警告数', (e) => String(e.nWarn)],
];
function overview(list) {
  const lab = labels(list);
  const cols = list.filter((e) => e.comparable);
  return { cols, rows: OVERVIEW_ROWS.map(([name, f]) => ({ name, values: cols.map((e) => f(e, lab)) })) };
}

// 2 つの版を比べる。a・b は比べられる版(a が一覧で前)
function compare(a, b) {
  const rA = a.r, rB = b.r;
  const M = { FBS: match(rA, rB, 'FBS'), PBS: match(rA, rB, 'PBS'), WBS: match(rA, rB, 'WBS') };
  // 根の名前の変更(仕様書 4.2 節)
  const roots = [];
  for (const k of ['FBS', 'PBS', 'WBS']) if (M[k].rootA && M[k].rootB && M[k].rootA.name !== M[k].rootB.name) roots.push({ sec: k, from: M[k].rootA.name, to: M[k].rootB.name });
  // 対応した要素の数
  const counts = [];
  for (const k of ['FBS', 'PBS', 'WBS']) if (M[k].hasA || M[k].hasB) counts.push({ sec: k, ...countOf(M[k]) });
  const namesA = rA.members.map((m) => m.name), namesB = rB.members.map((m) => m.name);
  const both = namesA.filter((n) => namesB.includes(n));
  counts.push({ sec: 'メンバー', matched: both.length, total: namesA.length + namesB.length - both.length });

  // ---- WBS のビュー: タスク(末端の要素)の変化(仕様書 5.4 節)
  const W = M.WBS;
  const tA = rA.tasks, tB = rB.tasks;
  const added = tB.filter((t) => !W.inv.has(t) || !isTask(W.inv.get(t))).map((t) => ({ t, note: W.inv.has(t) ? '(子要素がなくなった)' : '' }));
  const removed = tA.filter((t) => !W.map.has(t) || !isTask(W.map.get(t))).map((t) => ({ t, note: W.map.has(t) ? '(子要素ができた)' : '' }));
  const pairs = tA.filter((t) => W.map.has(t) && isTask(W.map.get(t))).map((t) => [t, W.map.get(t)]).sort((x, y) => x[1].order - y[1].order);
  const moved = pairs.filter(([x]) => W.moved.has(x)).map(([x, y]) => ({ key: disp(y), from: parentDisp(x), to: parentDisp(y) }));
  const ref = (m, nodesA, nodesB) => setEq(nodesA.map((n) => (m.map.has(n) ? `B${m.map.get(n).id}` : `A${n.id}`)), nodesB.map((n) => `B${n.id}`));
  const changed = [], status = [], changedN = [];
  for (const [x, y] of pairs) {
    const items = [];
    if (x.days !== y.days) items.push(['日数', P.fmtDays(x.days), P.fmtDays(y.days)]);
    const nm = (l) => l.map((m) => m.name);
    if (!setEq(nm(x.by), nm(y.by))) items.push(['作成者', listText(nm(x.by)), listText(nm(y.by))]);
    if (!setEq(nm(x.review), nm(y.review))) items.push(['確認者', listText(nm(x.review)), listText(nm(y.review))]);
    if (!ref(M.PBS, x.for, y.for)) items.push(['対象', listText(x.for.map(disp)), listText(y.for.map(disp))]);
    const pa = effAfter(x), pb = effAfter(y);
    if (!ref(W, pa, pb)) items.push(['先行', listText(pa.map(disp)), listText(pb.map(disp))]);
    if ((x.note ?? '') !== (y.note ?? '')) items.push(['メモ', x.note ?? 'なし', y.note ?? 'なし']);
    if (items.length) { changed.push({ key: disp(y), items }); changedN.push(y); }
    if (x.status !== y.status) status.push({ key: disp(y), from: P.STATUS[x.status], to: P.STATUS[y.status] });
  }
  const taskRow = (t) => [P.fmtDays(t.days), listText(t.by.map((m) => m.name)), listText(t.review.map((m) => m.name))];

  // ---- 日程(仕様書 5.5 節)
  const sched = pairs.map(([x, y]) => {
    const ea = rA.sched.start + x.d1, eb = rB.sched.start + y.d1;
    return { key: disp(y), a: P.fmtDate(ea), b: P.fmtDate(eb), diff: eb - ea };
  });
  const maxDiff = sched.length ? Math.max(...sched.map((s) => s.diff)) : 0;
  const worst = maxDiff > 0 ? sched.filter((s) => s.diff === maxDiff) : [];

  // ---- FBS・PBS・MOP(仕様書 5.6 節)
  // 増えた・消えた要素は [対応名, MOP の文(FBS だけ。チェック済みには ✓)]
  const mopsOf = (n) => (n.mops.length ? n.mops.map((t, i) => `${n.mopChecked[i] ? '✓ ' : ''}${t}`).join(' / ') : 'なし');
  const tree = (m) => ({
    show: m.hasA || m.hasB,
    added: m.B.filter((n) => !m.inv.has(n)).map((n) => [disp(n), mopsOf(n)]),
    removed: m.A.filter((n) => !m.map.has(n)).map((n) => [disp(n), mopsOf(n)]),
    moved: m.A.filter((n) => m.moved.has(n)).sort((x, y) => m.map.get(x).order - m.map.get(y).order).map((n) => ({ key: disp(m.map.get(n)), from: parentDisp(n), to: parentDisp(m.map.get(n)) })),
  });
  const mop = { show: M.FBS.hasA || M.FBS.hasB, added: [], removed: [], checked: [], unchecked: [] };
  const fPairs = [...M.FBS.map].sort((x, y) => x[1].order - y[1].order);
  for (const [x, y] of fPairs) {
    const used = new Set();
    const mi = x.mops.map((t) => { const j = y.mops.findIndex((u, k) => u === t && !used.has(k)); if (j >= 0) used.add(j); return j; });
    x.mops.forEach((t, i) => {
      const j = mi[i];
      if (j < 0) { mop.removed.push([disp(y), t]); return; }
      if (!x.mopChecked[i] && y.mopChecked[j]) mop.checked.push([disp(y), t]);
      if (x.mopChecked[i] && !y.mopChecked[j]) mop.unchecked.push([disp(y), t]);
    });
    y.mops.forEach((t, j) => { if (!used.has(j)) mop.added.push([disp(y), t]); });
  }

  // ---- 担当者(仕様書 5.7 節)
  const lA = P.peopleLoad(rA), lB = P.peopleLoad(rB);
  const daysOf = (l, name) => l.rows.find((x) => x.m.name === name).days;
  const people = {
    added: namesB.filter((n) => !namesA.includes(n)),
    removed: namesA.filter((n) => !namesB.includes(n)),
    rows: namesB.filter((n) => namesA.includes(n)).map((n) => ({ name: n, a: daysOf(lA, n), b: daysOf(lB, n) })),
    off: [],
  };
  if (lA.none || lB.none) people.rows.push({ name: '(担当なし)', a: lA.none ? lA.none.days : 0, b: lB.none ? lB.none.days : 0 });
  for (const n of both) {
    const oa = memberOff(rA.members.find((m) => m.name === n)), ob = memberOff(rB.members.find((m) => m.name === n));
    if (offKey(oa) !== offKey(ob)) people.off.push({ name: n, a: oa || 'なし', b: ob || 'なし' });
  }
  return {
    a, b, roots, counts,
    tasks: {
      added: added.map(({ t, note }) => [disp(t) + note, ...taskRow(t)]),
      removed: removed.map(({ t, note }) => [disp(t) + note, ...taskRow(t)]),
      moved, changed, status,
    },
    // 要素そのもの(推移の図 I とガントチャートで使う。5.4 節の判定と同じもの)
    _n: { added: added.map((x) => x.t), removed: removed.map((x) => x.t), pairs, moved: pairs.filter(([x]) => W.moved.has(x)), changed: changedN },
    sched: { rows: sched, worst, maxDiff },
    fbs: tree(M.FBS), pbs: tree(M.PBS), mop, people,
  };
}

// ================= 表と図(SVG の文字列。仕様書 6 章) =================
const FONT = "'Hiragino Sans','Noto Sans JP','Yu Gothic UI','Meiryo','Segoe UI',sans-serif";
const COL = { line: '#333', grid: '#c8c8c4', head: '#f4f4f2', text: '#222', sub: '#666' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const charW = (ch, fs) => (/[\u0000-\u024f\uff61-\uff9f]/.test(ch) ? 0.6 : 1) * fs;
const textW = (s, fs) => [...s].reduce((a, ch) => a + charW(ch, fs), 0);
const NOHEAD = '、。，．,.)）」』】〕〉》・：；:;!！?？ー…'; // 行頭に置かない文字(行頭禁則。前の行の最後の文字ごと次の行へ送る)
function wrap(s, maxW, fs) {
  const out = [];
  let cur = '', w = 0;
  for (const ch of s) {
    const cw = charW(ch, fs);
    if (w + cw > maxW && cur) {
      // 行頭禁則: 送る文字が行頭に置けないときは、前の行の最後の文字も次の行へ送る
      // 送る文字の前も行頭に置けない文字なら、さらに前の文字まで送る(行は空にしない)
      if (NOHEAD.includes(ch) && [...cur].length > 1) { const k = [...cur]; const mv = []; do { mv.unshift(k.pop()); } while (k.length > 1 && NOHEAD.includes(mv[0])); out.push(k.join('')); cur = mv.join(''); w = textW(cur, fs); }
      else { out.push(cur); cur = ''; w = 0; }
    }
    cur += ch; w += cw;
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}
const T_ = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.fs ?? 13}"${o.fill ? ` fill="${o.fill}"` : ''}${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;
const wrapSvg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(w)}" height="${Math.ceil(h)}" viewBox="0 0 ${Math.ceil(w)} ${Math.ceil(h)}" font-family="${esc(FONT)}"><rect x="0" y="0" width="${Math.ceil(w)}" height="${Math.ceil(h)}" fill="#fff"/>${body}</svg>`;
const M = 20, FS = 12, LH = 16, PX = 6, PY = 5, MAXCOL = 320;

// 表: { title, header: [...], rows: [{ cells: [文字 か { t, bold }], group }] }。group が同じ連続した行は 1 列目をまとめたセルにする
const cellT = (c) => (typeof c === 'string' ? c : c.t);
function colWidths(tbl) {
  const n = tbl.header.length;
  // 列の幅の上限は MAXCOL。表ごとに列を指定して広げられる(tbl.maxw: { 列の番号: 幅 })
  return Array.from({ length: n }, (_, j) => Math.min(tbl.maxw?.[j] ?? MAXCOL, Math.max(textW(tbl.header[j], FS), ...tbl.rows.map((r) => textW(cellT(r.cells[j]), FS))) + 2 * PX));
}
const rowLines = (row, ws) => row.cells.map((c, j) => wrap(cellT(c), ws[j] - 2 * PX, FS));
const rowH = (lines) => Math.max(...lines.map((l) => l.length)) * LH + 2 * PY;
// 表の高さ(rows の範囲だけ)
function tableH(tbl, ws, rows) { const hh = rowH(tbl.header.map((h, j) => wrap(h, ws[j] - 2 * PX, FS))); return hh + rows.reduce((a, r) => a + rowH(rowLines(r, ws)), 0); }
function drawTable(tbl, ws, rows, x0, y0) {
  const out = [];
  const xs = [x0]; for (const w of ws) xs.push(xs[xs.length - 1] + w);
  const cell = (x, y, w, h, lines, o = {}) => {
    out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${o.fill ?? '#fff'}" stroke="${COL.grid}"/>`);
    lines.forEach((l, k) => out.push(T_(x + PX, y + PY + LH * k + 12, l, { fs: FS, weight: o.bold ? '600' : null })));
  };
  const hl = tbl.header.map((h, j) => wrap(h, ws[j] - 2 * PX, FS));
  const hh = rowH(hl);
  hl.forEach((l, j) => cell(xs[j], y0, ws[j], hh, l, { fill: COL.head, bold: true }));
  let y = y0 + hh;
  const geo = rows.map((r) => { const l = rowLines(r, ws); return { r, l, h: rowH(l) }; });
  // まとめる列の数(先頭から。既定は 1 列目だけ)
  const nm = tbl.merge ?? 1;
  for (let i = 0; i < geo.length; i++) {
    const g = geo[i];
    const bold = (j) => typeof g.r.cells[j] === 'object' && g.r.cells[j].bold;
    const mark = out.length;
    // まとめたセル: 同じ group の連続した行の高さを合わせて 1 つに描く
    let start = nm;
    if (g.r.group != null) {
      const first = i === 0 || geo[i - 1].r.group !== g.r.group;
      if (first) {
        let h = 0;
        for (let k = i; k < geo.length && geo[k].r.group === g.r.group; k++) h += geo[k].h;
        for (let j = 0; j < nm; j++) cell(xs[j], y, ws[j], h, g.l[j], { bold: bold(j) });
      }
    } else start = 0;
    for (let j = start; j < ws.length; j++) cell(xs[j], y, ws[j], g.h, g.l[j], { bold: bold(j) });
    // 行を押すと比べる 2 つの版を選ぶ(改訂履歴。5.13 節)
    if (g.r.ver != null) { out.splice(mark, 0, `<g data-ver="${g.r.ver}">`); out.push('</g>'); }
    y += g.h;
  }
  return { body: out.join(''), h: y - y0, w: xs[xs.length - 1] - x0 };
}

// ビューの部品: { kind: 'text', text, fs, weight, fill } か { kind: 'table', tbl }
const txt = (text, o = {}) => ({ kind: 'text', text, fs: o.fs ?? 13, weight: o.weight ?? null, fill: o.fill ?? null });
// 文は TEXT_W で折り返す(長い 1 行で図の幅が広がり、印刷で縮みすぎないため)
const TEXT_W = 900;
const textLines = (b) => wrap(b.text, TEXT_W, b.fs);
const blockH = (b) => (b.kind === 'text' ? b.fs + (textLines(b).length - 1) * (b.fs + 6) + 10 : b.kind === 'gap' ? b.h : 0);
// 部品を上から並べて 1 枚の SVG にする。ws: 表ごとの列の幅(印刷で分けたときも全体と同じ幅にするため)
// anchors: 題の位置を集める配列(画面で題の右にボタンを置くため。仕様書 8.2 節・9.3 節)。図そのものには何も足さない
function compose(blocks, anchors = null) {
  const out = [];
  let y = M, w = 0;
  for (const b of blocks) {
    if (b.kind === 'text') {
      const top = y, ls = textLines(b);
      ls.forEach((l, k) => { y += k ? b.fs + 6 : b.fs; out.push(T_(M, y, l, { fs: b.fs, weight: b.weight, fill: b.fill })); w = Math.max(w, textW(l, b.fs)); });
      // label: 題の最後の行(画面で文字の範囲を測って、ボタンの位置を合わせるため)
      if (anchors && b.anchor) anchors.push({ ...b.anchor, label: ls[ls.length - 1], x: M + textW(ls[ls.length - 1], b.fs) + 6, y: y - b.fs });
      y += 10; continue;
    }
    if (b.kind === 'gap') { y += b.h; continue; }
    if (b.kind === 'fig') { out.push(`<g transform="translate(${M},${y})">${b.body}</g>`); w = Math.max(w, b.w); y += b.h + 6; continue; }
    const ws = b.ws ?? colWidths(b.tbl);
    const d = drawTable(b.tbl, ws, b.rows ?? b.tbl.rows, M, y);
    out.push(d.body); w = Math.max(w, d.w); y += d.h + 6;
  }
  return wrapSvg(w + 2 * M, y + M - 6, out.join(''));
}

// 表の部品と、コピー・表の画像の保存の対象。空の表は「なし」の文にする(仕様書 5.8 節)
function section(blocks, tables, title, header, rows, o = {}) {
  if (!rows.length) { blocks.push(txt(`${title}: なし`, { fs: 13 })); return; }
  const tb = txt(o.noCount ? title : `${title}(${rows.length} 件)`, { fs: 13, weight: '600' });
  blocks.push(tb);
  const tbl = { title, header, rows: rows.map((r) => (Array.isArray(r) ? { cells: r } : r)) };
  tb.anchor = { kind: 'table', ref: tbl };
  blocks.push({ kind: 'table', tbl });
  tables.push(tbl);
}
const heading = (blocks, s) => { blocks.push({ kind: 'gap', h: 6 }); blocks.push(txt(s, { fs: 15, weight: '600' })); };

// ================= 推移とガントチャートと見積もりの変化(仕様書 5.5・5.9〜5.12 節) =================
// 状態の色はプロジェクト計画のガントチャートと同じ(実行前は白地に黒枠、実行中は青、完了は薄い灰、問題発生はえんじ)
const STATUS_FILL = { todo: '#fff', doing: '#2b8fd8', done: '#bdbdb8', blocked: '#8b1a2b' };
const ACCENT = '#8b1a2b';
const STACK = ['done', 'doing', 'blocked', 'todo']; // 積み上げの順(下から)
const PREV_FILL = '#c8c8c4';                        // ガントチャート・G の前の版の棒
// WBS の第 1 層の要素(根の子)。タスクが根の直下なら、そのタスク自身
const phaseOf = (n) => { let x = n; while (x.parent && x.parent.parent) x = x.parent; return x.name; };
const md = (d) => P.fmtDate(d).slice(5);
// 名前を幅に収める。添え書き(「(増えた)」など)と末端の側は残し、先頭の側を「…」で縮める(末端の名前で見分けられるように)
function clipName(key, suffix, maxW, fs = 12) {
  if (textW(key + suffix, fs) <= maxW) return key + suffix;
  const room = maxW - textW(`…${suffix}`, fs);
  const chs = [...key];
  let out = '';
  for (let k = chs.length - 1; k >= 0 && textW(chs[k] + out, fs) <= room; k--) out = chs[k] + out;
  return `…${out}${suffix}`;
}
const sumDays = (ts) => ts.reduce((a, t) => a + t.days, 0);

// ---- 推移の元の数(5.9 節)。i は比べられる版の並びの中の番号(図から選ぶときに使う)
function trendData(list) {
  const lab = labels(list), vs = list.filter((e) => e.comparable), names = vs.map((e) => lab.get(e));
  const A = vs.map((e, i) => ({ i, label: names[i], finish: e.r.sched.finishDate, end: e.r.sec.end ? e.r.sec.end.date : null }));
  // E: 同じ日付の版は、その日付の一覧で最後の版で代表させる
  const last = new Map();
  vs.forEach((e, i) => last.set(e.date, i));
  const E = [...last].map(([date, i]) => ({ i, date, label: names[i], total: sumDays(vs[i].r.tasks), done: sumDays(vs[i].r.tasks.filter((t) => t.status === 'done')) }));
  const D = vs.map((e, i) => {
    const c = { todo: 0, doing: 0, done: 0, blocked: 0 };
    for (const t of e.r.tasks) c[t.status]++;
    let mop = null;
    if (e.r.sec.FBS) { mop = { checked: 0, total: 0 }; for (const n of e.r.bySec.FBS) { mop.total += n.mops.length; mop.checked += n.mopChecked.filter(Boolean).length; } }
    return { i, label: names[i], c, total: e.r.tasks.length, mop };
  });
  // I: 隣り合う版の組ごとに、第 1 層の要素ごとの変更の件数(増えた・消えた・移動した・変わったタスク。1 つのタスクは 1 回だけ数える)
  const phases = [];
  for (const e of vs) for (const n of e.r.sec.WBS.root.children) if (!phases.includes(n.name)) phases.push(n.name);
  const pairs = [];
  for (let i = 0; i + 1 < vs.length; i++) {
    const c = compare(vs[i], vs[i + 1]);
    const cnt = new Map();
    const add = (ph) => cnt.set(ph, (cnt.get(ph) ?? 0) + 1);
    c._n.added.forEach((t) => add(phaseOf(t)));
    c._n.removed.forEach((t) => add(phaseOf(t)));
    for (const y of new Set([...c._n.moved.map((x) => x[1]), ...c._n.changed])) add(phaseOf(y));
    pairs.push({ i, from: names[i], to: names[i + 1], cnt, total: [...cnt.values()].reduce((a, b) => a + b, 0) });
  }
  // H: 担当者ごとの作成の日数。その版にいない担当者は null
  const people = [];
  for (const e of vs) for (const m of e.r.members) if (!people.includes(m.name)) people.push(m.name);
  const loads = vs.map((e) => P.peopleLoad(e.r));
  const H = people.map((name) => ({ name, vals: loads.map((l) => { const r = l.rows.find((x) => x.m.name === name); return r ? r.days : null; }) }));
  if (loads.some((l) => l.none)) H.push({ name: '(担当なし)', vals: loads.map((l) => (l.none ? l.none.days : 0)) });
  return { vs, names, A, E, D, I: { phases, pairs }, H };
}

// ---- 状態が初めて変わった版(5.11 節)
function firstChanges(list) {
  const lab = labels(list), vs = list.filter((e) => e.comparable);
  if (!vs.length) return [];
  const inv = [];
  for (let i = 0; i + 1 < vs.length; i++) inv.push(match(vs[i].r, vs[i + 1].r, 'WBS').inv);
  const lastV = vs[vs.length - 1];
  return lastV.r.tasks.map((t) => {
    const chain = [{ i: vs.length - 1, n: t }];
    for (let i = vs.length - 2; i >= 0; i--) {
      const a = inv[i].get(chain[0].n);
      if (!a || !isTask(a)) break;
      chain.unshift({ i, n: a });
    }
    const first = (st) => chain.find((x) => x.n.status === st);
    const fb = first('blocked'), fd = first('done');
    const period = !fd ? '―' : fd === chain[0] ? `〜 ${P.fmtDate(vs[fd.i].date)}` : `${P.fmtDate(vs[fd.i - 1].date)} 〜 ${P.fmtDate(vs[fd.i].date)}`;
    return [disp(t), fb ? lab.get(vs[fb.i]) : '―', fd ? lab.get(vs[fd.i]) : '―', period, P.STATUS[t.status]];
  });
}

// ---- 図の部品
const LM = 84, TOPM = 34, PLOT_H = 220, STEP = 92;
const fig = (w, h, body) => ({ kind: 'fig', w, h, body });
function niceTicks(lo, hi, want = 5, integer = false) {
  if (hi <= lo) hi = lo + 1;
  const raw = (hi - lo) / want, pw = 10 ** Math.floor(Math.log10(raw));
  let step = [1, 2, 5, 10].map((k) => k * pw).find((s) => s >= raw);
  if (integer) step = Math.max(1, Math.round(step));
  const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, out = [];
  for (let v = a; v <= b + step * 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}
const L = (x1, y1, x2, y2, o = {}) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${o.stroke ?? COL.line}" stroke-width="${o.w ?? 1}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`;
const poly = (pts, o = {}) => (pts.length > 1 ? `<polyline points="${pts.map((p) => `${p[0]},${p[1]}`).join(' ')}" fill="none" stroke="${o.stroke ?? COL.line}" stroke-width="${o.w ?? 1.6}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>` : '');
// 値が null のところで線を切る
const segments = (pts) => { const out = []; let cur = []; for (const p of pts) { if (p) cur.push(p); else { if (cur.length) out.push(cur); cur = []; } } if (cur.length) out.push(cur); return out; };
// 版の目盛りの文字(2 行: 日付と「版 (2)」)。押すとその版を選ぶ(5.12 節)
function verLabel(x, y, label, i) {
  const m = /^(\S+) (.*)$/.exec(label) ?? [null, label, ''];
  return `<g data-ver="${i}">${T_(x - textW(m[1], 11) / 2, y, m[1], { fs: 11 })}${T_(x - textW(m[2], 11) / 2, y + 14, m[2], { fs: 11 })}</g>`;
}
// 縦軸の目盛りと横の補助線
function yAxis(ticks, yOf, w, fmt) {
  return ticks.map((v) => `${L(LM, yOf(v), LM + w, yOf(v), { stroke: '#e4e4e0' })}${T_(LM - 6 - textW(fmt(v), 11), yOf(v) + 4, fmt(v), { fs: 11 })}`).join('') + L(LM, TOPM, LM, TOPM + PLOT_H) + L(LM, TOPM + PLOT_H, LM + w, TOPM + PLOT_H);
}
// 線の端の名前が重ならないよう、縦に少しずつずらす
function endLabels(items) {
  const s = items.slice().sort((a, b) => a.y - b.y);
  for (let k = 1; k < s.length; k++) if (s[k].y - s[k - 1].y < 13) s[k].y = s[k - 1].y + 13;
  return s.map((it) => T_(it.x + 6, it.y + 4, it.text, { fs: 11, fill: it.fill })).join('');
}
const legend = (x, items) => { let out = '', cx = x; for (const it of items) { out += it.mark(cx, 14) + T_(cx + 18, 18, it.text, { fs: 11 }); cx += 26 + textW(it.text, 11); } return { svg: out, w: cx - x }; };

// A. 終了日の推移
function chartA(rows) {
  const n = rows.length, w = Math.max(360, n * STEP), xs = (k) => LM + STEP / 2 + k * STEP;
  const vals = rows.flatMap((r) => [r.finish, r.end]).filter((v) => v !== null);
  if (!vals.length) return fig(400, 40, T_(0, 20, 'タスクがありません', { fs: 12 }));
  const ticks = niceTicks(Math.min(...vals) - 1, Math.max(...vals) + 1, 5, true);
  const lo = ticks[0], hi = ticks[ticks.length - 1], yOf = (v) => TOPM + PLOT_H - ((v - lo) / (hi - lo)) * PLOT_H;
  let b = yAxis(ticks, yOf, w, md);
  const ends = rows.map((r, k) => (r.end === null ? null : [xs(k), yOf(r.end)]));
  for (const sgm of segments(ends)) b += poly(sgm, { stroke: ACCENT, dash: '5 4', w: 1.3 });
  rows.forEach((r, k) => { if (r.end !== null) b += `<rect x="${xs(k) - 4}" y="${yOf(r.end) - 4}" width="8" height="8" fill="${ACCENT}"><title>${esc(`${r.label}: 期限 ${P.fmtDate(r.end)}`)}</title></rect>`; });
  const fin = rows.map((r, k) => (r.finish === null ? null : [xs(k), yOf(r.finish)]));
  for (const sgm of segments(fin)) b += poly(sgm);
  rows.forEach((r, k) => {
    if (r.finish !== null) b += `<g data-ver="${r.i}"><circle cx="${xs(k)}" cy="${yOf(r.finish)}" r="4" fill="${COL.line}"/><title>${esc(`${r.label}: 終了日 ${P.fmtDate(r.finish)}`)}</title></g>`;
    b += verLabel(xs(k), TOPM + PLOT_H + 16, r.label, r.i);
  });
  const lg = legend(LM, [
    { text: '終了日', mark: (x, y) => `${L(x, y, x + 14, y, { w: 1.6 })}<circle cx="${x + 7}" cy="${y}" r="3.5" fill="${COL.line}"/>` },
    { text: '期限(end:)', mark: (x, y) => `${L(x, y, x + 14, y, { stroke: ACCENT, dash: '4 3' })}<rect x="${x + 3}" y="${y - 4}" width="8" height="8" fill="${ACCENT}"/>` },
  ]);
  return fig(Math.max(LM + w + 20, LM + lg.w), TOPM + PLOT_H + 40, lg.svg + b);
}
// E. バーンアップ: 横軸は版の日付(暦日で等間隔)
function chartE(rows) {
  const d0 = rows[0].date, d1 = rows[rows.length - 1].date, span = Math.max(1, d1 - d0);
  const w = Math.max(360, Math.min(900, span * 24)), xOf = (d) => (d1 === d0 ? LM + w / 2 : LM + ((d - d0) / span) * w);
  const vmax = Math.max(1000, ...rows.map((r) => r.total)); // 日数は 1/1000 日の単位。目盛りは少なくとも 0〜1 日
  const ticks = niceTicks(0, vmax / 1000, 5), hi = ticks[ticks.length - 1], yOf = (v) => TOPM + PLOT_H - (v / 1000 / hi) * PLOT_H;
  let b = yAxis(ticks, (v) => TOPM + PLOT_H - (v / hi) * PLOT_H, w, (v) => String(v));
  const xt = d1 === d0 ? [d0] : niceTicks(d0, d1, 6, true).filter((d) => d >= d0 && d <= d1);
  for (const d of xt) b += T_(xOf(d) - textW(md(d), 11) / 2, TOPM + PLOT_H + 16, md(d), { fs: 11 }) + L(xOf(d), TOPM + PLOT_H, xOf(d), TOPM + PLOT_H + 4);
  const tot = rows.map((r) => [xOf(r.date), yOf(r.total)]), dn = rows.map((r) => [xOf(r.date), yOf(r.done)]);
  b += poly(tot) + poly(dn, { dash: '6 4' });
  rows.forEach((r) => { b += `<circle cx="${xOf(r.date)}" cy="${yOf(r.total)}" r="3.5" fill="${COL.line}"><title>${esc(`${r.label}: 全タスクの日数 ${P.fmtDays(r.total)}`)}</title></circle><circle cx="${xOf(r.date)}" cy="${yOf(r.done)}" r="3.5" fill="#fff" stroke="${COL.line}"><title>${esc(`${r.label}: 完了した日数 ${P.fmtDays(r.done)}`)}</title></circle>`; });
  const lx = xOf(rows[rows.length - 1].date);
  b += endLabels([{ x: lx, y: yOf(rows[rows.length - 1].total), text: '全タスクの日数' }, { x: lx, y: yOf(rows[rows.length - 1].done), text: '完了した日数' }]);
  b += T_(LM - 70, TOPM - 8, '(日)', { fs: 11, fill: COL.sub });
  return fig(LM + w + 130, TOPM + PLOT_H + 26, b);
}
// D. タスクの数とステータスの推移
function chartD(rows) {
  const n = rows.length, w = Math.max(360, n * STEP), xs = (k) => LM + STEP / 2 + k * STEP;
  const ticks = niceTicks(0, Math.max(1, ...rows.map((r) => r.total)), 5, true), hi = ticks[ticks.length - 1];
  const hOf = (c) => (c / hi) * PLOT_H;
  let b = yAxis(ticks, (v) => TOPM + PLOT_H - hOf(v), w, (v) => String(v));
  rows.forEach((r, k) => {
    let y = TOPM + PLOT_H;
    let g = '';
    for (const st of STACK) {
      const h = hOf(r.c[st]);
      if (!h) continue;
      y -= h;
      g += `<rect x="${xs(k) - 17}" y="${y}" width="34" height="${h}" fill="${STATUS_FILL[st]}" stroke="${COL.line}" stroke-width="1"><title>${esc(`${r.label}: ${P.STATUS[st]} ${r.c[st]} 件`)}</title></rect>`;
    }
    b += `<g data-ver="${r.i}">${g}</g>` + T_(xs(k) - textW(String(r.total), 11) / 2, y - 4, String(r.total), { fs: 11 });
    b += verLabel(xs(k), TOPM + PLOT_H + 16, r.label, r.i);
    if (r.mop) { const t = `MOP ${r.mop.checked}/${r.mop.total}`; b += T_(xs(k) - textW(t, 11) / 2, TOPM + PLOT_H + 46, t, { fs: 11, fill: COL.sub }); }
  });
  const lg = legend(LM, ['todo', 'doing', 'done', 'blocked'].map((st) => ({ text: P.STATUS[st], mark: (x, y) => `<rect x="${x}" y="${y - 6}" width="12" height="12" fill="${STATUS_FILL[st]}" stroke="${COL.line}"/>` })));
  const mopNote = rows.some((r) => r.mop) ? T_(LM, TOPM + PLOT_H + 64, '棒の上: タスク数。棒の下: チェック済みの MOP 数 / MOP 数。', { fs: 11, fill: COL.sub }) : '';
  return fig(Math.max(LM + w + 20, LM + lg.w), TOPM + PLOT_H + (mopNote ? 72 : 40), lg.svg + b + mopNote);
}
// I. 変更が多かった部分(行は WBS の第 1 層の要素、列は隣り合う版の組)
function chartI(I, cols) {
  const rowsN = [...I.phases, '合計'];
  // 左の欄は見出しと行の名前が収まる幅(上限 240 px。長い名前は先頭の側を縮める)。列の幅は版の名前が収まる幅
  const lw = Math.min(240, Math.max(60, textW('WBS の第 1 層', 12) + 8 /* 太字の分 */, ...rowsN.map((s) => textW(s, 12)))) + 16, hh = 40, rh = 24;
  const cw = Math.max(120, ...cols.flatMap((p) => [textW(`${p.from} →`, 11), textW(p.to, 11)])) + 16;
  const max = Math.max(1, ...cols.flatMap((p) => [...p.cnt.values()]));
  let b = '';
  cols.forEach((p, k) => {
    const x = lw + k * cw;
    b += `<g data-pair="${p.i}"><rect x="${x}" y="0" width="${cw}" height="${hh}" fill="${COL.head}" stroke="${COL.grid}"/>${T_(x + 6, 16, `${p.from} →`, { fs: 11 })}${T_(x + 6, 32, p.to, { fs: 11 })}</g>`;
  });
  b += `<rect x="0" y="0" width="${lw}" height="${hh}" fill="${COL.head}" stroke="${COL.grid}"/>${T_(6, 24, 'WBS の第 1 層', { fs: 12, weight: '600' })}`;
  rowsN.forEach((ph, j) => {
    const y = hh + j * rh, isSum = j === I.phases.length;
    b += `<rect x="0" y="${y}" width="${lw}" height="${rh}" fill="#fff" stroke="${COL.grid}"/>${T_(6, y + 16, clipName(ph, '', lw - 12), { fs: 12, weight: isSum ? '600' : null })}<title>${esc(ph)}</title>`;
    cols.forEach((p, k) => {
      const v = isSum ? p.total : p.cnt.get(ph) ?? 0;
      const g = isSum || !v ? 255 : Math.round(235 - (115 * v) / max);
      b += `<g data-pair="${p.i}"><rect x="${lw + k * cw}" y="${y}" width="${cw}" height="${rh}" fill="rgb(${g},${g},${g})" stroke="${COL.grid}"/>${T_(lw + k * cw + cw / 2 - textW(String(v), 12) / 2, y + 16, String(v), { fs: 12, weight: isSum ? '600' : null })}</g>`;
    });
  });
  return fig(lw + cols.length * cw, hh + rowsN.length * rh, b);
}
// H. 担当者ごとの作成の日数の推移
function chartH(H, names, a, b0) {
  const n = b0 - a, w = Math.max(360, n * STEP), xs = (k) => LM + STEP / 2 + k * STEP;
  const vmax = Math.max(1000, ...H.flatMap((p) => p.vals.slice(a, b0).filter((v) => v !== null))); // 少なくとも 0〜1 日
  const ticks = niceTicks(0, vmax / 1000, 5), hi = ticks[ticks.length - 1], yOf = (v) => TOPM + PLOT_H - (v / 1000 / hi) * PLOT_H;
  let b = yAxis(ticks, (v) => TOPM + PLOT_H - (v / hi) * PLOT_H, w, (v) => String(v));
  const ends = [];
  for (const p of H) {
    const pts = p.vals.slice(a, b0).map((v, k) => (v === null ? null : [xs(k), yOf(v)]));
    for (const sgm of segments(pts)) b += poly(sgm, { w: 1.3 });
    pts.forEach((pt, k) => { if (pt) b += `<g data-ver="${a + k}"><circle cx="${pt[0]}" cy="${pt[1]}" r="3" fill="${COL.line}"/><title>${esc(`${p.name}(${names[a + k]}): ${P.fmtDays(p.vals[a + k])} 日`)}</title></g>`; });
    const lastPt = [...pts].reverse().find(Boolean);
    if (lastPt) ends.push({ x: lastPt[0], y: lastPt[1], text: clipName(p.name, '', 160, 11) }); // 長い名前は先頭の側を縮める
  }
  b += endLabels(ends);
  for (let k = 0; k < n; k++) b += verLabel(xs(k), TOPM + PLOT_H + 16, names[a + k], a + k);
  b += T_(LM - 70, TOPM - 8, '(日)', { fs: 11, fill: COL.sub });
  const lw = Math.max(0, ...H.map((p) => textW(clipName(p.name, '', 160, 11), 11)));
  return fig(LM + w + 16 + lw, TOPM + PLOT_H + 40, b);
}

// ---- ガントチャート(5.10 節)と G(5.5 節)
function overlayData(a, b) {
  const c = compare(a, b);
  const rA = a.r, rB = b.r;
  const span = (r, t) => [r.sched.start + t.d0, r.sched.start + t.d1];
  // 棒を休みの日で切る(プロジェクト計画のガントチャートと同じ。全体の休みと、作成者の個人の休み)。続いている日は 1 本にする
  const segs = (r, t) => {
    const out = [], s0 = r.sched.start;
    for (let d = t.d0; d <= t.d1; d++) {
      if (r.isOff(s0 + d) || t.by.some((m) => r.memberOff(m, s0 + d))) continue;
      if (out.length && out[out.length - 1][1] === s0 + d - 1) out[out.length - 1][1] = s0 + d; else out.push([s0 + d, s0 + d]);
    }
    // 日数 0 のタスクは、先行が終わった時刻(t.s)の位置に細い棒(プロジェクト計画のひし形と同じ位置)。3 つ目の値が細い棒の印
    return t.days > 0 && out.length ? out : [[s0 + t.s / 1000, s0 + t.s / 1000, true]];
  };
  const rows = [
    ...c._n.pairs.map(([x, y]) => ({ key: disp(y), suffix: '', p: span(rA, x), n: span(rB, y), pS: segs(rA, x), nS: segs(rB, y), pd: x.days, nd: y.days })),
    ...c._n.added.map((t) => ({ t, key: disp(t), suffix: '(追加)', p: null, n: span(rB, t), pS: null, nS: segs(rB, t), pd: null, nd: t.days })),
  ];
  // 増えたタスクは後の版の木の順に混ぜる
  const order = new Map(rB.tasks.map((t, k) => [disp(t), k]));
  rows.sort((x, y) => order.get(x.key) - order.get(y.key));
  for (const t of c._n.removed) rows.push({ key: disp(t), suffix: '(削除)', p: span(rA, t), n: null, pS: segs(rA, t), nS: null, pd: t.days, nd: null });
  const addDays = sumDays(c._n.added), totalB = sumDays(rB.tasks);
  return {
    c, rows,
    endA: rA.sec.end ? rA.sec.end.date : null, endB: rB.sec.end ? rB.sec.end.date : null,
    est: c._n.pairs.map(([x, y]) => ({ key: disp(y), pd: x.days, nd: y.days })),
    unplanned: totalB ? Math.round((addDays / totalB) * 100) : null,
    removedDays: sumDays(c._n.removed),
    pairDays: [sumDays(c._n.pairs.map((x) => x[0])), sumDays(c._n.pairs.map((x) => x[1]))],
    people: peopleRows(rA, rB, span, segs),
    offA: (dn) => rA.isOff(dn), offB: (dn) => rB.isOff(dn),
  };
}
// J の行: 担当者ごとに、その人が作成者のタスク(複数人のタスクは全員の行)。変更後の members の順、変更後にいない人は最後。by のないタスクは「(担当なし)」
function peopleRows(rA, rB, span, segs) {
  const names = rB.members.map((m) => m.name);
  for (const m of rA.members) if (!names.includes(m.name)) names.push(m.name);
  const bars = (r, pick) => r.tasks.filter(pick).map((t) => ({ s: span(r, t), segs: segs(r, t), leaf: t.name, key: disp(t), days: t.days }));
  const rows = names.map((name) => {
    const by = (t) => t.by.some((m) => m.name === name);
    const inA = rA.members.some((m) => m.name === name), inB = rB.members.some((m) => m.name === name);
    return { name, inA, inB, p: bars(rA, by), n: bars(rB, by) };
  });
  const none = (t) => !t.by.length;
  if (rA.tasks.some(none) || rB.tasks.some(none)) rows.push({ name: '(担当なし)', inA: true, inB: true, p: bars(rA, none), n: bars(rB, none) });
  for (const r of rows) { r.pd = sumDays(r.p); r.nd = sumDays(r.n); }
  return rows;
}
// ガントチャートの休み(5.10 節): 変更後の版の全体の休みはプロジェクト計画と同じ灰の地、変更前の版だけの休みは斜線
const OFF_FILL = '#e6e6e2';
const OFF_HATCH = '<defs><pattern id="offA" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fff"/><path d="M0 0V6" stroke="#cfcfcb" stroke-width="2"/></pattern></defs>';
function offBg(o, dmin, dmax, xOf, DW, y0, y1) {
  let s = '';
  for (let d = dmin; d <= dmax; d++) {
    const b = o.offB(d), a = o.offA(d);
    if (b || a) s += `<rect x="${xOf(d)}" y="${y0}" width="${DW}" height="${y1 - y0}" fill="${b ? OFF_FILL : 'url(#offA)'}"/>`;
  }
  return s ? OFF_HATCH + s : '';
}
function offLegend(o, dmin, dmax) {
  const out = [];
  let b = false, a = false;
  for (let d = dmin; d <= dmax; d++) { if (o.offB(d)) b = true; else if (o.offA(d)) a = true; }
  if (b) out.push({ text: '全体の休み(変更後)', mark: (x, y) => `<rect x="${x}" y="${y - 6}" width="12" height="12" fill="${OFF_FILL}"/>` });
  if (a) out.push({ text: '変更前だけの休み', mark: (x, y) => `${OFF_HATCH}<rect x="${x}" y="${y - 6}" width="12" height="12" fill="url(#offA)" stroke="#cfcfcb"/>` });
  return out;
}
// 休みで切った棒(segs: [始めの日, 終わりの日] の並び。3 つ目の値が true なら、日数 0 のタスクの細い棒で、a はその時刻(日の単位))
// 細い棒は幅 2 で、時刻の位置を中心にする。thinAttr は細い棒の塗り(灰の棒の白い縁で見えなくならないように、縁を付けない指定を渡す)
// 変更前の細い棒は、灰の棒と見分けられるよう少し濃い灰にする
const THIN_PREV = '#8a8a86';
const segRects = (segs, xOf, DW, y, h, attr, thinAttr = attr) => segs.map(([a, b, thin]) => (thin
  ? `<rect x="${xOf(a) - 1}" y="${y}" width="2" height="${h}" ${thinAttr}/>`
  : `<rect x="${xOf(a)}" y="${y}" width="${Math.max(2, (b - a + 1) * DW)}" height="${h}" ${attr}/>`)).join('');
// F. ガントチャートの比較
function chartF(o, a, b0, lab) {
  if (!o.rows.length) return fig(300, 24, T_(0, 16, 'タスクがありません', { fs: 12 })); // J と同じ
  const rows = o.rows.slice(a, b0);
  const all = o.rows.flatMap((r) => [...(r.p ?? []), ...(r.n ?? [])]).concat([o.endA, o.endB].filter((v) => v !== null));
  const dmin = Math.min(...all), dmax = Math.max(...all), days = dmax - dmin + 1;
  const DW = Math.max(6, Math.min(22, 900 / days));
  const names = rows.map((r) => r.key + r.suffix);
  const lw = Math.min(380, Math.max(80, ...o.rows.map((r) => textW(r.key + r.suffix, 12))) + 12), top = 46, rh = 24;
  const xOf = (d) => lw + (d - dmin) * DW, W = lw + days * DW;
  let s = offBg(o, dmin, dmax, xOf, DW, top - 4, top + rows.length * rh);
  const every = Math.max(1, Math.ceil(44 / DW));
  for (let d = dmin; d <= dmax; d++) {
    if ((d - dmin) % every) continue;
    s += L(xOf(d), top - 4, xOf(d), top + rows.length * rh, { stroke: '#ececea' }) + T_(xOf(d) + 2, top - 8, md(d), { fs: 10 });
  }
  rows.forEach((r, k) => {
    const y = top + k * rh;
    const nm = clipName(r.key, r.suffix, lw - 10);
    s += L(0, y + rh, W, y + rh, { stroke: '#ececea' }) + T_(4, y + 16, nm, { fs: 12 }) + `<title>${esc(names[k])}</title>`;
    if (r.p) s += `<g><title>${esc(`変更前: ${P.fmtDate(r.p[0])} 〜 ${P.fmtDate(r.p[1])}`)}</title>${segRects(r.pS, xOf, DW, y + 4, 7, `fill="${PREV_FILL}"`, `fill="${THIN_PREV}"`)}</g>`;
    if (r.n) s += `<g><title>${esc(`変更後: ${P.fmtDate(r.n[0])} 〜 ${P.fmtDate(r.n[1])}`)}</title>${segRects(r.nS, xOf, DW, y + 13, 7, `fill="#fff" stroke="${COL.line}"`, `fill="${COL.line}"`)}</g>`;
  });
  const H = top + rows.length * rh;
  if (o.endA !== null) s += L(xOf(o.endA + 1), top - 4, xOf(o.endA + 1), H, { stroke: ACCENT, dash: '4 3', w: 1.3 });
  if (o.endB !== null) s += L(xOf(o.endB + 1), top - 4, xOf(o.endB + 1), H, { stroke: ACCENT, w: 1.3 });
  const lg = legend(0, [
    { text: `変更前(${lab[0]})`, mark: (x, y) => `<rect x="${x}" y="${y - 4}" width="14" height="7" fill="${PREV_FILL}"/>` },
    { text: `変更後(${lab[1]})`, mark: (x, y) => `<rect x="${x}" y="${y - 4}" width="14" height="7" fill="#fff" stroke="${COL.line}"/>` },
    { text: '期限(点線: 変更前、実線: 変更後)', mark: (x, y) => L(x, y, x + 14, y, { stroke: ACCENT, w: 1.3 }) },
    ...offLegend(o, dmin, dmax),
  ]);
  return fig(Math.max(W, lg.w), H + 4, lg.svg + s);
}
// J. 担当者別ガントチャートの比較: 担当者ごとの行を上下 2 段にし、上に変更前(灰)、下に変更後(黒枠)のタスクの棒
function chartJ(o, a, b0, lab) {
  const rows = o.people.slice(a, b0);
  const all = o.people.flatMap((r) => [...r.p, ...r.n].flatMap((x) => x.s)).concat([o.endA, o.endB].filter((v) => v !== null));
  if (!o.people.some((r) => r.p.length || r.n.length)) return fig(300, 24, T_(0, 16, 'タスクがありません', { fs: 12 })); // F と同じ
  const dmin = Math.min(...all), dmax = Math.max(...all), days = dmax - dmin + 1;
  const DW = Math.max(6, Math.min(22, 900 / days));
  const dayTxt = (r) => `${P.fmtDays(r.pd)} → ${P.fmtDays(r.nd)}`;
  const nw = Math.min(200, Math.max(60, ...o.people.map((r) => textW(r.name, 12)))) + 12; // 長い名前は先頭の側を縮める
  const dw = Math.max(textW('作成の日数', 11), ...o.people.map((r) => textW(dayTxt(r), 11))) + 12;
  const lw = nw + dw, top = 46, rh = 36, W = lw + days * DW;
  const xOf = (d) => lw + (d - dmin) * DW;
  let s = offBg(o, dmin, dmax, xOf, DW, top - 4, top + rows.length * rh) + T_(4, top - 8, '担当者', { fs: 11, fill: COL.sub }) + T_(nw + 4, top - 8, '作成の日数', { fs: 11, fill: COL.sub });
  const every = Math.max(1, Math.ceil(44 / DW));
  for (let d = dmin; d <= dmax; d++) {
    if ((d - dmin) % every) continue;
    s += L(xOf(d), top - 4, xOf(d), top + rows.length * rh, { stroke: '#ececea' }) + T_(xOf(d) + 2, top - 8, md(d), { fs: 10 });
  }
  const bar = (segs, y, h, fill, stroke, title, leaf) => {
    // 灰の棒には白い縁を付け、隣り合うタスクが 1 本に見えないようにする(プロジェクト計画の担当者別ガントチャートと同じ)。休みの日で切る
    let g = `<g><title>${esc(title)}</title>${segRects(segs, xOf, DW, y, h, `fill="${fill}" stroke="${stroke ? COL.line : '#fff'}"`, stroke ? `fill="${COL.line}"` : `fill="${THIN_PREV}"`)}`;
    // 名前は、いちばん長い切れ目に入るときだけ書く
    const [a, b] = segs.reduce((m, x) => (x[1] - x[0] > m[1] - m[0] ? x : m));
    if (!segs[0][2] && textW(leaf, 10) <= (b - a + 1) * DW - 4) g += T_(xOf(a) + 2, y + h - 2, leaf, { fs: 10 });
    return `${g}</g>`;
  };
  rows.forEach((r, k) => {
    const y = top + k * rh;
    s += L(0, y + rh, W, y + rh, { stroke: '#d8d8d4' }) + T_(4, y + 22, clipName(r.name, '', nw - 10), { fs: 12 }) + `<title>${esc(r.name)}</title>` + T_(nw + 4, y + 22, dayTxt(r), { fs: 11 });
    // 日数 0 のタスクの細い棒は、隣のタスクの棒に隠れないよう最後に描く
    const zeroLast = (xs) => [...xs].sort((u, v) => (u.days === 0) - (v.days === 0));
    for (const x of zeroLast(r.p)) s += bar(x.segs, y + 4, 13, PREV_FILL, false, `変更前: ${x.key} ${P.fmtDate(x.s[0])} 〜 ${P.fmtDate(x.s[1])}`, x.leaf);
    for (const x of zeroLast(r.n)) s += bar(x.segs, y + 19, 13, '#fff', true, `変更後: ${x.key} ${P.fmtDate(x.s[0])} 〜 ${P.fmtDate(x.s[1])}`, x.leaf);
  });
  const H = top + rows.length * rh;
  if (o.endA !== null) s += L(xOf(o.endA + 1), top - 4, xOf(o.endA + 1), H, { stroke: ACCENT, dash: '4 3', w: 1.3 });
  if (o.endB !== null) s += L(xOf(o.endB + 1), top - 4, xOf(o.endB + 1), H, { stroke: ACCENT, w: 1.3 });
  const lg = legend(0, [
    { text: `変更前(${lab[0]})`, mark: (x, y) => `<rect x="${x}" y="${y - 4}" width="14" height="7" fill="${PREV_FILL}"/>` },
    { text: `変更後(${lab[1]})`, mark: (x, y) => `<rect x="${x}" y="${y - 4}" width="14" height="7" fill="#fff" stroke="${COL.line}"/>` },
    { text: '期限(点線: 変更前、実線: 変更後)', mark: (x, y) => L(x, y, x + 14, y, { stroke: ACCENT, w: 1.3 }) },
    ...offLegend(o, dmin, dmax),
  ]);
  return fig(Math.max(W, lg.w), H + 4, lg.svg + s);
}
// G. 見積もりの変化
function chartG(o, a, b0) {
  const rows = o.est.slice(a, b0);
  if (!o.est.length) return fig(300, 24, T_(0, 16, '共通のタスクがありません', { fs: 12 }));
  const lw = Math.min(380, Math.max(80, ...o.est.map((r) => textW(r.key, 12))) + 12), rh = 26;
  const maxD = Math.max(1, ...o.est.flatMap((r) => [r.pd, r.nd]));
  const px = Math.min(40, 360 / (maxD / 1000));
  const bw = (d) => Math.max(1, (d / 1000) * px);
  // 上に凡例(灰 = 変更前、黒枠 = 変更後)。図だけを保存しても棒の意味がわかるように
  const top = 26;
  let s = legend(lw, [
    { text: '変更前', mark: (x, y) => `<rect x="${x}" y="${y - 4}" width="14" height="8" fill="${PREV_FILL}"/>` },
    { text: '変更後', mark: (x, y) => `<rect x="${x}" y="${y - 4}" width="14" height="8" fill="#fff" stroke="${COL.line}"/>` },
  ]).svg;
  rows.forEach((r, k) => {
    const y = top + k * rh, d = r.nd - r.pd;
    const nm = clipName(r.key, '', lw - 10);
    s += T_(4, y + 17, nm, { fs: 12 }) + `<title>${esc(r.key)}</title>`;
    s += `<rect x="${lw}" y="${y + 4}" width="${bw(r.pd)}" height="8" fill="${PREV_FILL}"><title>${esc(`変更前: ${P.fmtDays(r.pd)} 日`)}</title></rect>`;
    s += `<rect x="${lw}" y="${y + 13}" width="${bw(r.nd)}" height="8" fill="#fff" stroke="${COL.line}"><title>${esc(`変更後: ${P.fmtDays(r.nd)} 日`)}</title></rect>`;
    const t = `${P.fmtDays(r.pd)} → ${P.fmtDays(r.nd)}(${d > 0 ? `+${P.fmtDays(d)}` : d < 0 ? `-${P.fmtDays(-d)}` : '±0'})`;
    s += T_(lw + bw(Math.max(r.pd, r.nd)) + 6, y + 17, t, { fs: 11, weight: d ? '600' : null });
  });
  return fig(Math.max(lw + bw(maxD) + 150, lw + 140), top + rows.length * rh + 4, s);
}

// ---- ビューの部品(推移・日程・ガントチャート)。chart: 印刷で区切るための描き直しの関数と、区切る単位の数
function trendBlocks(list, blocks, tables) {
  const t = trendData(list);
  blocks.push(txt('推移', { fs: 15, weight: '600' }));
  if (!t.vs.length) return { message: '比較できる版がありません(エラーがなく version: のある .plan が必要です)' };
  const n = t.vs.length;
  // 図ごとに保存できるよう、図に題と識別子(ファイル名に使う)を付けておく(9.3 節・9.4 節)
  const add = (id, title, chart) => { blocks.push({ kind: 'gap', h: 6 }); const tb = txt(title, { fs: 13, weight: '600' }); tb.anchor = { kind: 'fig', id }; blocks.push(tb); const f = chart.draw(0, chart.n); f.chart = chart; f.fig = { id, title, pre: [tb] }; blocks.push(f); };
  add('end', '終了日の推移', { n, draw: (a, b) => chartA(t.A.slice(a, b)) });
  add('burnup', 'バーンアップ(横軸は版の日付)', { n: t.E.length, draw: (a, b) => chartE(t.E.slice(a, b)) });
  add('status', 'タスク数と進捗の推移', { n, draw: (a, b) => chartD(t.D.slice(a, b)) });
  if (t.I.pairs.length) add('changes', '変更の多い部分(WBS の第 1 層ごとのタスクの変更数)', { n: t.I.pairs.length, draw: (a, b) => chartI(t.I, t.I.pairs.slice(a, b)) });
  else { blocks.push({ kind: 'gap', h: 6 }); blocks.push(txt('変更の多い部分: 2 つ以上の版が必要です', { fs: 13 })); }
  add('effort', '担当者ごとの作成の日数', { n, draw: (a, b) => chartH(t.H, t.names, a, b) });
  blocks.push({ kind: 'gap', h: 10 });
  const fc = firstChanges(list);
  section(blocks, tables, 'タスクの進捗が初めて変わった版', ['タスク', '問題発生', '完了', '完了の時期', '計画の進捗'], fc);
  return {};
}
function overlayBlocks(pair, lab, blocks, tables) {
  const o = overlayData(pair[0], pair[1]);
  const names = [lab.get(pair[0]), lab.get(pair[1])];
  blocks.push({ kind: 'gap', h: 6 });
  const tF = txt('ガントチャートの比較', { fs: 15, weight: '600' });
  tF.anchor = { kind: 'fig', id: 'gantt' };
  blocks.push(tF);
  const fF = chartF(o, 0, o.rows.length, names); fF.chart = { n: o.rows.length, draw: (a, b) => chartF(o, a, b, names), rows: true };
  fF.fig = { id: 'gantt', title: 'ガントチャートの比較', pre: [txt(`比較: ${names[0]}(${pair[0].name}) → ${names[1]}(${pair[1].name})`, { fs: 13, weight: '600' }), tF] };
  blocks.push(fF);
  blocks.push({ kind: 'gap', h: 10 });
  const tJ = txt('担当者別ガントチャートの比較', { fs: 15, weight: '600' });
  tJ.anchor = { kind: 'fig', id: 'gantt-people' };
  blocks.push(tJ);
  const fJ = chartJ(o, 0, o.people.length, names); fJ.chart = { n: o.people.length, draw: (a, b) => chartJ(o, a, b, names), rows: true };
  fJ.fig = { id: 'gantt-people', title: '担当者別ガントチャートの比較', pre: [fF.fig.pre[0], tJ] };
  blocks.push(fJ);
}

// 日程のビューの見積もりの変化(5.5 節の後)
function estimateBlocks(pair, lab, blocks) {
  const o = overlayData(pair[0], pair[1]);
  const names = [lab.get(pair[0]), lab.get(pair[1])];
  const head = txt(`比較: ${names[0]}(${pair[0].name}) → ${names[1]}(${pair[1].name})`, { fs: 13, weight: '600' });
  blocks.push({ kind: 'gap', h: 10 });
  const tG = txt('見積もりの変化', { fs: 15, weight: '600' });
  tG.anchor = { kind: 'fig', id: 'estimate' };
  blocks.push(tG);
  const tN = txt(`追加したタスクの割合: ${o.unplanned === null ? '―' : `${o.unplanned}%`}(追加したタスクの日数 ÷ 変更後の総日数) / 削除したタスク: ${P.fmtDays(o.removedDays)} 日 / 共通のタスク: ${P.fmtDays(o.pairDays[0])} → ${P.fmtDays(o.pairDays[1])} 日`, { fs: 12 });
  blocks.push(tN);
  const fG = chartG(o, 0, o.est.length); fG.chart = { n: o.est.length, draw: (a, b) => chartG(o, a, b), rows: true, page: true };
  fG.fig = { id: 'estimate', title: '見積もりの変化', pre: [head, tG, tN] };
  blocks.push(fG);
}

// ---- 改訂履歴(5.13 節): すべての版の改訂の履歴。1 つの変更を 1 行にする
function revisionHistory(list) {
  const lab = labels(list), vs = list.filter((e) => e.comparable);
  const rows = [];
  const fd = (d) => (d === null ? '―' : P.fmtDate(d));
  vs.forEach((e, i) => {
    // 種類は「対象」と「操作」の 2 列にする(5.13 節)
    const push = (target, op, content) => rows.push({ cells: [lab.get(e), e.name, target, op, content], group: i, ver: i });
    if (i === 0) { push('―', '初版', `タスク ${e.r.tasks.length} 件、終了日 ${fd(e.r.sched.finishDate)}`); return; }
    const c = compare(vs[i - 1], e);
    const n0 = rows.length;
    c.tasks.added.forEach((r) => push('タスク', '追加', r[0]));
    c.tasks.removed.forEach((r) => push('タスク', '削除', r[0]));
    c.tasks.moved.forEach((x) => push('タスク', '移動', `${x.key}(親: ${x.from} → ${x.to})`));
    c.tasks.changed.forEach((x) => push('タスク', '変更', `${x.key}(${x.items.map((it) => `${it[0]} ${it[1]} → ${it[2]}`).join('、')})`));
    c.tasks.status.forEach((x) => push('タスクの進捗', '変更', `${x.key}(${x.from} → ${x.to})`));
    for (const [k, t] of [['FBS', c.fbs], ['PBS', c.pbs]]) {
      const withMop = (x) => (k === 'FBS' && x[1] !== 'なし' ? `${x[0]}(MOP: ${x[1]})` : x[0]);
      t.added.forEach((x) => push(`${k} の要素`, '追加', withMop(x)));
      t.removed.forEach((x) => push(`${k} の要素`, '削除', withMop(x)));
      t.moved.forEach((x) => push(`${k} の要素`, '移動', `${x.key}(親: ${x.from} → ${x.to})`));
    }
    for (const [op, arr] of [['追加', c.mop.added], ['削除', c.mop.removed], ['チェック', c.mop.checked], ['チェックの取り消し', c.mop.unchecked]]) arr.forEach((x) => push('MOP', op, `${x[0]}: ${x[1]}`));
    c.roots.forEach((x) => push(`${x.sec} の根の名前`, '変更', `${x.from} → ${x.to}`));
    // 開始日・期限・全体の休み(サマリーの表と同じ値で比べる)
    const pr = vs[i - 1].r;
    const startOf = (r) => P.fmtDate(r.sec.start.date), endOf = (r) => (r.sec.end ? P.fmtDate(r.sec.end.date) : 'なし'), offOf = (r) => offText(r) || 'なし';
    const same = (target, x, y) => (target === '全体の休み' ? offKey(x === 'なし' ? '' : x) === offKey(y === 'なし' ? '' : y) : x === y);
    for (const [target, f] of [['開始日', startOf], ['期限', endOf], ['全体の休み', offOf]]) if (!same(target, f(pr), f(e.r))) push(target, '変更', `${f(pr)} → ${f(e.r)}`);
    c.people.added.forEach((x) => push('メンバー', '追加', x));
    c.people.removed.forEach((x) => push('メンバー', '削除', x));
    c.people.off.forEach((x) => push('メンバーの休み', '変更', `${x.name}(${x.a} → ${x.b})`));
    const a = vs[i - 1].r.sched.finishDate, b = e.r.sched.finishDate;
    if (a !== b) push('終了日', '変更', `${fd(a)} → ${fd(b)}${a !== null && b !== null ? `(${b - a > 0 ? '+' : ''}${b - a})` : ''}`);
    if (rows.length === n0) push('―', '変更なし', '変更はありません');
  });
  const errs = list.filter((e) => e.nErr), nover = list.filter((e) => !e.nErr && e.date === null);
  return { rows, errs, nover };
}
function historyBlocks(list, blocks, tables) {
  const h = revisionHistory(list);
  const th = txt('改訂履歴', { fs: 15, weight: '600' });
  blocks.push(th);
  if (h.errs.length) blocks.push(txt(`エラーのため除外: ${h.errs.map((e) => e.name).join('、')}`, { fs: 13, fill: ACCENT, weight: '600' }));
  if (h.nover.length) blocks.push(txt(`version: がないため除外: ${h.nover.map((e) => e.name).join('、')}`, { fs: 13, fill: ACCENT, weight: '600' }));
  if (!h.rows.length) return { message: '比較できる版がありません(エラーがなく version: のある .plan が必要です)' };
  const tbl = { title: '改訂履歴', header: ['版', 'ファイル', '対象', '操作', '内容'], rows: h.rows, merge: 2, maxw: { 4: 560 } };
  th.anchor = { kind: 'table', ref: tbl };
  blocks.push({ kind: 'table', tbl });
  tables.push(tbl);
  return {};
}

const VIEWS = [
  // all: すべての版を示すビュー(比較する版の帯を出さない)
  { id: 'overview', label: 'サマリー', all: true },
  { id: 'history', label: '改訂履歴', all: true },
  { id: 'trend', label: '推移', all: true },
  { id: 'tasks', label: 'WBS' },
  { id: 'sched', label: '日程' },
  { id: 'fbs', label: 'FBS・PBS・MOP' },
  { id: 'people', label: 'メンバー' },
  { id: 'gantt', label: 'ガントチャート' },
];
// 比較の要約(仕様書 5.3 節)
function summaryBlocks(c, lab, blocks, tables) {
  blocks.push(txt(`比較: ${lab.get(c.a)}(${c.a.name}) → ${lab.get(c.b)}(${c.b.name})`, { fs: 13, weight: '600' }));
  for (const x of c.roots) blocks.push(txt(`${x.sec} の根の名前を変更: ${x.from} → ${x.to}`, { fs: 13 }));
  section(blocks, tables, '対応した要素', ['節', '対応数 / 要素数'], c.counts.map((x) => [x.sec, `${x.matched} / ${x.total}`]), { noCount: true });
}
// ビューを作る。戻り値 { blocks, tables, message }
// opt.work: 概要に置く作業の概要(仕様書 7.2 節。{ head, rows: [[項目, 値]] })。マイログがないときは置かない
function build(list, view, pair, opt = {}) {
  const blocks = [], tables = [];
  const lab = labels(list);
  if (view === 'overview') {
    const o = overview(list);
    const to = txt('サマリー', { fs: 15, weight: '600' });
    blocks.push(to);
    const noVer = '比較できる版がありません(エラーがなく version: のある .plan が必要です)';
    if (!o.cols.length && !opt.work) return { blocks, tables, message: noVer };
    if (!o.cols.length) blocks.push(txt(noVer, { fs: 13 }));
    else {
    const tbl = {
      title: 'サマリー', header: ['項目', ...o.cols.map((e) => lab.get(e))],
      // ファイル名は版ごとに違うのが普通なので、太字にしない
      rows: o.rows.slice(1).map((r) => ({ cells: [r.name, ...r.values.map((v, i) => (r.name !== 'ファイル' && i > 0 && (r.name === '全体の休み' ? offKey(v === '―' ? '' : v) !== offKey(r.values[i - 1] === '―' ? '' : r.values[i - 1]) : v !== r.values[i - 1]) ? { t: v, bold: true } : v))] })),
    };
    to.anchor = { kind: 'table', ref: tbl };
    blocks.push({ kind: 'table', tbl, overview: true });
    tables.push(tbl);
    blocks.push(txt('太字: 左の版から変わった値', { fs: 11, fill: COL.sub }));
    }
    if (opt.work) {
      const w0 = blocks.length;
      blocks.push({ kind: 'gap', h: 10 });
      blocks.push(txt(opt.work.head, { fs: 11, fill: COL.sub }));
      section(blocks, tables, '作業の概要', ['項目', '値'], opt.work.rows, { noCount: true });
      tables[tables.length - 1].maxw = { 1: 640 };
      for (const b of blocks.slice(w0)) b.work = true; // 列で区切って印刷するとき、作業の概要は最初のページだけに置く
    }
    return { blocks, tables };
  }
  if (view === 'trend') { const r = trendBlocks(list, blocks, tables); return { blocks, tables, message: r.message }; }
  if (view === 'history') { const r = historyBlocks(list, blocks, tables); return { blocks, tables, message: r.message }; }
  if (!pair) return { blocks, tables, message: '比較には 2 つ以上の版が必要です' };
  const c = compare(pair[0], pair[1]);
  summaryBlocks(c, lab, blocks, tables);
  if (view === 'tasks') {
    heading(blocks, 'WBS');
    section(blocks, tables, '追加したタスク', ['タスク', '日数', '作成者', '確認者'], c.tasks.added);
    section(blocks, tables, '削除したタスク', ['タスク', '日数', '作成者', '確認者'], c.tasks.removed);
    section(blocks, tables, '移動したタスク', ['タスク', '前の親', '後の親'], c.tasks.moved.map((x) => [x.key, x.from, x.to]));
    const rows = [];
    c.tasks.changed.forEach((x, i) => x.items.forEach((it) => rows.push({ cells: [x.key, ...it], group: i })));
    if (!rows.length) blocks.push(txt('変更したタスク: なし', { fs: 13 }));
    else {
      const tc = txt(`変更したタスク(${c.tasks.changed.length} 件)`, { fs: 13, weight: '600' });
      blocks.push(tc);
      const tbl = { title: '変更したタスク', header: ['タスク', '項目', '変更前', '変更後'], rows };
      tc.anchor = { kind: 'table', ref: tbl };
      blocks.push({ kind: 'table', tbl }); tables.push(tbl);
    }
    section(blocks, tables, '進捗が変わったタスク', ['タスク', '変更前', '変更後'], c.tasks.status.map((x) => [x.key, x.from, x.to]));
  } else if (view === 'sched') {
    heading(blocks, '日程(各版のテキストから計算した終了予定日)');
    const sg = (d) => (d > 0 ? `+${d}` : String(d));
    if (c.sched.worst.length) section(blocks, tables, '最も遅れたタスク', ['タスク', '差(日)'], c.sched.worst.map((s) => [s.key, sg(s.diff)]));
    else blocks.push(txt('遅れたタスクはありません', { fs: 13 }));
    section(blocks, tables, 'タスクごとの終了予定日', ['タスク', '変更前', '変更後', '差(日)'], c.sched.rows.map((s) => [s.key, s.a, s.b, sg(s.diff)]));
    estimateBlocks(pair, lab, blocks);
  } else if (view === 'fbs') {
    for (const [k, t] of [['FBS', c.fbs], ['PBS', c.pbs]]) {
      if (!t.show) continue;
      heading(blocks, k);
      // FBS は要素の行に MOP を含めて示す(仕様書 4.6 節)
      const cols = k === 'FBS' ? ['要素', 'MOP'] : ['要素'];
      const rowOf = (x) => (k === 'FBS' ? x : [x[0]]);
      section(blocks, tables, `${k}: 追加した要素`, cols, t.added.map(rowOf));
      section(blocks, tables, `${k}: 削除した要素`, cols, t.removed.map(rowOf));
      section(blocks, tables, `${k}: 移動した要素`, ['要素', '前の親', '後の親'], t.moved.map((x) => [x.key, x.from, x.to]));
    }
    if (c.mop.show) {
      heading(blocks, 'MOP');
      section(blocks, tables, '追加した MOP', ['FBS の要素', 'MOP'], c.mop.added);
      section(blocks, tables, '削除した MOP', ['FBS の要素', 'MOP'], c.mop.removed);
      section(blocks, tables, 'チェックした MOP', ['FBS の要素', 'MOP'], c.mop.checked);
      section(blocks, tables, 'チェックを取り消した MOP', ['FBS の要素', 'MOP'], c.mop.unchecked);
    }
    if (!c.fbs.show && !c.pbs.show) blocks.push(txt('どちらの版にも FBS・PBS がありません', { fs: 13 }));
  } else if (view === 'gantt') {
    overlayBlocks(pair, lab, blocks, tables);
  } else if (view === 'people') {
    heading(blocks, 'メンバー');
    section(blocks, tables, '追加したメンバー', ['メンバー'], c.people.added.map((x) => [x]));
    section(blocks, tables, '削除したメンバー', ['メンバー'], c.people.removed.map((x) => [x]));
    const sg = (d) => (d > 0 ? `+${P.fmtDays(d)}` : d < 0 ? `-${P.fmtDays(-d)}` : '0');
    section(blocks, tables, '作成の日数', ['担当者', '変更前', '変更後', '差'], c.people.rows.map((x) => [x.name, P.fmtDays(x.a), P.fmtDays(x.b), sg(x.b - x.a)]));
    section(blocks, tables, '休みを変更したメンバー', ['メンバー', '変更前', '変更後'], c.people.off.map((x) => [x.name, x.a, x.b]));
  }
  return { blocks, tables };
}
function render(list, view, pair, opt) {
  const v = build(list, view, pair, opt);
  if (v.message) v.blocks.push(txt(v.message, { fs: 13 }));
  // 図ごとの SVG(題を付けて 1 枚にする)。図のないビューでは空
  const figures = v.blocks.filter((b) => b.kind === 'fig' && b.fig).map((b) => ({ id: b.fig.id, title: b.fig.title, svg: compose([...b.fig.pre, b]) }));
  // 表ごとの SVG(題は入れない。報告書では題を表の上に書くため。仕様書 8.2 節)。並びは tables と同じ
  const tableSvgs = v.tables.map((t) => compose([v.blocks.find((b) => b.kind === 'table' && b.tbl === t)]));
  const raw = [];
  const svg = compose(v.blocks, raw);
  // 題の右のボタンの位置: 表はコピー・SVG・PNG、図は SVG・PNG
  const anchors = raw.map((a) => (a.kind === 'table' ? { kind: 'table', index: v.tables.indexOf(a.ref), label: a.label, x: a.x, y: a.y } : { kind: 'fig', id: a.id, label: a.label, x: a.x, y: a.y })).filter((a) => a.kind === 'fig' ? figures.some((f) => f.id === a.id) : a.index >= 0);
  return { svg, tables: v.tables, tableSvgs, figures, anchors };
}
// 表をタブ区切りの文字にする(仕様書 8.2 節)。まとめたセルは各行に書く
function tsv(tbl) {
  const c = (s) => cellT(s).replace(/[\t\r\n]+/g, ' ');
  return [tbl.header.map(c).join('\t'), ...tbl.rows.map((r) => r.cells.map(c).join('\t'))].join('\n') + '\n';
}

// ================= 印刷(仕様書 9.5 節) =================
const PRINT_W = 1047, PRINT_H = 718, PRINT_MIN = 0.5;
const svgSize = (svg) => { const m = /width="(\d+)" height="(\d+)"/.exec(svg); return [+m[1], +m[2]]; };
const scaleOf = (svg) => { const [w, h] = svgSize(svg); return Math.min(1, PRINT_W / w, PRINT_H / h); };
// 図を横軸の単位(版・版の組)で区切る。各ページは pre(図の題)と図
function splitCols(chart, pre) {
  const pages = [];
  let a = 0;
  while (a < chart.n) {
    let b = a + 1;
    while (b < chart.n && scaleOf(compose([...pre, chart.draw(a, b + 1)])) >= PRINT_MIN) b++;
    pages.push(compose([...pre, chart.draw(a, b)]));
    a = b;
  }
  return pages.length ? pages : [compose([...pre, chart.draw(0, 0)])];
}
// 図を行で区切る。最初のページは pre、続きのページは「題(続き)」を上に置く
function splitRows(chart, pre, title) {
  const full = compose([...pre, chart.draw(0, chart.n)]);
  if (scaleOf(full) >= PRINT_MIN || chart.n <= 1) return [full];
  const target = Math.max(PRINT_MIN, Math.min(1, PRINT_W / svgSize(full)[0])), maxH = PRINT_H / target;
  const pages = [];
  let a = 0;
  while (a < chart.n) {
    const head = a === 0 ? pre : [txt(`${title}(続き)`, { fs: 13, weight: '600' })];
    let lo = 1, hi = chart.n - a;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (svgSize(compose([...head, chart.draw(a, a + mid)]))[1] <= maxH) lo = mid; else hi = mid - 1; }
    pages.push(compose([...head, chart.draw(a, a + lo)]));
    a += lo;
  }
  return pages;
}
function printPages(list, view, pair, opt) {
  const v = build(list, view, pair, opt);
  if (v.message) v.blocks.push(txt(v.message, { fs: 13 }));
  const full = compose(v.blocks);
  // 推移: 図 1 つと、状態が初めて変わった版の表を、それぞれ別のページにする
  if (view === 'trend' && !v.message) {
    const pages = [], rest = [];
    for (let i = 0; i < v.blocks.length; i++) {
      const b = v.blocks[i], nx = v.blocks[i + 1];
      if (b.kind === 'gap') continue;
      if (b.kind === 'text' && nx && nx.kind === 'fig') { pages.push(...splitCols(nx.chart, [b])); i++; continue; }
      if (i === 0) continue; // ビューの題
      rest.push(b);
    }
    if (rest.length) pages.push(...paginate(rest));
    return pages;
  }
  // 日程: G の題より前は表と同じく区切り、G は別のページにして行で区切る(9.5 節)
  if (view === 'sched' && !v.message) {
    const iG = v.blocks.findIndex((b) => b.kind === 'fig');
    const tIdx = v.blocks.lastIndexOf(v.blocks[iG].fig.pre[1]);
    return [...paginate(v.blocks.slice(0, tIdx).filter((b, k, arr) => !(b.kind === 'gap' && k === arr.length - 1))), ...splitRows(v.blocks[iG].chart, [v.blocks[iG].fig.pre[0], ...v.blocks.slice(tIdx, iG).filter((b) => b.kind !== 'gap')], v.blocks[iG].fig.title)]; // G のページにも「比較: … → …」を置く(5.5 節)
  }
  if (view === 'gantt' && !v.message) {
    // 比較の要約は独立したページにし、図(F・J)は図と題と「比較: … → …」だけのページから始める(PDF から図だけを切り出しやすくするため。9.5 節)
    const figs = v.blocks.filter((b) => b.kind === 'fig');
    const tF = v.blocks.indexOf(figs[0].fig.pre[1]);
    const pages = paginate(v.blocks.slice(0, tF).filter((b, k, arr) => !(b.kind === 'gap' && k === arr.length - 1)));
    for (const b of figs) pages.push(...splitRows(b.chart, b.fig.pre, b.fig.title));
    return pages;
  }
  if (scaleOf(full) >= PRINT_MIN) return [full];
  // サマリー: 列(版)で区切る。各ページの左に行の見出しの列
  const ov = v.blocks.find((b) => b.overview);
  if (ov) {
    const t = ov.tbl, n = t.header.length - 1, pages = [];
    const sub = (a, b) => ({ ...t, header: [t.header[0], ...t.header.slice(1 + a, 1 + b)], rows: t.rows.map((r) => ({ cells: [r.cells[0], ...r.cells.slice(1 + a, 1 + b)] })) });
    const draw = (a, b) => compose(v.blocks.filter((x) => a === 0 || !x.work).map((x) => (x === ov ? { kind: 'table', tbl: sub(a, b) } : x)));
    let a = 0;
    while (a < n) { let b = a + 1; while (b < n && scaleOf(draw(a, b + 1)) >= PRINT_MIN) b++; pages.push(draw(a, b)); a = b; }
    return pages;
  }
  return paginate(v.blocks);
}
// 表: 行で区切り、続きのページには表の題と見出しの行を付ける。列の幅は全体と同じ
function paginate(blocks) {
  const full = compose(blocks);
  if (scaleOf(full) >= PRINT_MIN) return [full];
  const [fw] = svgSize(full);
  const target = Math.max(PRINT_MIN, Math.min(1, PRINT_W / fw));
  const limH = PRINT_H / target - 2 * M;
  const pages = [];
  let cur = [], h = 0;
  const flush = () => { if (cur.length) pages.push(compose(cur)); cur = []; h = 0; };
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind !== 'table') {
      const bh = b.kind === 'fig' ? b.h + 6 : blockH(b);
      // 表の題は、表の見出しと最初の行と一緒に置く
      const nx = blocks[i + 1];
      const need = nx && nx.kind === 'table' ? bh + tableH(nx.tbl, colWidths(nx.tbl), nx.tbl.rows.slice(0, 1)) + 6 : bh;
      if (h + need > limH && cur.length) flush();
      cur.push(b); h += bh;
      continue;
    }
    const ws = colWidths(b.tbl);
    const cont = () => { flush(); const t = txt(`${b.tbl.title}(続き)`, { fs: 13, weight: '600' }); cur.push(t); h = blockH(t); return true; };
    let rows = b.tbl.rows, fresh = false; // fresh: 続きの題だけを置いたページ
    while (rows.length) {
      let k = 0;
      while (k < rows.length && h + tableH(b.tbl, ws, rows.slice(0, k + 1)) + 6 <= limH) k++;
      if (k === 0) {
        // 空のページにも入らない行(1 行だけでページを超える行)は、区切らずに今のページに置く。
        // 前の行の後なら、今のページは直前に作った「(続き)」の題のページになる。題だけのページは作らない(9.5 節)
        const tooTall = tableH(b.tbl, ws, rows.slice(0, 1)) + 6 + blockH(txt('続き', { fs: 13 })) > limH;
        if (!tooTall && !fresh && cur.length) { fresh = cont(); continue; }
        k = 1;
      }
      cur.push({ kind: 'table', tbl: b.tbl, ws, rows: rows.slice(0, k) });
      h += tableH(b.tbl, ws, rows.slice(0, k)) + 6;
      rows = rows.slice(k);
      fresh = false;
      if (rows.length) fresh = cont();
    }
  }
  flush();
  return pages;
}

// ================= plans とプロジェクト計画の SVG の読み込み(仕様書 3.1 節・9.1 節) =================
const FORMAT = 'projalysis-plans';
const toPlans = (list) => `${JSON.stringify({ format: FORMAT, files: list.map((e) => ({ name: e.name, text: e.text })) }, null, 2)}\n`;
// 戻り値 { ok, files: [{ name, text }] } か { ok: false, error }
function fromPlans(text) {
  let d;
  try { d = JSON.parse(norm(text)); } catch { return { ok: false, error: 'plans として読めません(JSON の形ではありません)' }; }
  if (!d || typeof d !== 'object' || d.format !== FORMAT || !Array.isArray(d.files) || !d.files.every((f) => f && typeof f.name === 'string' && typeof f.text === 'string')) return { ok: false, error: 'plans として読めません(形が違います)' };
  return { ok: true, files: d.files.map((f) => ({ name: f.name, text: f.text })) };
}
// SVG から読む。読めるのはプロジェクト計画の版 0.30 までの SVG(.plan 1 つを埋め込んだもの)だけ。戻り値 { ok, files } か { ok: false, error }
// プロジェクト分析の保存する SVG には何も埋め込まない(正本は plans だけにする。仕様書 9.3 節)
function extract(svgText, name) {
  const x = P.extractSource(svgText);
  if (x.ok) return { ok: true, files: [{ name: `${name.replace(/\.svg$/i, '')}.plan`, text: x.text }] };
  return { ok: false, error: 'この SVG には .plan が埋め込まれていません(開ける .svg は、プロジェクト計画の版 0.30 までに「画像…」で保存したものだけです)' };
}

return { load, sortList, addEntries, moveEntry, canMove, labels, match, compare, overview, revisionHistory, trendData, firstChanges, overlayData, build, render, tsv, printPages, toPlans, fromPlans, extract, VIEWS, qn };
})();
if (typeof module !== 'undefined') module.exports = Projalysis;
/*DIFF-END*/
