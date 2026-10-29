// プロジェクト分析の作業分析の処理(plans の読み書き・突き合わせ・集計・作業の概要・表の組み立て)。DOM を使わない。Node でも require('./dev/team.js') で読める
/*TEAM-BEGIN*/
const Team = (() => {
'use strict';
const Lg = typeof Log !== 'undefined' ? Log : require('./logcore.js');
const P = typeof Plan !== 'undefined' ? Plan : require('./core.js');
const { fmtDate, parseDate, mmdd, weekOf, fmtH, WD, STATUS, COL, T_, textW, keyOf, labelOfNode, lastOf, groupByKey, allRecs, cmp, memberNames, stCell, keyOrder, dispKey, weeksOf, taskInfo, catOf, CATS, index, KIND_JA, SIG_NAME, TH_DEFAULT, labels } = Lg;

// 例(仕様書 付録 A。8.4 節)は 2026-04-30 を今日とみなして作ってある
const EXAMPLE_TODAY = '2026-04-30';
// 例の日付のずらし方(仕様書 8.4 節)は、マイログの計算部の Log.shiftExample を使う(week: の曜日も同じ日数だけずらす)
const norm = (t) => String(t).replace(/^﻿/, '').replace(/\r\n?/g, '\n');

// ================= 9.1 節 plans =================
// 計画書の一覧(files)とマイログの一覧(logs)。マイログの一覧が空なら logs を書かない(計画書だけの plans と同じファイルになる)。
// キーの順と字下げ(空白 2 個)を固定し、同じ一覧からは同じファイルを書く
const FORMAT = 'projalysis-plans';
function toPlans(plans, logs) {
  const f = (x) => ({ name: x.name, text: x.text });
  const o = { format: FORMAT, files: plans.map(f) };
  if (logs.length) o.logs = logs.map(f);
  return `${JSON.stringify(o, null, 2)}\n`;
}
function fromPlans(text) {
  let d;
  try { d = JSON.parse(norm(text)); } catch { return { ok: false, error: 'plans として読めません(JSON の形ではありません)' }; }
  const okList = (a) => Array.isArray(a) && a.every((x) => x && typeof x.name === 'string' && typeof x.text === 'string');
  if (!d || typeof d !== 'object' || d.format !== FORMAT || !okList(d.files) || (d.logs !== undefined && !okList(d.logs))) return { ok: false, error: 'plans として読めません(形が違います)' };
  return { ok: true, plans: d.files.map((x) => ({ name: x.name, text: x.text })), logs: (d.logs || []).map((x) => ({ name: x.name, text: x.text })) };
}
// 計画書の版を読む(マイログの計算部の loadPlan。計画書分析の処理が使う comparable も付ける。比べられる版 = 照合に使える版。3.6 節)
function loadPlan(name, text) { const e = Lg.loadPlan(name, text); e.comparable = e.usable; return e; }

// ================= 3.7 節 マイログの一覧 =================
// 1 つのマイログを、計画の一覧と照合して読む
function loadLog(name, text0, plans, today) {
  const text = norm(text0);
  const a = Lg.analyze(text, plans, { today, team: true });
  const er = a.diags.filter((d) => d.level === 'error'), wr = a.diags.filter((d) => d.level === 'warn');
  const p = Lg.parse(text);
  const days = p.days.map((d) => d.date);
  return { name, text, a, by: p.set.by ? p.set.by.value : null, version: p.set.version ? p.set.version.value : null, lastDate: days.length ? Math.max(...days) : null, nErr: er.length, nWarn: wr.length, firstErr: er.length ? er.reduce((x, y) => (y.line < x.line ? y : x)) : null, diags: a.diags };
}
// 足すときの扱い: 同じテキストなら dup、同じ by: なら conflict(一覧の位置)、ほかは new
function classifyLog(list, name, text0) {
  const text = norm(text0);
  const same = list.find((x) => x.text === text);
  if (same) return { kind: 'dup', with: same.name };
  const by = Lg.byName(text);
  const i = by === null ? -1 : list.findIndex((x) => x.by === by);
  return i >= 0 ? { kind: 'conflict', index: i, by } : { kind: 'new' };
}
const moveLog = (list, i, dir) => { const j = i + dir; if (j < 0 || j >= list.length) return null; const x = list.slice(); [x[i], x[j]] = [x[j], x[i]]; return x; };

// ================= 集計のもと(5 章・6 章・7 章・8 章) =================
// plans: 計画の一覧(Log.loadPlan の並び)。list: マイログの一覧(loadLog の並び)。opt: { today, th }
function model(plans, list, opt) {
  const today = opt.today, th = { ...TH_DEFAULT, ...(opt.th || {}) };
  const V = plans.filter((e) => e.usable);
  // 兆候・集計・反映候補に使う版(6.2 節): 基準日以前の日付の版のうち、一覧でいちばん後ろの版。基準日以前の版がなければ一覧でいちばん前の版(マイログの仕様書 5.4 節と同じ)
  const L = V.length ? Lg.versionFor(V, today) : null;
  const use = list.map((x, i) => [x, i]).filter(([x]) => x.a.ok);
  // 記録先を基準日の版の要素に寄せる(マイログの仕様書 5.6 節。移動はたどり、名前の変更はたどらない)
  for (const [x] of use) Lg.remap(x.a.recs, V, L);
  const logs = use.map(([x, i]) => ({ who: x.a.who, recs: x.a.recs, li: i, days: x.a.days }));
  const notes = [];
  // 同じ人のマイログが 2 つ(3.7 節)、エラーのため除外(3.7 節)
  const byCount = new Map();
  for (const x of list) if (x.by) byCount.set(x.by, (byCount.get(x.by) || 0) + 1);
  for (const [b, n] of byCount) if (n > 1) notes.push(`同じ人(${b})のマイログが ${n} つあります`);
  for (const x of list) if (!x.a.ok) notes.push(`エラーのため集計から除外: ${x.name}`);
  // メンバー(6.1 節): 最新の版の members: の順、続いて members: にいない by: を一覧の順
  const members = L ? [...index(L).members] : [];
  for (const l of logs) if (!members.includes(l.who)) members.push(l.who);
  // 集計に使うマイログの並びはメンバーの順(同じ日付の中の行の並びや、記録者の並びが、マイログの一覧の順によらないように。6.6 節)
  logs.sort((x, y) => members.indexOf(x.who) - members.indexOf(y.who) || x.li - y.li);
  // 週の始まり(6.6 節): マイログの week: がすべて同じならその曜日、違えば月曜
  const wk = logs.map((l) => [l.who, list[l.li].a.set.week ? list[l.li].a.set.week.value : 'mon']); // メンバーの順
  const kinds = [...new Set(wk.map((x) => x[1]))];
  let ws = WD.indexOf('mon');
  if (kinds.length === 1) ws = WD.indexOf(kinds[0]);
  else if (kinds.length > 1) notes.push(`マイログの week: がそろっていません(${wk.map(([w, d]) => `${w}: ${d}`).join('、')})。月曜から区切ります`);
  // マイログがあるのにエラーで集計から外した人は「マイログがありません」とせず、エラーのためと知らせる(3.7 節)
  const okBy = new Set(logs.map((l) => l.who));
  const errLog = [...new Set(list.filter((x) => !x.a.ok && x.by && !okBy.has(x.by)).map((x) => x.by))];
  const hasLog = [...okBy, ...errLog];
  const noLog = members.filter((m) => !hasLog.includes(m));
  // 基準日より後の記録は数えない(6.6 節)
  const recs = allRecs(logs, today);
  const byKey = groupByKey(recs);
  const reqs = Lg.requests(logs, today, true);
  const sig = Lg.signals(logs, { L, today, th, ws, members, noLog, hasLog, errLog, requests: reqs });
  // 最新の版のタスク(WBS の木の順)と、その今の様子(6.9 節)
  const tasks = [];
  if (L) { const set = new Set(L.r.tasks); for (const n of L.r.bySec.WBS || []) if (set.has(n)) { const x = taskInfo(L, byKey, today, n, null); x.cat = catOf(x, today); tasks.push(x); } }
  return { L, V, plans, list, logs, today, th, ws, notes, members, hasLog, noLog, errLog, recs, byKey, reqs, sig, tasks };
}
// 表の行を押したときの行き先(8.1 節): マイログの一覧での位置と行
const refOf = (M, r) => (r ? { key: `${M.logs[r.fi].li}:${r.line}`, file: M.logs[r.fi].li, line: r.line } : null);
const numOf = (M, key) => { const n = M.L ? index(M.L).byKey.get(key) : null; return n && n.sec === 'WBS' ? n.num : '―'; };
const taskLabel = (x) => `${x.t.num} ${x.label}`;
const catText = (x, today) => (x.cat === 'late' ? `遅延(${today - x.e} 日)` : CATS.find((c) => c.id === x.cat).short);
const span = (x) => (x.s === x.e ? mmdd(x.s) : `${mmdd(x.s)}〜${mmdd(x.e)}`);
const statusCell = (x) => (x.st ? (x.rvw ? { ...stCell(x.st.val.status), t: `${STATUS[x.st.val.status]}(確認待ち)` } : stCell(x.st.val.status)) : '―');

// ---- 週のまとめの週(6.14 節): 最初の記録の週から基準日の週まで(新しい順)。日付の行だけの日(メモだけの日)も記録に数える
function weekOptions(M) {
  const ds = [...M.recs.map((r) => r.date), ...M.logs.flatMap((l) => l.days.map((d) => d.date)).filter((d) => d <= M.today)];
  const out = [];
  for (let w = weekOf(M.today, M.ws), w0 = weekOf(Math.min(M.today, ...ds), M.ws); w >= w0 && out.length < 520; w -= 7) out.push(w);
  return out;
}

// ---- 折れ線の図(6.7 節・6.10 節): 線はすべて黒、右端に名前
function lineChart(xLabels, series, unit) {
  const STEP = 56, LM = 44, TOP = 24, H = 160, n = xLabels.length;
  const vals = series.flatMap((s) => s.vals.filter((v) => v !== null));
  const max = Math.max(1, ...vals);
  const raw = max / 4, p = 10 ** Math.floor(Math.log10(raw)), k = raw / p;
  const step = (k <= 1 ? 1 : k <= 2 ? 2 : k <= 5 ? 5 : 10) * p;
  const top = Math.ceil(max / step) * step;
  const X = (i) => LM + 20 + i * STEP, Y = (v) => TOP + H - v / top * H;
  const right = X(Math.max(0, n - 1)) + 34; // 最後の目盛りの文字と名前が重ならないよう、右に空ける
  const out = [T_(LM - 6, 12, `(${unit})`, { fs: 11, anchor: 'end', fill: COL.sub })];
  for (let v = 0; v <= top + 1e-9; v += step) out.push(`<path d="M${LM} ${Y(v)}H${right}" stroke="${COL.grid}"/>`, T_(LM - 6, Y(v) + 4, String(+v.toFixed(2)), { fs: 11, anchor: 'end', fill: COL.sub }));
  xLabels.forEach((l, i) => out.push(T_(X(i), TOP + H + 16, l, { fs: 11, anchor: 'middle' })));
  const ends = [];
  for (const s of series) {
    let path = '', prev = false, lastPt = null;
    s.vals.forEach((v, i) => {
      if (v === null) { prev = false; return; }
      path += `${prev ? 'L' : 'M'}${X(i)} ${Y(v)}`;
      out.push(`<circle cx="${X(i)}" cy="${Y(v)}" r="2.5" fill="${COL.line}"/>`);
      prev = true; lastPt = [X(i), Y(v)];
    });
    if (path) out.push(`<path d="${path}" fill="none" stroke="${COL.line}" stroke-width="1.5"/>`);
    if (lastPt) ends.push({ name: s.name, x: lastPt[0], y: lastPt[1] });
  }
  // 名前が重ならないよう、上から順に 13px ずつ離す
  ends.sort((a, b) => a.y - b.y || a.name.localeCompare(b.name));
  let lastY = -Infinity, wmax = 0;
  for (const e of ends) { const y = Math.max(e.y + 4, lastY + 13); lastY = y; out.push(T_(right + 6, y, e.name, { fs: 11 })); wmax = Math.max(wmax, textW(e.name, 11)); }
  out.push(`<path d="M${LM} ${TOP + H}H${right}" stroke="${COL.line}"/>`);
  return { frag: out.join(''), w: right + 12 + wmax, h: Math.max(TOP + H + 30, lastY + 6) };
}

// ================= ビュー(8.1 節。作業分析のまとまり) =================
const VIEWS = [
  { id: 'reflect', label: '計画への反映候補' },
  { id: 'alerts', label: '要確認' },
  { id: 'week', label: '週のまとめ' },
  { id: 'requests', label: '依頼' },
  { id: 'load', label: '負荷' },
  { id: 'progress', label: '進捗' },
  { id: 'impact', label: '影響を受けるタスク' },
  { id: 'hoursPeople', label: '作業時間(人)' },
  { id: 'hoursTasks', label: '作業時間(タスク)' },
  { id: 'trl', label: 'TRL・TPM' },
  { id: 'tests', label: 'テストの記録' },
  { id: 'mop', label: 'MOP の達成状況' },
];
const noPlanText = '計画書を読み込むと、この表が出ます(「ファイルを追加」で .plan を読み込みます)';

function blocks(M, view, ctx = {}) {
  const { L, today, recs, byKey } = M;
  const B = [];
  const none = (t = 'なし') => B.push({ t: 'p', text: t, fill: COL.text });
  const td = fmtDate(today);
  B.push({ t: 'p', text: `基準日 ${td}。基準日の版: ${L ? `${labels(M.plans).get(L)}(${L.name})` : 'なし'}。マイログ: ${M.logs.length ? [...new Set(M.logs.map((l) => l.who))].join('、') : 'なし'}。基準日より後の記録は数えません。` });
  const weeks = recs.length ? weeksOf(recs, M.ws, today) : [];
  const wLabel = (w) => `${mmdd(w)}〜`;

  if (view === 'alerts') {
    for (const n of M.notes) B.push({ t: 'p', text: n, fill: COL.accent });
    const t = M.th;
    B.push({ t: 'h2', label: `要確認(${td})` });
    B.push({ t: 'p', text: `規則の値: S1 ${t.S1} 日、S2 ${t.S2} 日、S3 ${t.S3} 日、S5 ${t.S5} 日、S7 ${t.S7} %、S8 ${t.S8} 日。${L ? '' : '計画書を読み込むと判定する兆候: S1・S4・S5・S7・S9'}` });
    if (M.sig.length) B.push({ t: 'table', name: `要確認(${td})`, caption: `基準日 ${td}。規則の値: S1 ${t.S1} 日、S2 ${t.S2} 日、S3 ${t.S3} 日、S5 ${t.S5} 日、S7 ${t.S7} %、S8 ${t.S8} 日。`, cols: [{ h: '兆候', max: 240 }, { h: '人', max: 140 }, { h: '記録先', max: 220 }, { h: '内容', max: 360 }, { h: '日付' }], rows: M.sig.map((x) => ({ cells: [`${x.code} ${SIG_NAME[x.code]}`, x.who, x.label, x.text, x.date === null ? '―' : fmtDate(x.date)], ref: x.rec ? refOf(M, x.rec) : null })) });
    else none('兆候はありません');
    return B;
  }

  if (view === 'requests') {
    B.push({ t: 'h2', label: '受けた依頼' });
    const rows = M.members.map((m) => {
      const q = M.reqs.filter((x) => x.to === m);
      const open = q.filter((x) => !x.reply);
      const ng = recs.filter((r) => r.who === m && r.val.reviewed === 'ng').length;
      return { cells: [m, String(q.length), String(q.length - open.length), String(open.length), open.length ? `${Math.max(...open.map((x) => today - x.date))}` : '―', String(ng)] };
    });
    if (rows.length) B.push({ t: 'table', name: '受けた依頼', cols: [{ h: '人' }, { h: '受けた依頼', right: true }, { h: '対応済み', right: true }, { h: '未対応', right: true }, { h: '最長の返事待ち(日)', right: true }, { h: '差し戻し', right: true }], rows }); else none();
    B.push({ t: 'h2', label: '依頼の一覧' });
    if (M.reqs.length) B.push({ t: 'table', name: '依頼の一覧', cols: [{ h: '日付' }, { h: '依頼した人' }, { h: '相手' }, { h: '種類' }, { h: '記録先', max: 240 }, { h: '返事の日' }, { h: '結果', max: 200 }, { h: '状態', max: 220 }], rows: M.reqs.map((q) => ({ cells: [fmtDate(q.date), q.from, q.to, KIND_JA[q.kind], q.label, q.reply ? fmtDate(q.reply.date) : '―', q.reply ? (q.kind === 'review' ? q.reply.val.reviewed : q.reply.val.answered) : '―', q.reply ? '対応済み' : `未対応(${today - q.date} 日)${M.errLog.includes(q.to) ? '。相手のマイログにエラーがあり、集計から外しています' : M.hasLog.includes(q.to) ? '' : '。相手のマイログがありません'}`], ref: refOf(M, q.rec) })) }); else none();
    return B;
  }

  if (view === 'progress') {
    B.push({ t: 'h2', label: `進捗(${td})` });
    if (!L) { B.push({ t: 'p', text: noPlanText, fill: COL.accent }); return B; }
    const rows = M.tasks.map((x) => {
      const rep = [x.st, x.pg].filter(Boolean).sort(cmp).pop() || null;
      return { cells: [x.t.num, x.label, memberNames(x.t.by).join('・') || '(担当なし)', span(x), x.begun === null ? '―' : mmdd(x.begun), x.status === 'done' && x.st ? mmdd(x.st.date) : '―', catText(x, today), statusCell(x), x.pg ? `${x.pg.val.progress} %` : '―', rep ? fmtDate(rep.date) : '―', rep ? rep.who : '―', STATUS[x.t.status ?? 'todo']], ref: rep ? refOf(M, rep) : null };
    });
    if (rows.length) B.push({ t: 'table', name: `進捗(${td})`, cols: [{ h: 'WBS 番号' }, { h: 'タスク', max: 260 }, { h: '作成者(計画)', max: 120 }, { h: '予定の期間' }, { h: '始めた日' }, { h: '完了した日' }, { h: '区分', max: 170 }, { h: '最後の進捗' }, { h: '最後の進捗率', right: true }, { h: '報告日' }, { h: '記録者' }, { h: '計画の進捗' }], rows }); else none('計画にタスクがありません');
    return B;
  }

  if (view === 'load') {
    B.push({ t: 'h2', label: `メンバーごとの負荷(${td})` });
    if (!L) B.push({ t: 'p', text: noPlanText, fill: COL.accent });
    const w0 = weekOf(today, M.ws);
    const sumW = (m, w) => recs.filter((r) => r.who === m && r.val.hours && weekOf(r.date, M.ws) === w).reduce((s, r) => s + r.val.hours, 0);
    const rows = M.members.map((m) => {
      const open = M.tasks.filter((x) => memberNames(x.t.by).includes(m) && x.cat !== 'done');
      return { cells: [m, String(open.length), P.fmtDays(open.reduce((s, x) => s + x.t.days, 0)), String(open.filter((x) => x.cat === 'late').length), String(open.filter((x) => x.cat === 'blocked').length), fmtH(sumW(m, w0 - 7)), fmtH(sumW(m, w0))] };
    });
    B.push({ t: 'p', text: `今週は ${mmdd(w0)}〜${mmdd(w0 + 6)}、先週は ${mmdd(w0 - 7)}〜${mmdd(w0 - 1)}。作成者が 2 人以上のタスクは、それぞれに全部の日数を数えます。` });
    if (rows.length) B.push({ t: 'table', name: `メンバーごとの負荷(${td})`, cols: [{ h: 'メンバー' }, { h: '未完了のタスク', right: true }, { h: '計画の日数', right: true }, { h: '遅延', right: true }, { h: '問題発生', right: true }, { h: '先週の時間', right: true }, { h: '今週の時間', right: true }], rows }); else none();
    return B;
  }

  if (view === 'impact') {
    B.push({ t: 'h2', label: `影響を受けるタスク(${td})` });
    if (!L) { B.push({ t: 'p', text: noPlanText, fill: COL.accent }); return B; }
    const info = new Map(M.tasks.map((x) => [x.t, x]));
    const delayed = M.tasks.filter((x) => ['late', 'blocked', 'overstart'].includes(x.cat));
    if (!delayed.length) { none('遅れているタスクはありません'); return B; }
    B.push({ t: 'p', text: '遅延・問題発生・開始予定日を過ぎた未着手のタスクの後ろに、計画の after: でつながるタスク(完了したものは除き、その先はたどる)。計画の日程は変えません。' });
    const rows = [];
    for (const d of delayed) {
      // 後続を幅優先でたどる。完了したタスクは入れないが、その先はたどる(完了したタスクの後ろの、完了していないタスクにも遅れは及ぶ)
      const depth = new Map(), seen = new Set([d.t]), queue = [[d.t, 0]];
      while (queue.length) {
        const [t, k] = queue.shift();
        for (const s of t.succ || []) {
          const x = info.get(s);
          if (!x || seen.has(s)) continue;
          seen.add(s);
          if (x.cat !== 'done') depth.set(s, k + 1);
          queue.push([s, k + 1]);
        }
      }
      const head = [taskLabel(d), catText(d, today)];
      const list = [...depth.keys()].map((s) => info.get(s)).sort((a, b) => a.s - b.s || M.tasks.indexOf(a) - M.tasks.indexOf(b));
      if (!list.length) rows.push({ cells: [...head, '影響を受けるタスクはありません', '', '', '', ''] });
      for (const x of list) rows.push({ cells: [...head, taskLabel(x), depth.get(x.t) === 1 ? '直接' : '間接', memberNames(x.t.by).join('・') || '(担当なし)', mmdd(x.s), catText(x, today)] });
    }
    B.push({ t: 'table', name: `影響を受けるタスク(${td})`, cols: [{ h: '遅れているタスク', max: 240 }, { h: '遅れているタスクの区分', max: 150 }, { h: '影響を受けるタスク', max: 240 }, { h: 'つながり' }, { h: 'その作成者', max: 120 }, { h: 'その開始予定日' }, { h: '影響を受けるタスクの区分', max: 150 }], rows });
    return B;
  }

  if (view === 'hoursPeople') {
    B.push({ t: 'h2', label: `作業時間(人×週)(${td} まで)` });
    B.push({ t: 'p', text: `週の始まり: ${WD[M.ws]}。列の見出しは週の始まりの日付。単位は時間。` });
    if (!weeks.length || !M.members.length) { none('hours: の記録がありません'); return B; }
    const sum = (m, w) => recs.filter((r) => r.who === m && r.val.hours && weekOf(r.date, M.ws) === w).reduce((s, r) => s + r.val.hours, 0);
    const grid = M.members.map((m) => weeks.map((w) => sum(m, w)));
    const tot = weeks.map((w, i) => grid.reduce((s, row) => s + row[i], 0));
    const rows = M.members.map((m, k) => ({ cells: [m, ...grid[k].map(fmtH), fmtH(grid[k].reduce((s, v) => s + v, 0))] }));
    rows.push({ cells: [{ t: '合計', weight: '600' }, ...tot.map((v) => ({ t: fmtH(v), weight: '600' })), { t: fmtH(tot.reduce((s, v) => s + v, 0)), weight: '600' }] });
    B.push({ t: 'table', name: `作業時間(人×週)(${td} まで)`, cols: [{ h: 'メンバー' }, ...weeks.map((w) => ({ h: wLabel(w), right: true })), { h: '合計時間', right: true }], rows });
    B.push({ t: 'h2', label: 'メンバーごとの週の作業時間' });
    B.push({ t: 'fig', id: 'people', draw: () => lineChart(weeks.map(wLabel), M.members.map((m, k) => ({ name: m, vals: grid[k].map((v) => v / 100) })), '時間') });
    return B;
  }

  if (view === 'hoursTasks') {
    B.push({ t: 'h2', label: `作業時間(タスク×週)(${td} まで)` });
    B.push({ t: 'p', text: `週の始まり: ${WD[M.ws]}。単位は時間。計画の日数は WBS の末端のタスクだけ。作業日数は、全員が hours: を書いた日の数(同じ日は 1 日)。` });
    const hr = recs.filter((r) => r.val.hours);
    if (!hr.length) { none('hours: の記録がありません'); return B; }
    const hk = groupByKey(hr);
    const keys = keyOrder(hk.keys(), L, hr);
    const sumW = (rr, w) => rr.filter((r) => weekOf(r.date, M.ws) === w).reduce((s, r) => s + r.val.hours, 0);
    const rows = keys.map((k) => {
      const rr = hk.get(k), n = L ? index(L).byKey.get(k) : null;
      const days = n && n.sec === 'WBS' && !n.children.length ? P.fmtDays(n.days) : '―';
      return { cells: [numOf(M, k), dispKey(rr, L), ...weeks.map((w) => { const v = sumW(rr, w); return v ? fmtH(v) : ''; }), fmtH(rr.reduce((s, r) => s + r.val.hours, 0)), days, String(new Set(rr.map((r) => r.date)).size)], ref: refOf(M, rr[rr.length - 1]) };
    });
    const tot = weeks.map((w) => sumW(hr, w));
    rows.push({ cells: ['', { t: '合計', weight: '600' }, ...tot.map((v) => ({ t: fmtH(v), weight: '600' })), { t: fmtH(tot.reduce((s, v) => s + v, 0)), weight: '600' }, '', ''] });
    B.push({ t: 'table', name: `作業時間(タスク×週)(${td} まで)`, keep: 2, cols: [{ h: 'WBS 番号' }, { h: '記録先', max: 300 }, ...weeks.map((w) => ({ h: wLabel(w), right: true })), { h: '合計時間', right: true }, { h: '計画の日数', right: true }, { h: '作業日数', right: true }], rows });
    return B;
  }

  if (view === 'trl') {
    const trend = (k, name, unit, chart) => {
      const tr = recs.filter((r) => r.val[k] !== undefined);
      B.push({ t: 'h2', label: `${name}の推移(${td} まで)` });
      if (!tr.length) { none(`${k}: の記録がありません`); return; }
      const tk = groupByKey(tr);
      const keys = keyOrder(tk.keys(), L, tr);
      // 列は、作業時間と同じく、最初の記録の週から基準日の週まで
      const wk = weeks;
      // その週の最後の値。TRL は同じ日付に違う値があれば小さい方(マイログの仕様書 4.4 節)
      const lastIn = (rr, w) => { const x = rr.filter((r) => weekOf(r.date, M.ws) === w); if (!x.length) return null; return k === 'trl' ? Lg.lastTrl(x).val.trl : x[x.length - 1].val[k]; };
      B.push({ t: 'table', name: `${name}の推移(${td} まで)`, cols: [{ h: '機能', max: 240 }, ...wk.map((w) => ({ h: wLabel(w), right: k === 'trl' }))], rows: keys.map((key) => ({ cells: [dispKey(tk.get(key), L), ...wk.map((w) => { const v = lastIn(tk.get(key), w); return v === null ? '' : String(v); })], ref: refOf(M, tk.get(key)[tk.get(key).length - 1]) })) });
      if (chart) { B.push({ t: 'h2', label: `機能ごとの${name}` }); B.push({ t: 'fig', id: k, draw: () => lineChart(wk.map(wLabel), keys.map((key) => ({ name: dispKey(tk.get(key), L), vals: wk.map((w) => lastIn(tk.get(key), w)) })), unit) }); }
    };
    B.push({ t: 'p', text: `週の始まり: ${WD[M.ws]}。その週の最後の報告の値。TPM は書いたままの文。` });
    trend('trl', 'TRL ', 'TRL', true);
    trend('tpm', 'TPM ', '', false);
    return B;
  }

  if (view === 'tests') {
    B.push({ t: 'h2', label: `テストの記録(${td} まで)` });
    const tr = recs.filter((r) => r.val.test);
    if (!tr.length) { none('test: の記録がありません'); return B; }
    const seen = new Set();
    B.push({ t: 'table', name: `テストの記録(${td} まで)`, cols: [{ h: '新/再' }, { h: '機能', max: 220 }, { h: 'MOP', max: 300 }, { h: '実施日' }, { h: '結果' }, { h: '記録者' }, { h: 'メモ', max: 240 }], rows: tr.map((r) => { const k = `${r.key}|${r.val.mop}`; const re = seen.has(k); seen.add(k); return { cells: [re ? '再' : '新', dispKey([r], L), r.val.mop, fmtDate(r.date), r.val.test, r.who, r.val.note ?? ''], ref: refOf(M, r) }; }) });
    return B;
  }

  if (view === 'mop') {
    B.push({ t: 'h2', label: `MOP の達成状況(${td})` });
    if (!L) { B.push({ t: 'p', text: noPlanText, fill: COL.accent }); return B; }
    const rows = [];
    let nOk = 0, nNg = 0, nNo = 0;
    for (const f of L.r.bySec.FBS || []) f.mops.forEach((m, i) => {
      const tr = (byKey.get(keyOf(f)) || []).filter((r) => r.val.test && r.val.mop === m.trim());
      const last = Lg.lastTest(tr);
      if (!last) nNo++; else if (last.val.test === 'ok') nOk++; else nNg++;
      rows.push({ cells: [labelOfNode(f), m.trim(), f.mopChecked[i] ? '✓' : '', last ? last.val.test : '未実施', last ? fmtDate(last.date) : '―', last ? last.who : '―', String(tr.length)], ref: last ? refOf(M, last) : null });
    });
    B.push({ t: 'p', text: `MOP 全 ${rows.length} 件: ok ${nOk} 件、ng ${nNg} 件、未実施 ${nNo} 件。「計画」は計画でチェック済み(mop*:)。`, fill: COL.text });
    if (rows.length) B.push({ t: 'table', name: `MOP の達成状況(${td})`, cols: [{ h: '機能', max: 220 }, { h: 'MOP', max: 300 }, { h: '計画' }, { h: '最後のテスト' }, { h: '最後のテストの日' }, { h: '記録者' }, { h: 'テストした回数', right: true }], rows }); else none('計画に MOP がありません');
    return B;
  }

  if (view === 'reflect') {
    const R = reflectData(M);
    if (!R) { B.push({ t: 'p', text: '計画書を読み込むと候補を示します', fill: COL.accent }); return B; }
    B.push({ t: 'h2', label: '進捗の変更' });
    if (R.status.length) B.push({ t: 'table', name: '進捗の変更', cols: [{ h: 'タスク', max: 280 }, { h: '計画の進捗' }, { h: '最後の進捗' }, { h: '報告日' }, { h: '記録者' }], rows: R.status.map((x) => ({ cells: [taskLabel(x), STATUS[x.t.status ?? 'todo'], stCell(x.st.val.status), fmtDate(x.st.date), x.st.who], ref: refOf(M, x.st) })) }); else none();
    const mcols = [{ h: '機能', max: 220 }, { h: 'MOP', max: 300 }, { h: '最後のテストの日' }, { h: '結果' }, { h: '記録者' }];
    const mrows = (xs) => xs.map((x) => ({ cells: [labelOfNode(x.f), x.m, fmtDate(x.last.date), x.last.val.test, x.last.who], ref: refOf(M, x.last) }));
    B.push({ t: 'h2', label: 'MOP のチェック' });
    if (R.mopOk.length) B.push({ t: 'table', name: 'MOP のチェック', cols: mcols, rows: mrows(R.mopOk) }); else none();
    B.push({ t: 'h2', label: 'MOP のチェックの取り消し' });
    if (R.mopNg.length) B.push({ t: 'table', name: 'MOP のチェックの取り消し', cols: mcols, rows: mrows(R.mopNg) }); else none();
    B.push({ t: 'h2', label: '計画にない作業' });
    if (R.extra.size) B.push({ t: 'table', name: '計画にない作業', cols: [{ h: '名前', max: 260 }, { h: '合計時間', right: true }, { h: '最初の日' }, { h: '記録者', max: 160 }], rows: [...R.extra.values()].map((rr) => ({ cells: [rr[0].label, fmtH(rr.reduce((s, r) => s + r.val.hours, 0)), fmtDate(rr[0].date), [...new Set(rr.map((r) => r.who))].join('・')], ref: refOf(M, rr[0]) })) }); else none();
    return B;
  }

  if (view === 'week') {
    // 選べる週(weekOptions)にない週を受け取ったら、基準日の週にする(一覧や基準日が変わって、選んだ週がなくなったとき)
    const w0 = typeof ctx.week === 'number' && weekOptions(M).includes(ctx.week) ? ctx.week : weekOf(today, M.ws), w1 = w0 + 6;
    const wr = recs.filter((r) => r.date >= w0 && r.date <= w1);
    B.push({ t: 'h2', label: `週のまとめ(${fmtDate(w0)}〜${fmtDate(w1)})` });
    B.push({ t: 'p', text: `基準日より後の記録は含めません。週の始まり: ${WD[M.ws]}。` });
    B.push({ t: 'h2', label: 'メンバーごとの記録' });
    if (M.members.length) B.push({ t: 'table', name: 'メンバーごとの記録', cols: [{ h: 'メンバー' }, { h: '記録日数', right: true }, { h: '合計時間', right: true }], rows: M.members.map((m) => { const mr = wr.filter((r) => r.who === m); return { cells: [m, String(new Set(mr.map((r) => r.date)).size), fmtH(mr.reduce((s, r) => s + (r.val.hours || 0), 0))] }; }) }); else none();
    B.push({ t: 'h2', label: 'この週に完了したタスク' });
    const dn = wr.filter((r) => r.val.status === 'done');
    if (dn.length) B.push({ t: 'table', name: 'この週に完了したタスク', cols: [{ h: '日付' }, { h: '記録者' }, { h: 'タスク', max: 320 }], rows: dn.map((r) => ({ cells: [fmtDate(r.date), r.who, `${numOf(M, r.key) === '―' ? '' : `${numOf(M, r.key)} `}${dispKey([r], L)}`], ref: refOf(M, r) })) }); else none();
    B.push({ t: 'h2', label: 'この週の作業時間' });
    const hk = groupByKey(wr.filter((r) => r.val.hours));
    if (hk.size) B.push({ t: 'table', name: 'この週の作業時間', cols: [{ h: '記録先', max: 300 }, { h: '時間', right: true }, { h: '記録者', max: 160 }, { h: '日', max: 160 }], rows: keyOrder(hk.keys(), L, wr).map((k) => { const rr = hk.get(k); return { cells: [dispKey(rr, L), fmtH(rr.reduce((s, r) => s + r.val.hours, 0)), [...new Set(rr.map((r) => r.who))].join('・'), [...new Set(rr.map((r) => mmdd(r.date)))].join('、')], ref: refOf(M, rr[rr.length - 1]) }; }) }); else none();
    B.push({ t: 'h2', label: 'この週の問題と解決' });
    const ir = [];
    for (const r of wr) { if (r.val.issue) ir.push([r, '問題', r.val.issue]); if (r.val.solved) ir.push([r, '解決', r.val.solved]); }
    if (ir.length) B.push({ t: 'table', name: 'この週の問題と解決', cols: [{ h: '日付' }, { h: '記録者' }, { h: '記録先', max: 240 }, { h: '種類' }, { h: '内容', max: 300 }], rows: ir.map(([r, k, v]) => ({ cells: [fmtDate(r.date), r.who, dispKey([r], L), k, v], ref: refOf(M, r) })) }); else none();
    B.push({ t: 'h2', label: 'この週の依頼と返事' });
    const qr = [];
    for (const r of wr) {
      for (const kind of ['review', 'ask']) for (const to of r.val[kind] || []) {
        const q = M.reqs.find((x) => x.rec === r && x.kind === kind && x.to === to);
        qr.push([r, kind === 'review' ? '確認の依頼' : '質問', to, q && q.reply ? `対応済み(${fmtDate(q.reply.date)})` : '未対応']);
      }
      if (r.val.reviewed) qr.push([r, '確認の結果', r.val.reviewed, '']);
      if (r.val.answered) qr.push([r, '回答', r.val.answered, '']);
    }
    if (qr.length) B.push({ t: 'table', name: 'この週の依頼と返事', cols: [{ h: '日付' }, { h: '記録者' }, { h: '種類' }, { h: '相手・内容', max: 240 }, { h: '対応', max: 160 }, { h: '記録先', max: 240 }], rows: qr.map(([r, k, v, st]) => ({ cells: [fmtDate(r.date), r.who, k, v, st, dispKey([r], L)], ref: refOf(M, r) })) }); else none();
    B.push({ t: 'h2', label: 'この週のメモ' });
    const nr = [];
    for (const l of M.logs) for (const d of l.days) if (d.date >= w0 && d.date <= w1 && d.date <= today && d.note) nr.push([d.date, l.who, '(日付の行)', d.note, { key: `${l.li}:${d.line}`, file: l.li, line: d.line }, d.line]);
    for (const r of wr) if (r.val.note) nr.push([r.date, r.who, dispKey([r], L), r.val.note, refOf(M, r), r.line]);
    nr.sort((a, b) => a[0] - b[0] || M.members.indexOf(a[1]) - M.members.indexOf(b[1]) || a[5] - b[5]);
    if (nr.length) B.push({ t: 'table', name: 'この週のメモ', cols: [{ h: '日付' }, { h: '記録者' }, { h: '記録先', max: 240 }, { h: 'メモ', max: 340 }], rows: nr.map(([d, w, k, v, ref]) => ({ cells: [fmtDate(d), w, k, v], ref })) }); else none();
    B.push({ t: 'h2', label: 'この週のテスト・TRL・TPM' });
    const tr = [];
    for (const r of wr) { if (r.val.test) tr.push([r, `テスト ${r.val.test}: ${r.val.mop}`]); if (r.val.trl !== undefined) tr.push([r, `TRL ${r.val.trl}`]); if (r.val.tpm) tr.push([r, `TPM ${r.val.tpm}`]); }
    if (tr.length) B.push({ t: 'table', name: 'この週のテスト・TRL・TPM', cols: [{ h: '日付' }, { h: '記録者' }, { h: '機能', max: 220 }, { h: '内容', max: 340 }], rows: tr.map(([r, v]) => ({ cells: [fmtDate(r.date), r.who, dispKey([r], L), v], ref: refOf(M, r) })) }); else none();
    return B;
  }
  return B;
}
// ---- 計画への反映候補(6.16 節)。ビューと、作業の概要・開いたときのビュー(7.2 節・8.3 節)で使う。基準日の版がなければ null
function reflectData(M) {
  const { L, byKey, recs } = M;
  if (!L) return null;
  const status = M.tasks.filter((x) => x.st && x.st.val.status !== (x.t.status ?? 'todo'));
  const mops = (want, checked) => {
    const out = [];
    for (const f of L.r.bySec.FBS || []) f.mops.forEach((m, i) => {
      if (!!f.mopChecked[i] !== checked) return;
      const tr = (byKey.get(keyOf(f)) || []).filter((r) => r.val.test && r.val.mop === m.trim());
      const last = Lg.lastTest(tr);
      if (last && last.val.test === want) out.push({ f, m: m.trim(), last });
    });
    return out;
  };
  const extra = groupByKey(recs.filter((r) => r.planned === false && !r.gone && r.val.hours)); // 前の版で計画にあった名前(計画から削除)は出さない(6.16 節)
  const R = { status, mopOk: mops('ok', false), mopNg: mops('ng', true), extra };
  R.total = R.status.length + R.mopOk.length + R.mopNg.length + R.extra.size;
  return R;
}
// MOP の数(6.15 節)
function mopCounts(M) {
  const { L, byKey } = M;
  if (!L) return null;
  let all = 0, ok = 0, ng = 0;
  for (const f of L.r.bySec.FBS || []) f.mops.forEach((m) => {
    all++;
    const tr = (byKey.get(keyOf(f)) || []).filter((r) => r.val.test && r.val.mop === m.trim());
    if (tr.length) { if (Lg.lastTest(tr).val.test === 'ok') ok++; else ng++; }
  });
  return { all, ok, ng, none: all - ok - ng };
}
// 作業の概要(7.2 節): 基準日の時点の作業分析の数。戻り値 { head, rows: [[項目, 値]] }
function workSummary(M) {
  const { L, today, recs } = M;
  const join = (a) => a.filter(Boolean).join('、');
  const who = [...new Set(M.logs.map((l) => l.who))];
  const R = reflectData(M), mc = mopCounts(M);
  const codes = [...new Set(M.sig.map((x) => x.code))].sort((a, b) => +a.slice(1) - +b.slice(1));
  const w0 = weekOf(today, M.ws);
  const sumH = (f) => recs.filter((r) => r.val.hours && f(r)).reduce((s, r) => s + r.val.hours, 0);
  const open = M.reqs.filter((q) => !q.reply);
  const order = ['late', 'blocked', 'overstart', 'doing', 'future', 'done'];
  const rows = [
    ['マイログ', `${who.length} 人${M.noLog.length ? `(マイログのないメンバー ${M.noLog.length} 人)` : ''}`],
    ['計画への反映候補', R ? `${R.total} 件${R.total ? `(${join([R.status.length && `進捗の変更 ${R.status.length}`, R.mopOk.length && `MOP のチェック ${R.mopOk.length}`, R.mopNg.length && `MOP のチェックの取り消し ${R.mopNg.length}`, R.extra.size && `計画にない作業 ${R.extra.size}`])})` : ''}` : '計画書を読み込むと数えます'],
    ['要確認', `${M.sig.length + M.notes.length} 件${M.sig.length + M.notes.length ? `(${join([...codes.map((c) => `${c} ${M.sig.filter((x) => x.code === c).length}`), M.notes.length && `知らせ ${M.notes.length}`])})` : ''}`],
    ['タスクの区分', L ? join(order.map((id) => `${CATS.find((c) => c.id === id).short} ${M.tasks.filter((x) => x.cat === id).length}`)) : '計画書を読み込むと数えます'],
    ['作業時間', `今週 ${fmtH(sumH((r) => weekOf(r.date, M.ws) === w0))} 時間、先週 ${fmtH(sumH((r) => weekOf(r.date, M.ws) === w0 - 7))} 時間、基準日まで ${fmtH(sumH(() => true))} 時間`],
    ['依頼', `未対応 ${open.length} 件${open.length ? `(最も長いもの ${Math.max(...open.map((q) => today - q.date))} 日)` : ''}`],
    ['MOP', mc ? `ok ${mc.ok}、ng ${mc.ng}、未実施 ${mc.none}(全 ${mc.all} 件)` : '計画書を読み込むと数えます'],
  ];
  return { head: `基準日 ${fmtDate(today)}。基準日の版: ${L ? `${labels(M.plans).get(L)}(${L.name})` : 'なし'}。基準日より後の記録は数えません。`, rows };
}
// 開いたときのビュー(8.3 節): 反映候補があれば反映候補、要確認があれば要確認、なければサマリー。マイログの一覧が空ならサマリー
function openingView(M) {
  if (!M.list.length) return 'overview';
  const R = reflectData(M);
  if (R && R.total) return 'reflect';
  if (M.sig.length + M.notes.length) return 'alerts';
  return 'overview';
}
function render(M, view, ctx) { const lay = Lg.layout(blocks(M, view, ctx)); return { svg: lay.svg, anchors: lay.anchors }; }
function pieces(M, view, ctx) { return Lg.piecesOf(Lg.layout(blocks(M, view, ctx))); }
function printAll(M, ctx) { const out = []; for (const v of VIEWS) out.push(...Lg.printPages(blocks(M, v.id, ctx))); return out; }

return { EXAMPLE_TODAY, VIEWS, FORMAT, toPlans, fromPlans, loadPlan, reflectData, mopCounts, workSummary, openingView, loadLog, classifyLog, moveLog, model, weekOptions, lineChart, blocks, render, pieces, printAll };
})();
if (typeof module !== 'undefined') module.exports = Team;
/*TEAM-END*/
