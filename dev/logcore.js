/*LOG-BEGIN*/
// ---- マイログの解析・照合・兆候・表の描画(DOM を使わない。Node でも動く)
// 計算部(core.js の Plan)は書き換えずに使う。プロジェクト分析はこのファイルを写して使う(マイログの仕様書 12 章)
const Log = (() => {
'use strict';
/* global Plan */
const P = typeof Plan !== 'undefined' ? Plan : require('./core.js');

// ================= 日付 =================
const DAY = 86400000;
// YYYY-MM-DD を 1970-01-01 からの日数にする(計算部と同じ数え方)。形が違うか実在しない日付なら null
function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return Math.round(t / DAY);
}
const fmtDate = (n) => new Date(n * DAY).toISOString().slice(0, 10);
const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const dow = (n) => (((n + 4) % 7) + 7) % 7; // 1970-01-01 は木曜(4)
// 週の始まりの日(ws は週の始まりの曜日の番号。日曜 0)
const weekOf = (n, ws) => n - ((dow(n) - ws + 7) % 7);
const mmdd = (n) => fmtDate(n).slice(5);
const norm = (t) => t.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

// ================= 予約語(仕様書 3.6 節) =================
const TASK_K = ['hours', 'status', 'progress', 'review', 'reviewed'];
const FUNC_K = ['trl', 'tpm', 'test', 'mop'];
const NEUT_K = ['issue', 'solved', 'ask', 'answered', 'note', 'help']; // help: は予約語として見つけ、使えないことを示す(3.6 節)
const ALL_K = [...TASK_K, ...FUNC_K, ...NEUT_K];
// 自由に書く文の属性(** と __ を書ける。仕様書 3.10 節)
const FREE_K = ['note', 'mop', 'issue', 'solved', 'answered', 'tpm'];
const LIST_K = ['review', 'ask'];
const STATUS = { todo: '実行前', doing: '実行中', done: '完了', blocked: '問題発生' };
const KIND_JA = { review: '確認', ask: '質問' };

// 名前と属性に分ける。「空白 + 予約語 + :」(行頭なら予約語 + :)で区切る(仕様書 3.5 節)
function splitAttrs(s, base) {
  const re = new RegExp(`(^|[ \\t])(${ALL_K.join('|')}):`, 'g');
  const hits = [];
  let m;
  while ((m = re.exec(s))) {
    const ks = m.index + m[1].length;
    hits.push({ key: m[2], ks, vs: ks + m[2].length + 1 });
    re.lastIndex = ks + m[2].length + 1;
  }
  const nameEndRaw = hits.length ? hits[0].ks : s.length;
  const nameRaw = s.slice(0, nameEndRaw);
  const name = nameRaw.trim();
  const nOff = nameRaw.length - nameRaw.trimStart().length;
  const attrs = hits.map((h, i) => {
    const raw = s.slice(h.vs, i + 1 < hits.length ? hits[i + 1].ks : s.length);
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    return { key: h.key, text, keyStart: base + h.ks, start: base + h.vs + lead, end: base + h.vs + lead + text.length };
  });
  return { name, nameStart: base + nOff, nameEnd: base + nOff + name.length, attrs };
}

// ================= 解析(仕様書 3 章・4 章) =================
// opt.today: 今日(1970-01-01 からの日数)。今日より後の日付の警告に使う
function parse(text0, opt = {}) {
  const text = norm(text0);
  const diags = [];
  const add = (level, cat, line, start, end, message, extra) => diags.push({ level, cat, line, start, end, message, ...(extra || {}) });
  const set = {};
  let byWritten = false;
  const days = [], recs = [];
  let cur = null, off = 0, order = 0;
  const lines = text.split('\n');
  lines.forEach((raw, i) => {
    const ln = i + 1, ls = off;
    off += raw.length + 1;
    const E = (msg, extra) => add('error', '構文', ln, ls, ls + raw.length, msg, extra);
    // 注: 行頭か、直前が空白・タブの // から行末まで(仕様書 3.9 節)
    let cut = raw.length;
    for (let k = 0; k < raw.length - 1; k++) if (raw[k] === '/' && raw[k + 1] === '/' && (k === 0 || raw[k - 1] === ' ' || raw[k - 1] === '\t')) { cut = k; break; }
    const body = raw.slice(0, cut).replace(/[ \t]+$/, '');
    if (!body.replace(/[　]/g, '').trim()) return; // 空行
    // version: は 1 行目にだけ、字下げせずに書ける(仕様書 3.3 節)
    if (/^[ \t　]*version:/.test(body) && !(i === 0 && body.startsWith('version:'))) { E('version: は 1 行目にだけ、字下げせずに書けます', { ver: true }); return; }
    if (i === 0 && body.startsWith('version:')) {
      const after = body.slice(8);
      const lead = after.length - after.trimStart().length;
      const val = after.trim();
      const vStart = ls + 8 + lead;
      set.version = { value: val, date: parseDate(val), line: ln, start: ls, end: ls + raw.length, vStart, vEnd: vStart + val.length };
      if (set.version.date === null) E(val ? `version: の値は YYYY-MM-DD の日付で書きます(「${val}」)` : 'version: の後ろに日付(YYYY-MM-DD)を書いてください');
      return;
    }
    const m = /^([ \t　]*)([^]*)$/.exec(body);
    const ind = m[1], rest = m[2];
    if (ind.includes('　')) { E('字下げに全角の空白が使われています。半角の空白かタブで字下げしてください'); return; }
    // 生成 AI の書き癖など、とくに専用の診断文を出すもの(仕様書 3.10 節)
    if (/^#/.test(rest)) { E('見出し(#)は書けません。日付の行は「- YYYY-MM-DD」、記録の行は字下げして「- 名前 予約語: 値」と書きます'); return; }
    if (/^\d+[.)][ \t]/.test(rest)) { E('番号付きのリストは書けません。「- 」で書きます'); return; }
    if (/^[*+][ \t]/.test(rest)) { E('「* 」「+ 」のリストは書けません。「- 」で書きます'); return; }
    if (/^```/.test(rest)) { E('コードブロック(```)は書けません'); return; }
    if (/^-　/.test(rest)) { E('「-」の後が全角の空白です。半角の空白にしてください'); return; }
    const isItem = /^-([ \t]|$)/.test(rest);
    if (!ind && !isItem) {
      const s = /^([A-Za-z]+):(.*)$/.exec(rest);
      if (!s) { E('説明の文は書けません。メモは記録の行の note: に書きます'); return; }
      const key = s[1], val = s[2].trim();
      if (!['by', 'week'].includes(key)) { E(`「${key}:」は設定の行ではありません。設定の行は version:・by:・week: です`); return; }
      if (key === 'by') byWritten = true; // by: の行はある(値の誤りは、その行のエラーだけにする)
      if (set[key]) { E(`${key}: が 2 回書かれています(${set[key].line} 行と)`); return; }
      if (!val) { E(`${key}: の後ろに${key === 'week' ? '曜日(mon〜sun)' : '名前'}を書いてください`); return; }
      if (key === 'week' && !WD.includes(val)) { E(`week: の値は mon・tue・wed・thu・fri・sat・sun のどれかです(「${val}」)`); return; }
      if (key !== 'week' && /,|::|\*\*|__/.test(val)) { E(`${key}: の名前に「,」「::」「**」「__」は使えません`); return; }
      set[key] = { value: val, line: ln, start: ls, end: ls + raw.length, vStart: ls + rest.indexOf(val, key.length + 1), vEnd: ls + rest.indexOf(val, key.length + 1) + val.length };
      return;
    }
    if (!isItem) { E('説明の文は書けません。記録の行は「- 名前 予約語: 値」の形で書きます(メモは note: に書きます)'); return; }
    const dashAt = ls + ind.length;
    const after = rest.slice(1);
    const lead = after.length - after.trimStart().length;
    const pa = splitAttrs(after.trimStart(), dashAt + 1 + lead);
    // ** と __ は、名前と名前を書く値では構文エラー、自由に書く文の値(FREE_K)では書ける(仕様書 3.10 節)
    const bold = [pa.name, ...pa.attrs.filter((a) => !FREE_K.includes(a.key)).map((a) => a.text)].some((x) => /\*\*|__/.test(x));
    if (bold) { E('太字(** や __)は書けません'); return; }
    if (!ind) {
      // 日付の行(仕様書 3.4 節)
      const d = parseDate(pa.name);
      if (d === null) {
        E(/^\d{4}-\d{1,2}-\d{1,2}$/.test(pa.name) ? `「${pa.name}」は実在する日付ではありません(YYYY-MM-DD で書きます)` : `日付の行は「- YYYY-MM-DD」で書きます(「${pa.name || '(空)'}」)。記録の行は字下げして書きます`);
        cur = { invalid: true };
        return;
      }
      let note = null;
      for (const a of pa.attrs) {
        if (a.key === 'help') { E('help: は使えません。チームの人に聞くときは ask: を使います(日付の行に書ける属性は note: だけです)'); continue; }
        if (a.key !== 'note') { E(`日付の行に書ける属性は note: だけです(${a.key}:)`); continue; }
        if (note) { E('note: が同じ行に 2 回書かれています'); continue; }
        if (!a.text) { E('note: の後ろに値がありません'); continue; }
        note = a.text;
      }
      cur = { date: d, line: ln, start: ls, end: ls + raw.length, nameStart: pa.nameStart, nameEnd: pa.nameEnd, note, recs: [] };
      days.push(cur);
      return;
    }
    // 記録の行
    if (!cur) { E('記録の行の前に日付の行(- YYYY-MM-DD)がありません'); return; }
    if (cur.invalid) return; // 日付の行が正しくないときは、その下の記録は読まない(同じ誤りを重ねて出さない)
    if (!pa.name) { E(pa.attrs.some((a) => a.key === 'help') ? '記録の行に名前がありません。また、help: は使えません。チームの人に聞くときは ask: を使います' : '記録の行に名前がありません'); return; }
    let bad = false;
    const Ebad = (msg) => { E(msg); bad = true; };
    if (pa.name.includes(',')) Ebad('名前に「,」は使えません');
    const segs = pa.name.split('::').map((x) => x.trim());
    if (segs.some((x) => !x)) Ebad('「::」の前後に名前がありません');
    const at = {};
    for (const a of pa.attrs) {
      if (at[a.key]) { Ebad(`${a.key}: が同じ行に 2 回書かれています`); continue; }
      at[a.key] = a;
    }
    if (at.help) Ebad('help: は使えません。チームの人に聞くときは ask: を使います');
    const hasT = TASK_K.some((k) => at[k]), hasF = FUNC_K.some((k) => at[k]);
    if (hasT && hasF) Ebad('タスクの属性(hours・status・progress・review・reviewed)と機能の属性(trl・tpm・test・mop)は、同じ行に書けません');
    if (!!at.test !== !!at.mop) Ebad(at.test ? 'test: には、テストした MOP の文を mop: で組にして書きます' : 'mop: は test: と組で書きます');
    const val = {};
    for (const a of Object.values(at)) {
      const t = a.text;
      if (!t) { Ebad(`${a.key}: の後ろに値がありません`); continue; }
      if (a.key === 'hours') {
        if (!/^\d+(\.\d{1,2})?$/.test(t)) { Ebad(`hours: の値は 0 より大きい数(小数は 2 桁まで)で書きます(「${t}」)`); continue; }
        const c = Math.round(Number(t) * 100);
        if (c <= 0 || c > 2400) { Ebad(`hours: の値は 0 より大きく 24 以下です(「${t}」)`); continue; }
        val.hours = c; // 1/100 時間を単位とする整数
      } else if (a.key === 'progress') {
        if (!/^\d+$/.test(t) || +t > 100) { Ebad(`progress: の値は 0〜100 の整数です(% は付けません。「${t}」)`); continue; }
        val.progress = +t;
      } else if (a.key === 'trl') {
        if (!/^\d+$/.test(t)) { Ebad(`trl: の値は 0 以上の整数です(「${t}」)`); continue; }
        val.trl = +t;
      } else if (a.key === 'status') {
        if (!STATUS[t]) { Ebad(`status: の値は todo・doing・done・blocked のどれかです(「${t}」)`); continue; }
        val.status = t;
      } else if (a.key === 'test' || a.key === 'reviewed') {
        if (t !== 'ok' && t !== 'ng') { Ebad(`${a.key}: の値は ok か ng です(「${t}」)`); continue; }
        val[a.key] = t;
      } else if (LIST_K.includes(a.key)) {
        const items = t.split(',').map((x) => x.trim());
        if (items.some((x) => !x)) { Ebad(`${a.key}: の名前の並びに空の名前があります`); continue; }
        if (items.some((x) => x.includes('::'))) { Ebad(`${a.key}: の名前に「::」は使えません`); continue; }
        const uniq = [];
        for (const x of items) {
          if (uniq.includes(x)) add('warn', '書き方', ln, a.start, a.end, `「${x}」が ${a.key}: に 2 回書かれています(1 回とみなします)`);
          else uniq.push(x);
        }
        val[a.key] = uniq;
      } else val[a.key] = t;
    }
    if (bad) return;
    const kind = hasT ? 'task' : hasF ? 'func' : 'neutral';
    const rec = { line: ln, start: ls, end: ls + raw.length, name: pa.name, segs, nameStart: pa.nameStart, nameEnd: pa.nameEnd, at, val, kind, date: cur.date, order: order++, day: cur };
    if (!pa.attrs.length) add('warn', '書き方', ln, pa.nameStart, pa.nameEnd, '属性のない記録の行です(時間・進捗・問題などを 予約語: 値 で書きます)');
    // 状態と進捗率の食い違い(仕様書 4.2 節)
    if (val.status === 'done' && val.progress !== undefined && val.progress !== 100) add('warn', '値の食い違い', ln, at.progress.start, at.progress.end, `status: done なのに progress: が ${val.progress} です(完了なら 100)`);
    if (val.progress === 100 && val.status && val.status !== 'done') add('warn', '値の食い違い', ln, at.status.start, at.status.end, `progress: 100 なのに status: が ${val.status} です(完了なら done)`);
    cur.recs.push(rec);
    recs.push(rec);
  });
  // 必須の設定
  if (!set.by && !byWritten) add('error', '必須', 1, 0, 0, 'by:(記録者の名前)がありません');
  // 日付の行の並び(仕様書 3.4 節)
  const seen = new Map();
  let prev = null;
  for (const d of days) {
    if (seen.has(d.date)) add('warn', '日付', d.line, d.nameStart, d.nameEnd, `同じ日付の行が 2 回あります(${seen.get(d.date)} 行と。どちらの記録も使います)`);
    else seen.set(d.date, d.line);
    if (prev && d.date < prev.date) add('warn', '日付', d.line, d.nameStart, d.nameEnd, `前の日付の行(${fmtDate(prev.date)}、${prev.line} 行)より前の日付です`);
    if (typeof opt.today === 'number' && d.date > opt.today) add('warn', '日付', d.line, d.nameStart, d.nameEnd, `今日(${fmtDate(opt.today)})より後の日付です(次回の計画はマイログの外に書きます)`);
    prev = d;
  }
  // 1 日の時間の合計(仕様書 4.2 節)
  const sum = new Map();
  for (const r of recs) if (r.val.hours) sum.set(r.date, (sum.get(r.date) ?? 0) + r.val.hours);
  for (const [d, c] of sum) if (c > 2400) { const dl = days.find((x) => x.date === d); add('warn', '値の食い違い', dl.line, dl.nameStart, dl.nameEnd, `${fmtDate(d)} の hours: の合計が ${fmtH(c)} 時間で、24 時間を超えています`); }
  return { text, diags, set, days, recs, ok: !diags.some((x) => x.level === 'error') };
}
const fmtH = (c) => String(Math.round(c) / 100);

// ---- version:(マイログの仕様書 9 章。プロジェクト計画と同じ扱い)
function stripVersion(text0) { const t = norm(text0); const v = parse(t).set.version; return v ? t.slice(0, v.vStart) + t.slice(v.vEnd) : t; }
function misplacedVersion(text0) { const d = parse(norm(text0)).diags.find((x) => x.ver); return d ? d.line : null; }
function setVersion(text0, date) {
  const t = norm(text0);
  const v = parse(t).set.version;
  if (!v) return `version: ${date}\n${t}`;
  const sp = v.vStart === v.vEnd && !/[ \t]/.test(t[v.vStart - 1]) ? ' ' : '';
  return t.slice(0, v.vStart) + sp + date + t.slice(v.vEnd);
}
// 名前の候補(by: の名前。仕様書 9 章)
function byName(text0) { const s = parse(norm(text0)).set; return s.by ? s.by.value : null; }

// ================= 計画書の一覧(仕様書 5 章。プロジェクト分析の仕様書 3 章と同じ) =================
function loadPlan(name, text0) {
  const text = norm(text0);
  const r = P.analyze(text);
  const v = r.parse.sec.version;
  const date = v && typeof v.date === 'number' ? v.date : null;
  const errs = r.diags.filter((d) => d.level === 'error');
  return {
    name, text, r, date,
    nErr: errs.length, firstErr: errs.length ? errs.reduce((x, y) => (y.line < x.line ? y : x)) : null,
    nWarn: r.diags.filter((d) => d.level === 'warn').length,
    usable: !!r.ok && date !== null,
  };
}
const dateKey = (e) => (e.date === null ? Infinity : e.date);
const sortList = (list) => list.map((e, i) => [e, i]).sort((a, b) => dateKey(a[0]) - dateKey(b[0]) || a[1] - b[1]).map((x) => x[0]);
function addEntries(list, entries) {
  const out = list.slice(), added = [], skipped = [];
  for (const e of entries) {
    const dup = out.find((x) => x.text === e.text);
    if (dup) { skipped.push({ name: e.name, dup: dup.name }); continue; }
    out.push(e); added.push(e);
  }
  return { list: sortList(out), added, skipped };
}
function moveEntry(list, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= list.length || list[i].date === null || list[j].date !== list[i].date) return null;
  const out = list.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
// 版の名前: 同じ日付の照合に使える版の 2 つ目から (2)、(3)…
function labels(list) {
  const m = new Map(), seen = new Map();
  for (const e of list) {
    if (e.date === null) { m.set(e, 'version: なし'); continue; }
    if (!e.usable) { m.set(e, `${fmtDate(e.date)} 版`); continue; }
    const k = (seen.get(e.date) ?? 0) + 1;
    seen.set(e.date, k);
    m.set(e, `${fmtDate(e.date)} 版${k > 1 ? ` (${k})` : ''}`);
  }
  return m;
}
const FORMAT = 'projalysis-plans';
function fromPlans(text) {
  let d;
  try { d = JSON.parse(norm(text)); } catch { return { ok: false, error: 'plans として読めません(JSON の形ではありません)' }; }
  if (!d || typeof d !== 'object' || d.format !== FORMAT || !Array.isArray(d.files) || !d.files.every((f) => f && typeof f.name === 'string' && typeof f.text === 'string')) return { ok: false, error: 'plans として読めません(形が違います)' };
  // マイログ(logs)は読まない(9 章。開いているマイログを置き換えないため)。件数だけ返し、画面で知らせる
  return { ok: true, files: d.files.map((f) => ({ name: f.name, text: f.text })), nLogs: Array.isArray(d.logs) ? d.logs.length : 0 };
}
// plans を足したとき、同じ日付の版の並びを plans の並びに合わせる(5.3 節)。一覧にすでにある版も、テキストが同じなら並べ替える
function alignOrder(list, files) {
  const rank = new Map(files.map((f, i) => [f.text, i]));
  const out = list.slice();
  for (const d of [...new Set(out.map((e) => e.date))]) {
    if (d === null) continue;
    const pos = out.map((e, i) => [e, i]).filter(([e]) => e.date === d && rank.has(e.text)).map(([, i]) => i);
    const ents = pos.map((i) => out[i]).sort((a, b) => rank.get(a.text) - rank.get(b.text));
    pos.forEach((i, k) => { out[i] = ents[k]; });
  }
  return out;
}

// ================= 照合(仕様書 3.7 節・5.4 節) =================
// 対応名: 根を除いた祖先と自分の名前を :: でつなぐ(プロジェクト分析の仕様書 4.1 節)。根は「名前(根)」
const qn = (n) => { const a = []; for (let x = n; x && x.parent; x = x.parent) a.unshift(x.name); return a.join('::'); };
const keyOf = (n) => `${n.sec}:${n.parent ? qn(n) : '#root'}`;
const labelOfNode = (n) => (n.parent ? qn(n) : `${n.name}(根)`);
// 版ごとの探す範囲(計算部の結果から作る。版ごとに 1 回)
function index(e) {
  if (e.ix) return e.ix;
  const r = e.r;
  const wbs = (r.bySec.WBS || []).filter((n) => n.parent);
  const fbs = r.bySec.FBS || [];
  const byKey = new Map();
  for (const n of [...(r.bySec.WBS || []), ...fbs]) byKey.set(keyOf(n), n);
  e.ix = { wbs, fbs, members: r.members.map((m) => m.name), byKey };
  return e.ix;
}
// 名前の探し方はプロジェクト計画の仕様書 3.7 節と同じ(最後の名前が一致し、修飾の並びが祖先の並びの末尾と一致する)
function findNodes(nodes, segs) {
  const last = segs[segs.length - 1];
  return nodes.filter((n) => {
    if (n.name !== last) return false;
    let a = n.parent;
    for (let k = segs.length - 2; k >= 0; k--) { if (!a || a.name !== segs[k]) return false; a = a.parent; }
    return true;
  });
}
// 照合する版(5.4 節): 照合に使える版のうち、版の日付がその日付以前で一覧のいちばん後ろの版。なければ一覧のいちばん前の版
function versionFor(V, date) {
  let pick = null;
  for (const e of V) if (e.date <= date) pick = e;
  return pick ?? V[0] ?? null;
}
// ---- 版をまたいだ記録先の対応(5.6 節): プロジェクト分析の計画書分析の対応づけ(プロジェクト分析の仕様書 4 章)と同じ規則。
// 隣り合う 2 つの版で、節(WBS・FBS)ごとに、根どうし、対応名が同じ要素、対応しなかった要素のうち要素自身の名前が両側にちょうど 1 つずつあるもの(移動)を対応させる。
// 名前の変更は推測しない(対応しない)
const VMAP = new WeakMap();
function verMap(a, b) {
  let m = VMAP.get(a);
  if (!m) { m = new WeakMap(); VMAP.set(a, m); }
  if (m.has(b)) return m.get(b);
  const out = new Map();
  for (const sec of ['WBS', 'FBS']) {
    const all = (e) => e.r.bySec[sec] || [];
    const ra = all(a).find((n) => !n.parent), rb = all(b).find((n) => !n.parent);
    if (ra && rb) out.set(keyOf(ra), keyOf(rb));
    const A = all(a).filter((n) => n.parent), B = all(b).filter((n) => n.parent);
    const byQn = new Map(B.map((n) => [qn(n), n]));
    const used = new Set(), done = new Set();
    for (const x of A) { const y = byQn.get(qn(x)); if (y) { out.set(keyOf(x), keyOf(y)); used.add(y); done.add(x); } }
    const uA = A.filter((x) => !done.has(x)), uB = B.filter((y) => !used.has(y));
    const cnt = (list) => { const c = new Map(); for (const n of list) c.set(n.name, (c.get(n.name) ?? 0) + 1); return c; };
    const cA = cnt(uA), cB = cnt(uB);
    for (const x of uA) if (cA.get(x.name) === 1 && cB.get(x.name) === 1) out.set(keyOf(x), keyOf(uB.find((y) => y.name === x.name)));
  }
  m.set(b, out);
  return out;
}
// 版 from の記録先 key を、一覧で後ろの版 to までたどる。たどれなければ null
function mapKey(V, from, to, key) {
  let i = V.indexOf(from);
  const j = V.indexOf(to);
  if (i < 0 || j < 0 || i > j) return null;
  for (; i < j && key !== null; i++) key = verMap(V[i], V[i + 1]).get(key) ?? null;
  return key;
}
// 名前で探す(3.7 節の探し方)。記録の種類で探す節を決める
function findFor(e, r) {
  const ix = index(e);
  if (r.kind === 'task') return { cands: findNodes(ix.wbs, r.segs), where: 'WBS' };
  if (r.kind === 'func') return { cands: findNodes(ix.fbs, r.segs), where: 'FBS' };
  let cands = findNodes(ix.wbs, r.segs);
  if (cands.length) return { cands, where: 'WBS' };
  cands = findNodes(ix.fbs, r.segs);
  return { cands, where: cands.length ? 'FBS' : 'WBS にも FBS にも' };
}
// 記録先を版 T の要素に寄せる(5.6 節)。記録した日の版で照合した結果(key0 など)はそのまま残し、何度でも寄せ直せる。
// 1. 計画にあった記録先は、隣り合う版の対応で T までたどる。たどれなければ、記録した日の版の記録先のまま
// 2. 計画にない作業だった記録は、T で書いた名前を探し、ちょうど 1 つの要素に決まれば、その要素にする
function remap(recs, V, T) {
  for (const r of recs) {
    if (r.key0 === undefined) { r.key0 = r.key; r.label0 = r.label; r.node0 = r.node; r.planned0 = r.planned; }
    r.key = r.key0; r.label = r.label0; r.node = r.node0; r.planned = r.planned0; r.gone = false;
    if (!T || !r.ver) continue;
    let n = null;
    if (r.planned0 === true) { const k = mapKey(V, r.ver, T, r.key0); n = k === null ? null : index(T).byKey.get(k) || null; }
    let cT = [];
    if (r.planned0 !== true) { cT = findFor(T, r).cands; if (cT.length === 1) n = cT[0]; }
    if (n) { r.key = keyOf(n); r.label = labelOfNode(n); r.node = n; r.planned = true; }
    // T にない記録先(5.6 節): 書いた日の版で計画にあったか、T までのどれかの版で同じ名前が 1 つに決まった(計画に足した後に消した)ものは「計画から削除」
    else if (r.planned0 === true) r.gone = !index(T).byKey.has(r.key0); // 同じ対応名の要素が T にあれば、削除ではない(移動の候補が 2 つ以上など)
    else if (!cT.length) {
      // 計画に足した後に消した作業(寄せる先の版で名前が 2 つ以上なら、曖昧な名前のまま): 名前が 1 つに決まった最後の版の要素を記録先にする(書き方が違っても、計画にあったときの要素が同じなら 1 行にまとめる)
      // 書いた日の版から寄せる先の版までのどれかで計画にあった名前だけ(消した後に初めて書いた記録は、計画にない作業のまま)
      const xs = V.indexOf(r.ver) < 0 ? [] : V.slice(V.indexOf(r.ver)).filter((x) => x.date <= T.date).reverse();
      for (const x of xs) { const c = findFor(x, r).cands; if (c.length === 1) { r.gone = true; r.key = keyOf(c[0]); r.label = labelOfNode(c[0]); break; } }
    }
  }
  return recs;
}
// 画面から今日の記録に書くときの名前(11.4・11.5 節): 今日に使う版で、その記録先の一意に決まるいちばん短い修飾名。
// 前に書いた名前が、計画の変更で一意でなくなったり、名前が変わったりしても、同じ記録先に書けるように。計画にない記録先なら fallback
function nameForWrite(V, date, key, fallback) {
  const L = V && V.length ? versionFor(V, date) : null;
  const n = L ? index(L).byKey.get(key) : null;
  if (!n) return fallback;
  return shortName(n, [...index(L).wbs, ...index(L).fbs]);
}
// 一意に決まるいちばん短い修飾名(補完で入れる名前)
function shortName(n, nodes) {
  const segs = [n.name];
  for (let a = n.parent; ; a = a.parent) {
    if (findNodes(nodes, segs).length <= 1 || !a) return segs.join('::');
    segs.unshift(a.name);
  }
}

// マイログを解析して照合する。plans は計画書の一覧(loadPlan の並び)。opt: { today }
function analyze(text0, plans = [], opt = {}) {
  const p = parse(text0, opt);
  const res = { ...p, plans };
  if (!p.ok) { res.diags = p.diags.filter((d) => d.level === 'error'); return res; }
  const V = plans.filter((e) => e.usable);
  const lab = labels(plans);
  res.V = V;
  // 最新の版(5.4 節): 今日より後の日付の版は使わない(手で先の日付を書いた版があっても、今日の時点の計画で見る)
  res.latest = !V.length ? null : opt.today != null ? versionFor(V, opt.today) : V[V.length - 1];
  const future = opt.today != null ? V.filter((e) => e.date > opt.today) : [];
  res.who = p.set.by.value;
  const W = (r, start, end, message) => p.diags.push({ level: 'warn', cat: '計画との照合', line: r.line, start, end, message });
  // プロジェクト分析は基準日の版を使うので、この知らせは出さない(opt.team)
  if (future.length && !opt.team) p.diags.push({ level: 'warn', cat: '計画との照合', line: 1, start: 0, end: 0, message: `計画書の一覧に、今日より後の日付の版があります(${future.map((e) => lab.get(e)).join('、')})。最新の版としては使いません` });
  if (plans.length && !V.length) p.diags.push({ level: 'warn', cat: '計画との照合', line: 1, start: 0, end: 0, message: '計画書の一覧に、照合に使える版(エラーがなく version: のある版)がありません。照合していません' });
  // by: の名前が最新の版の members: にいるか
  if (res.latest && !index(res.latest).members.includes(res.who)) {
    const s = p.set.by;
    p.diags.push({ level: 'warn', cat: '計画との照合', line: s.line, start: s.vStart, end: s.vEnd, message: `「${res.who}」が計画(${lab.get(res.latest)})の members: にいません` });
  }
  for (const r of p.recs) {
    r.who = res.who;
    let e = versionFor(V, r.date);
    if (!e) { r.ver = e; r.planned = null; r.key = `X:${r.name}`; r.label = r.name; continue; }
    let { cands, where } = findFor(e, r);
    // 版の日付と同じ日付の記録(5.4 節): その版で決まらなければ、同じ日付のそれより上の版を下から順に、続いてそれより前の日付の最後の版を探す。
    // status:・progress: のある記録が、その版で途中の要素に当たる(その日にタスクを分けた)ときも、前の版でタスクに当たれば前の版で照合する
    const wantsTask = r.val.status !== undefined || r.val.progress !== undefined;
    const notTask = (c) => wantsTask && c.length === 1 && c[0].sec === 'WBS' && c[0].children.length > 0;
    if ((cands.length !== 1 || notTask(cands)) && e.date === r.date) {
      const i = V.indexOf(e);
      const alt = [...V.slice(0, i).filter((x) => x.date === r.date).reverse(), ...V.slice(0, i).filter((x) => x.date < r.date).slice(-1)];
      const first = notTask(cands); // その版で途中の要素に当たったときだけ、前の版の途中の要素を飛ばす
      for (const x of alt) { const f = findFor(x, r); if (f.cands.length === 1 && !(first && notTask(f.cands))) { e = x; ({ cands, where } = f); break; } }
    }
    r.ver = e;
    const ix = index(e);
    const vl = lab.get(e);
    if (cands.length === 1) {
      const n = cands[0];
      r.node = n; r.planned = true; r.key = keyOf(n); r.label = labelOfNode(n);
    } else {
      r.planned = false; r.key = `X:${r.name}`; r.label = r.name;
      // 最新の版で 1 つに決まる名前(後の版で計画に足した作業)は、診断を出さない(5.6 節)
      if (!cands.length) { if (!(res.latest && findFor(res.latest, r).cands.length === 1)) W(r, r.nameStart, r.nameEnd, `「${r.name}」が計画(${vl})の ${where.endsWith('にも') ? where : `${where} に`}ありません(この日の版にない名前です)`); }
      else W(r, r.nameStart, r.nameEnd, `「${r.name}」が計画(${vl})の ${where} に ${cands.length} つあり、どれか決まりません。親::子 の形で書いてください(候補: ${cands.map(labelOfNode).join('、')})`);
    }
    // 状態と進捗率はタスクにだけ書ける(仕様書 3.7 節)
    if (r.node && r.node.children.length) {
      for (const k of ['status', 'progress']) if (r.val[k] !== undefined) { W(r, r.at[k].start, r.at[k].end, `「${r.label}」はタスク(WBS の末端)ではないので、${k}: は無視します`); delete r.val[k]; }
    }
    // MOP の文の一致(1 文字も違わない。前後の空白は比べない)
    if (r.val.test && r.node && !r.node.mops.some((t) => t.trim() === r.val.mop)) W(r, r.at.mop.start, r.at.mop.end, `MOP の文が計画(${vl})の「${r.label}」の MOP と一致しません`);
    // 依頼の相手が members: にいるか
    for (const k of ['review', 'ask']) if (r.val[k]) for (const nm of r.val[k]) if (!ix.members.includes(nm)) W(r, r.at[k].start, r.at[k].end, `「${nm}」が計画(${vl})の members: にいません`);
  }
  // status: を書かずに progress: を書いた行は、進捗率から状態を決める(4.2 節): 100 なら完了、100 未満なら実行中
  for (const r of p.recs) if (r.val.progress !== undefined && r.val.status === undefined) { r.val.status = r.val.progress === 100 ? 'done' : 'doing'; r.statusFromProgress = true; }
  // 記録先を最新の版の要素に寄せる(5.6 節)
  remap(p.recs, V, res.latest);
  res.diags = p.diags;
  res.ok = true;
  return res;
}

// ================= 記録のまとめ =================
// logs: [{ who, recs, fi(ファイルの番号) }]。同じ日付の記録は、ファイルの番号、テキストの順で並べる
const ord = (r) => [r.date, r.fi ?? 0, r.order];
const cmp = (a, b) => { const x = ord(a), y = ord(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
function allRecs(logs, upto) {
  const out = [];
  logs.forEach((l, fi) => { for (const r of l.recs) if (upto === undefined || upto === null || r.date <= upto) { r.fi = fi; out.push(r); } });
  return out.sort(cmp);
}
const lastOf = (recs, k) => { let x = null; for (const r of recs) if (r.val[k] !== undefined) x = r; return x; };
// 複数の人が同じ記録先に報告したときのまとめ方(4.2 節)。人ごとの最後の報告をとってからまとめる(一覧の順によらない)
//   状態: 全員が完了なら完了、1 人でも問題発生なら問題発生、それ以外で誰かが実行中か完了なら実行中、それ以外は実行前
//   進捗率: 人ごとの最後の進捗率の平均(整数に丸める)
// recs は記録の順(cmp)。1 人だけなら、その人の最後の報告そのもの
const personOf = (r) => r.who ?? '';
function perPerson(recs, k) { const m = new Map(); for (const r of recs) if (r.val[k] !== undefined) m.set(personOf(r), r); return [...m.values()]; }
// 作成者が交代したとき(4.2 節): 今の作成者(基準の版の by:)の誰かが報告していれば、今の作成者の報告だけでまとめる
function onlyAuthors(list, authors) { if (!authors || !authors.length) return list; const a = list.filter((r) => authors.includes(personOf(r))); return a.length ? a : list; }
// 日ごとのまとめに使う記録: 作成者の誰かがこの属性を一度でも報告していれば、すべての日で作成者の記録だけを使う(外れた人の古い報告で、手戻りや問題の続きが出ないように)
const authorRecs = (xs, authors) => onlyAuthors(xs, authors);
const authorsOf = (L, key) => { const n = L ? index(L).byKey.get(key) : null; return n && n.sec === 'WBS' ? memberNames(n.by) : null; };
function combineStatus(list) {
  const ss = list.map((r) => r.val.status);
  return ss.every((x) => x === 'done') ? 'done' : ss.includes('blocked') ? 'blocked' : ss.some((x) => x === 'doing' || x === 'done') ? 'doing' : 'todo';
}
// まとめた値を持つ記録を返す。もとにする記録は、いちばん新しい報告(同じ日付なら、まとめた値と同じ値の報告、次に人の名前の順)
function combined(list, k, v) {
  const d = Math.max(...list.map((r) => r.date));
  const c = list.filter((r) => r.date === d).sort((a, b) => (b.val[k] === v) - (a.val[k] === v) || String(personOf(a)).localeCompare(String(personOf(b))));
  const base = c[0];
  return base.val[k] === v ? base : { ...base, val: { ...base.val, [k]: v }, combined: true };
}
function lastStatus(recs, authors) {
  const list = onlyAuthors(perPerson(recs, 'status'), authors);
  return list.length ? combined(list, 'status', combineStatus(list)) : null;
}
function lastProgress(recs, authors) {
  const list = onlyAuthors(perPerson(recs, 'progress'), authors);
  return list.length ? combined(list, 'progress', Math.round(list.reduce((x, r) => x + r.val.progress, 0) / list.length)) : null;
}
// 最後のテストの結果(4.4 節): いちばん新しい日付の記録。同じ日付に ok と ng があれば ng(一覧の順によらない)
function lastTest(recs) {
  const tr = recs.filter((r) => r.val.test !== undefined);
  if (!tr.length) return null;
  const d = tr[tr.length - 1].date, same = tr.filter((r) => r.date === d);
  return same.filter((r) => r.val.test === 'ng').pop() || same[same.length - 1];
}
// その期間の最後の TRL(4.4 節): いちばん新しい日付の記録。同じ日付に違う値があれば小さい方(低い方に倒す)
function lastTrl(recs) {
  const tr = recs.filter((r) => r.val.trl !== undefined);
  if (!tr.length) return null;
  const d = tr[tr.length - 1].date;
  return tr.filter((r) => r.date === d).reduce((a, b) => (b.val.trl < a.val.trl ? b : a));
}
// 日ごとの、まとめた値の移り変わり(その日までの人ごとの最後の報告でまとめる)。[{ date, v, rec }]
function timeline(recs, k, f, authors) {
  const out = [], per = new Map();
  const xs = authorRecs(recs.filter((r) => r.val[k] !== undefined), authors);
  for (let i = 0; i < xs.length; i++) {
    per.set(personOf(xs[i]), xs[i]);
    if (i + 1 < xs.length && xs[i + 1].date === xs[i].date) continue;
    const list = [...per.values()];
    out.push({ date: xs[i].date, v: f(list), rec: xs[i] });
  }
  return out;
}
// 最新の版のタスクの状態: 最後の報告、なければ計画の status:
function stateOf(byKey, L, key) {
  const rr = byKey.get(key) || [];
  const s = lastStatus(rr, authorsOf(L, key));
  if (s) return { status: s.val.status, rec: s };
  const n = L ? index(L).byKey.get(key) : null;
  return { status: n ? n.status ?? 'todo' : null, rec: null };
}
function groupByKey(recs) { const m = new Map(); for (const r of recs) { if (!m.has(r.key)) m.set(r.key, []); m.get(r.key).push(r); } return m; }
// 最新の版のタスクの終了予定日(1970-01-01 からの日数)
const endOf = (L, t) => L.r.sched.start + t.d1;
const memberNames = (list) => list.map((m) => m.name);

// ================= 依頼(マイログの仕様書 4.3 節・プロジェクト分析の仕様書 6.5 節) =================
// 依頼の一覧。match が真なら、相手のマイログの返事と突き合わせる(プロジェクト分析の作業分析)
function requests(logs, upto, match) {
  const recs = allRecs(logs, upto);
  const out = [];
  for (const r of recs) for (const kind of ['review', 'ask']) for (const to of r.val[kind] || []) out.push({ kind, from: r.who, to, key: r.key, label: r.label, date: r.date, rec: r, reply: null });
  if (!match) return out;
  const replyK = { review: 'reviewed', ask: 'answered' };
  for (const r of recs) for (const kind of ['review', 'ask']) {
    if (r.val[replyK[kind]] === undefined) continue;
    // 1 つの返事は、それより前(同じ日を含む)の、同じ相手・種類で、同じ記録先か同じ名前(書いたままの名前)の未対応の依頼をすべて閉じる
    for (const q of out) if (!q.reply && q.kind === kind && q.to === r.who && (q.key === r.key || q.rec.name === r.name) && q.date <= r.date) q.reply = r;
  }
  return out;
}

// ================= 兆候(マイログの仕様書 6 章・プロジェクト分析の仕様書 6.3 節) =================
const TH_DEFAULT = { S1: 7, S2: 7, S3: 3, S5: 1, S7: 50, S8: 14 };
const SIG_NAME = { S1: '記録の途絶', S2: '問題の長期化', S3: '返事待ち', S4: '日数の超過', S5: '終了予定日の超過', S6: '手戻り', S7: '計画にない作業', S8: '進捗の停止', S9: '確認の抜け' };
const NEED_PLAN = ['S1', 'S4', 'S5', 'S7', 'S9'];
// ctx: { L(最新の版), today, th, ws(週の始まりの曜日), me(マイログ: 自分の名前), members(プロジェクト分析: メンバーの並び), noLog(マイログのないメンバー) }
// 戻り値: [{ code, who, label, text, date, rec }]
function signals(logs, ctx) {
  const th = { ...TH_DEFAULT, ...(ctx.th || {}) };
  const L = ctx.L, today = ctx.today;
  const recs = allRecs(logs, today);
  const byKey = groupByKey(recs);
  const out = [];
  const push = (code, o) => out.push({ code, ...o });
  const tasks = L ? L.r.tasks : [];
  const people = ctx.me ? [ctx.me] : (ctx.members || []);
  // マイログでは、自分が担当(by:)のタスクだけを見る
  const mine = (t) => !ctx.me || memberNames(t.by).includes(ctx.me);
  // S1 記録の途絶(プロジェクトの開始日より前は出さない)
  if (L && L.r.sched.start <= today) for (const p of people) {
    const pending = tasks.filter((t) => memberNames(t.by).includes(p) && stateOf(byKey, L, keyOf(t)).status !== 'done');
    // マイログがエラーのため集計から外れている人は、記録が途絶えたとは言えない(要確認の先頭に、除外したことを知らせる)
    if ((ctx.errLog || []).includes(p)) continue;
    if ((ctx.noLog || []).includes(p)) { push('S1', { who: p, label: '―', text: `マイログがありません。完了していない担当タスク ${pending.length} 件`, date: null, rec: null }); continue; }
    if (!pending.length) continue;
    const mineR = recs.filter((r) => r.who === p);
    const last = mineR.length ? mineR[mineR.length - 1] : null;
    if (last && today - last.date < th.S1) continue;
    push('S1', { who: p, label: '―', text: `${last ? `最後の記録 ${fmtDate(last.date)}(${today - last.date} 日前)` : '記録がありません'}。完了していない担当タスク ${pending.length} 件`, date: last ? last.date : null, rec: last });
  }
  // S2 問題の長期化(閉じ方は openProblems。プロジェクト分析では、どのメンバーの solved: でもよい)
  for (const { r, kind } of openProblems(recs, L)) {
    if (today - r.date < th.S2) continue;
    if (kind === 'issue') push('S2', { who: r.who, label: r.label, text: `未解決 ${today - r.date} 日(${fmtDate(r.date)} から): ${r.val.issue}`, date: r.date, rec: r });
    else push('S2', { who: r.who, label: r.label, text: `問題発生のまま ${today - r.date} 日(${fmtDate(r.date)} から)`, date: r.date, rec: r });
  }
  // S4 日数の超過
  if (L) for (const t of tasks) {
    if (!mine(t)) continue;
    const key = keyOf(t), rr = (byKey.get(key) || []).filter((r) => r.val.hours);
    const nd = new Set(rr.map((r) => r.date)).size;
    if (nd * 1000 > t.days && stateOf(byKey, L, key).status !== 'done') push('S4', { who: who(t), label: labelOfNode(t), text: `作業日数 ${nd} 日(計画 ${P.fmtDays(t.days)} 日)。今の進捗: ${STATUS[stateOf(byKey, L, key).status] ?? '―'}`, date: rr[rr.length - 1].date, rec: rr[rr.length - 1] });
  }
  // S5 終了予定日の超過
  if (L) for (const t of tasks) {
    if (!mine(t)) continue;
    const key = keyOf(t), st = stateOf(byKey, L, key), end = endOf(L, t);
    if (today - end >= th.S5 && st.status !== 'done') push('S5', { who: who(t), label: labelOfNode(t), text: `終了予定日 ${fmtDate(end)} から ${today - end} 日超過。今の進捗: ${STATUS[st.status]}${st.rec ? `(${fmtDate(st.rec.date)} の報告)` : '(計画の値)'}`, date: end, rec: st.rec });
  }
  // S6 手戻り(完了のあとに実行中・問題発生)
  // 日ごとのまとめた状態(4.2 節)が、完了から実行中か問題発生に戻ったとき
  for (const [key, rr] of byKey) {
    let done = null, back = null;
    for (const x of timeline(rr, 'status', combineStatus, authorsOf(L, key))) {
      if (x.v === 'done') done = x;
      else if (done && (x.v === 'doing' || x.v === 'blocked')) { back = { from: done, to: x }; done = null; }
    }
    // 人と飛び先は、まとめに使った記録(作成者の記録。4.2 節)から選ぶ
    if (back) { const to = authorRecs(rr.filter((r) => r.val.status !== undefined), authorsOf(L, key)).filter((r) => r.date === back.to.date && r.val.status !== 'done').pop() || back.to.rec; push('S6', { who: to.who, label: to.label, text: `${fmtDate(back.from.date)} に完了、${fmtDate(back.to.date)} に${STATUS[back.to.v]}`, date: back.to.date, rec: to }); }
  }
  // S7 計画にない作業(週ごと)
  if (L) {
    const wk = new Map();
    for (const r of recs) {
      if (!r.val.hours) continue;
      const k = `${r.who}|${weekOf(r.date, ctx.ws ?? 1)}`;
      if (!wk.has(k)) wk.set(k, { who: r.who, w: weekOf(r.date, ctx.ws ?? 1), all: 0, x: 0, rec: r });
      const o = wk.get(k);
      o.all += r.val.hours; if (r.planned === false) { o.x += r.val.hours; o.rec = r; }
    }
    for (const o of wk.values()) if (o.all > 0 && o.x * 100 >= th.S7 * o.all) push('S7', { who: o.who, label: '―', text: `${mmdd(o.w)}〜 の週: 計画にない作業の時間 ${fmtH(o.x)} 時間 / 週の合計 ${fmtH(o.all)} 時間(${Math.round(o.x / o.all * 100)} %)`, date: o.w, rec: o.rec });
  }
  // S8 進捗の停止
  for (const [k, rr] of byKey) {
    const pr = authorRecs(rr.filter((r) => r.val.progress !== undefined), authorsOf(L, k)); // 飛び先は、まとめに使った記録(4.2 節)から
    if (!pr.length) continue;
    // 計画があるときは、その版のタスクと、計画にない作業の記録先だけ(名前の変更の前の記録先・途中の要素になった記録先には出さない)
    if (L && !k.startsWith('X:')) { const n = index(L).byKey.get(k); if (!n || n.children.length) continue; }
    // 日ごとのまとめた進捗率(人ごとの最後の値の平均)で見る
    const tl = timeline(rr, 'progress', (list) => Math.round(list.reduce((x, r) => x + r.val.progress, 0) / list.length), authorsOf(L, k));
    const last = pr[pr.length - 1], v = tl[tl.length - 1].v;
    let i = tl.length - 1;
    while (i > 0 && tl[i - 1].v === v) i--;
    const since = tl[i];
    const st = lastStatus(rr, authorsOf(L, k));
    if (v === 100 || st?.val.status === 'done') continue;
    if (today - since.date >= th.S8) push('S8', { who: L && index(L).byKey.get(last.key) && index(L).byKey.get(last.key).sec === 'WBS' ? who(index(L).byKey.get(last.key)) : last.who, label: last.label, text: `進捗率 ${v} % のまま ${today - since.date} 日(${fmtDate(since.date)} から)`, date: since.date, rec: last });
  }
  // S9 確認の抜け
  if (L) for (const t of tasks) {
    // 作成者自身は確認者に数えない(受け継いだ review: に作成者が入っている場合など)
    const rv = memberNames(t.review).filter((m) => !memberNames(t.by).includes(m));
    if (!rv.length) continue;
    const key = keyOf(t), rr = byKey.get(key) || [];
    const done = lastOf(rr.filter((r) => r.val.status === 'done'), 'status');
    if (!done || (ctx.me && done.who !== ctx.me)) continue;
    if (rr.some((r) => r.val.review && r.date <= done.date)) continue;
    push('S9', { who: who(t), label: labelOfNode(t), text: `${fmtDate(done.date)} に完了。確認者 ${rv.join('・')} への確認の依頼(review:)の記録なし`, date: done.date, rec: done });
  }
  // S3 確認待ち・回答待ち(プロジェクト分析だけ)
  if (ctx.requests) for (const q of ctx.requests) {
    if (q.reply || today - q.date < th.S3) continue;
    push('S3', { who: `${q.from} → ${q.to}`, label: q.label, text: `${KIND_JA[q.kind]}の依頼から ${today - q.date} 日、返事なし${(ctx.errLog || []).includes(q.to) ? '(相手のマイログにエラーがあり、集計から外しています)' : (ctx.hasLog || []).includes(q.to) ? '' : '(相手のマイログがありません)'}`, date: q.date, rec: q.rec });
  }
  const order = (c) => +c.slice(1);
  const pi = (w) => { const i = people.indexOf(String(w).split(/ → |・/)[0]); return i < 0 ? people.length : i; };
  return out.map((s, i) => [s, i]).sort((a, b) => order(a[0].code) - order(b[0].code) || pi(a[0].who) - pi(b[0].who) || a[1] - b[1]).map((x) => x[0]);
  function who(t) { return memberNames(t.by).join('・') || '(担当なし)'; }
}

// ================= 表の描画(SVG の文字列) =================
const FONT = "'Hiragino Sans','Noto Sans JP','Yu Gothic UI','Meiryo','Segoe UI',sans-serif";
const COL = { accent: '#8b1a2b', line: '#333', grid: '#c8c8c4', head: '#f4f4f2', text: '#222', sub: '#666', blue: '#2b8fd8' };
const STATUS_FILL = { todo: '#fff', doing: COL.blue, done: '#bdbdb8', blocked: COL.accent };
// XML に書けない制御文字(タブ・改行を除く)は除く
const esc = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const charW = (ch, fs) => (/[\u0000-ɏ｡-ﾟ]/.test(ch) ? 0.6 : 1) * fs;
const textW = (s, fs) => [...s].reduce((a, ch) => a + charW(ch, fs), 0);
const NOHEAD = '、。，．,.)）」』】〕〉》・：；:;!！?？ー…'; // 行頭に置かない文字(行頭禁則。前の行の最後の文字ごと次の行へ送る)
function wrap(s, maxW, fs) {
  const out = [];
  for (const para of String(s).split('\n')) {
    let cur = '', w = 0;
    for (const tok of para.match(/[0-9A-Za-z][0-9A-Za-z.\-:/%]*|[^]/gu) || []) {
      const tw = textW(tok, fs);
      if (tok.length > 1 && tw <= maxW) {
        if (w + tw > maxW && cur) { out.push(cur); cur = ''; w = 0; }
        cur += tok; w += tw;
        continue;
      }
      for (const ch of tok) {
        const cw = charW(ch, fs);
        if (w + cw > maxW && cur) {
          // 行頭禁則: 送る文字が行頭に置けないときは、前の行の最後の文字も次の行へ送る
          // 送る文字の前も行頭に置けない文字なら、さらに前の文字まで送る(行は空にしない)
          if (NOHEAD.includes(ch) && [...cur].length > 1) { const k = [...cur]; const mv = []; do { mv.unshift(k.pop()); } while (k.length > 1 && NOHEAD.includes(mv[0])); out.push(k.join('')); cur = mv.join(''); w = textW(cur, fs); }
          else { out.push(cur); cur = ''; w = 0; }
        }
        cur += ch; w += cw;
      }
    }
    out.push(cur);
  }
  return out.length ? out : [''];
}
const T_ = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.fs ?? 13}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.fill ? ` fill="${o.fill}"` : ''}${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;
const wrapSvg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(w)}" height="${Math.ceil(h)}" viewBox="0 0 ${Math.ceil(w)} ${Math.ceil(h)}" font-family="${esc(FONT)}"><rect x="0" y="0" width="${Math.ceil(w)}" height="${Math.ceil(h)}" fill="#fff"/>${body}</svg>`;
const cleanSvg = (svg) => svg.replace(/<title>[\s\S]*?<\/title>/g, '').replace(/ data-[a-z-]+="[^"]*"/g, '');

// 文書の形のビュー。blocks: { t: 'h2', label } | { t: 'p', text, fill } | { t: 'table', name, cols: [{ h, max, right }], rows: [{ cells: [文字 | { t, fill, bg, weight }], ref: { start, end } }] } | { t: 'fig', id, label, draw: () => { frag, w, h } }
const M = 20, FS = 12, LH = 16, PADC = 6, W0 = 640;
function colWidths(b) {
  return b.cols.map((c, i) => {
    const vals = [c.h, ...b.rows.map((r) => { const v = r.cells[i]; return String(typeof v === 'object' && v !== null ? v.t : v ?? ''); })];
    const nat = Math.max(...vals.map((v) => Math.max(...String(v).split('\n').map((x) => textW(x, FS))))) + 2 * PADC + 2;
    return Math.max(c.min ?? 36, Math.min(c.max ?? 260, Math.ceil(nat)));
  });
}
// 表を描く。y は表の上端。戻り値 { frag, w, h }
function drawTable(b, x0, y0, rows = b.rows) {
  const ws = colWidths(b);
  const out = [];
  let x = x0, y = y0;
  const headLines = b.cols.map((c, i) => wrap(c.h, ws[i] - 2 * PADC, FS));
  const hh = Math.max(...headLines.map((l) => l.length)) * LH + 8;
  b.cols.forEach((c, i) => {
    out.push(`<rect x="${x}" y="${y}" width="${ws[i]}" height="${hh}" fill="${COL.head}" stroke="${COL.grid}"/>`);
    headLines[i].forEach((l, k) => out.push(T_(x + PADC, y + 4 + (k + 1) * LH - 4, l, { fs: FS, weight: '600' })));
    x += ws[i];
  });
  y += hh;
  for (const r of rows) {
    const cells = r.cells.map((v) => (typeof v === 'object' && v !== null ? v : { t: v ?? '' }));
    const lines = cells.map((v, i) => wrap(String(v.t), ws[i] - 2 * PADC, FS));
    const rh = Math.max(...lines.map((l) => l.length)) * LH + 8;
    let g = '';
    x = x0;
    cells.forEach((v, i) => {
      g += `<rect x="${x}" y="${y}" width="${ws[i]}" height="${rh}" fill="${v.bg ?? '#fff'}" stroke="${COL.grid}"/>`;
      const right = b.cols[i].right;
      lines[i].forEach((l, k) => { g += T_(right ? x + ws[i] - PADC : x + PADC, y + 4 + (k + 1) * LH - 4, l, { fs: FS, anchor: right ? 'end' : null, fill: v.fill, weight: v.weight }); });
      x += ws[i];
    });
    const f = r.ref;
    out.push(f ? `<g data-id="${f.start !== undefined ? `r${f.start}` : `k${esc(f.key ?? '')}`}"${f.start !== undefined ? ` data-start="${f.start}" data-end="${f.end}"` : ''}${f.act ? ` data-act="${f.act}"` : ''}${f.key !== undefined ? ` data-key="${esc(f.key)}" data-name="${esc(f.name ?? '')}"` : ''}${f.file !== undefined ? ` data-file="${f.file}" data-line="${f.line}"` : ''}>${r.title ? `<title>${esc(r.title)}</title>` : ''}${g}</g>` : g);
    y += rh;
  }
  return { frag: out.join(''), w: ws.reduce((a, c) => a + c, 0), h: y - y0 };
}
const tableText = (b) => ({ header: b.cols.map((c) => c.h), rows: b.rows.map((r) => r.cells.map((v) => String(typeof v === 'object' && v !== null ? v.t : v ?? ''))) });
// 文書を 1 枚の SVG に描く。戻り値 { svg, anchors, tables, figs }
function layout(blocks) {
  const out = [], anchors = [], tables = [], figs = [];
  let y = 8, w = W0;
  let h2 = null;
  for (const b of blocks) {
    if (b.t === 'h2') { y += 32; h2 = { label: b.label, y }; out.push(T_(M, y, b.label, { fs: 14, weight: '600' })); y += 10; continue; }
    if (b.t === 'p') { for (const l of wrap(b.text, W0 - 2 * M, FS)) { y += 18; out.push(T_(M, y, l, { fs: FS, fill: b.fill ?? COL.sub })); } continue; }
    if (b.t === 'table') {
      y += 6;
      const d = drawTable(b, M, y);
      out.push(d.frag);
      if (h2) anchors.push({ kind: 'table', name: b.name, label: h2.label, y: h2.y, fs: 14 });
      tables.push({ name: b.name, caption: b.caption, ...tableText(b), frag: d.frag, box: [M, y, d.w, d.h] });
      w = Math.max(w, d.w + 2 * M);
      y += d.h; h2 = null;
      continue;
    }
    if (b.t === 'fig') {
      y += 8;
      const d = b.draw();
      out.push(`<g transform="translate(${M},${y})">${d.frag}</g>`);
      if (h2) anchors.push({ kind: 'fig', id: b.id, label: h2.label, y: h2.y, fs: 14 });
      figs.push({ id: b.id, label: h2 ? h2.label : '', frag: d.frag, w: d.w, h: d.h });
      w = Math.max(w, d.w + 2 * M);
      y += d.h; h2 = null;
    }
  }
  return { svg: wrapSvg(w, y + M, out.join('')), anchors, tables, figs };
}
// 図と表を 1 つずつ(保存・コピー用)。表には題を入れない。図には題を入れる
function piecesOf(lay) {
  const PAD = 20;
  return {
    // 表の画像には題を入れない。caption のある表(要確認)だけ、表の上に 1 行を入れる(画像だけを保存しても、どの日の判定かわかるように)
    tables: lay.tables.map((t) => {
      const [x0, y0, w, h] = t.box, ch = t.caption ? 24 : 0;
      const cap = t.caption ? T_(PAD, PAD + 12, t.caption, { fs: 12 }) : '';
      return { name: t.name, header: t.header, rows: t.rows, svg: cleanSvg(wrapSvg(Math.max(w, t.caption ? textW(t.caption, 12) : 0) + 2 * PAD, h + 2 * PAD + ch, `${cap}<g transform="translate(${PAD - x0},${PAD - y0 + ch})">${t.frag}</g>`)) };
    }),
    figs: lay.figs.map((f) => ({ id: f.id, svg: cleanSvg(wrapSvg(Math.max(f.w, textW(f.label, 14)) + 2 * PAD, f.h + 2 * PAD + 26, T_(PAD, PAD + 14, f.label, { fs: 14, weight: '600' }) + `<g transform="translate(${PAD},${PAD + 26})">${f.frag}</g>`)) })),
  };
}
function tsv(t) { const c = (v) => String(v).replace(/[\t\r\n]+/g, ' '); return `${[t.header, ...t.rows].map((row) => row.map(c).join('\t')).join('\n')}\n`; }
// 印刷のページ(縦向き)。高さが幅の 1.45 倍を超える文書は、表を行で区切って分ける
function printPages(blocks) {
  const pages = [];
  let cur = [];
  const heightOf = (bs) => { const s = layout(bs).svg; const m = /height="(\d+)"/.exec(s); return +m[1]; };
  const widthOf = (bs) => { const s = layout(bs).svg; const m = /width="(\d+)"/.exec(s); return +m[1]; };
  const fits = (bs) => heightOf(bs) <= Math.max(W0, widthOf(bs)) * 1.45;
  const flush = () => { if (cur.length) pages.push(layout(cur).svg); cur = []; };
  // 題と表を組にして扱う。幅の広い表(縦の紙で半分より小さく縮むもの)は、先頭の列(keep 列。既定 1)を残して列でページを分ける
  const WMAX = 2 * W0;
  const units = [];
  const pushUnit = (h, t) => {
    const ws = colWidths(t), keep = Math.min(t.keep ?? 1, t.cols.length - 1);
    if (ws.reduce((x, y) => x + y, 0) + 2 * M <= WMAX || t.cols.length <= keep + 1) { units.push(h ? [h, t] : [t]); return; }
    const head = ws.slice(0, keep).reduce((x, y) => x + y, 0);
    const groups = [];
    let g = [], w = head;
    for (let i = keep; i < t.cols.length; i++) {
      if (g.length && w + ws[i] + 2 * M > WMAX) { groups.push(g); g = []; w = head; }
      g.push(i); w += ws[i];
    }
    if (g.length) groups.push(g);
    groups.forEach((gi, k) => {
      const idx = [...Array(keep).keys(), ...gi];
      const part = { ...t, cols: idx.map((i) => t.cols[i]), rows: t.rows.map((r) => ({ ...r, cells: idx.map((i) => r.cells[i]) })) };
      const label = `${h ? h.label : t.name}(列 ${k + 1}/${groups.length})`;
      units.push([{ t: 'h2', label }, part]);
    });
  };
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.t === 'h2' && blocks[i + 1] && (blocks[i + 1].t === 'table' || blocks[i + 1].t === 'fig')) { if (blocks[i + 1].t === 'table') pushUnit(b, blocks[i + 1]); else units.push([b, blocks[i + 1]]); i++; }
    else if (b.t === 'table') pushUnit(null, b);
    else units.push([b]);
  }
  for (const u of units) {
    if (fits([...cur, ...u])) { cur.push(...u); continue; }
    flush();
    if (fits(u) || u[u.length - 1].t !== 'table') { cur.push(...u); continue; }
    // 表を行で区切る(続きのページの題は「(続き)」)
    const [h, t] = u.length === 2 ? u : [null, u[0]];
    let rows = t.rows.slice(), first = true;
    while (rows.length) {
      let n = 1;
      while (n < rows.length && fits([...(h ? [{ t: 'h2', label: first ? h.label : `${h.label}(続き)` }] : []), { ...t, rows: rows.slice(0, n + 1) }])) n++;
      cur.push(...(h ? [{ t: 'h2', label: first ? h.label : `${h.label}(続き)` }] : []), { ...t, rows: rows.slice(0, n) });
      flush();
      rows = rows.slice(n); first = false;
    }
  }
  flush();
  return pages;
}

// ---- 図: 週ごとの合計の棒(マイログの仕様書 7.3 節)
function barChart(items, unit) {
  const H = 160, BW = 34, GAP = 14, LM = 44, TOP = 24;
  const max = Math.max(1, ...items.map((x) => x.v));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const w = LM + items.length * (BW + GAP) + GAP, h = TOP + H + 30;
  const out = [T_(LM - 6, 12, `(${unit})`, { fs: 11, anchor: 'end', fill: COL.sub })];
  for (let v = 0; v <= top + 1e-9; v += step) {
    const y = TOP + H - v / top * H;
    out.push(`<path d="M${LM} ${y}H${w}" stroke="${COL.grid}"/>`, T_(LM - 6, y + 4, String(+v.toFixed(2)), { fs: 11, anchor: 'end', fill: COL.sub }));
  }
  items.forEach((x, i) => {
    const bx = LM + GAP + i * (BW + GAP), bh = x.v / top * H;
    out.push(`<rect x="${bx}" y="${TOP + H - bh}" width="${BW}" height="${bh}" fill="#bdbdb8" stroke="${COL.line}"/>`);
    if (x.v > 0) out.push(T_(bx + BW / 2, TOP + H - bh - 4, String(x.label2), { fs: 11, anchor: 'middle' }));
    out.push(T_(bx + BW / 2, TOP + H + 16, x.label, { fs: 11, anchor: 'middle' }));
  });
  out.push(`<path d="M${LM} ${TOP + H}H${w}" stroke="${COL.line}"/>`);
  return { frag: out.join(''), w, h };
}
function niceStep(max) { const raw = max / 4; const p = 10 ** Math.floor(Math.log10(raw)); const k = raw / p; return (k <= 1 ? 1 : k <= 2 ? 2 : k <= 5 ? 5 : 10) * p; }

// ================= マイログのビュー(マイログの仕様書 7 章) =================
const VIEWS = [
  { id: 'summary', label: 'サマリー' },
  { id: 'mytasks', label: 'タスク' },
  { id: 'gantt', label: 'ガントチャート' },
  { id: 'week', label: '週のまとめ' },
  { id: 'hours', label: '作業時間' },
  { id: 'tests', label: 'テスト・TRL・TPM' },
];
const refOf = (r) => (r ? { start: r.start, end: r.end } : null);
const stCell = (st) => (st ? { t: STATUS[st], bg: STATUS_FILL[st], fill: st === 'doing' || st === 'blocked' ? '#fff' : null } : '―');
// 記録先の並び(仕様書 7.3 節): 最新の版の WBS の木の順、FBS の木の順、最後に計画にない作業(と以前の版の名前)を最初に書いた順
function keyOrder(keys, L, recs) {
  const pos = new Map();
  if (L) { let i = 0; for (const n of [...(L.r.bySec.WBS || []), ...(L.r.bySec.FBS || [])]) pos.set(keyOf(n), i++); }
  const first = new Map();
  recs.forEach((r, i) => { if (!first.has(r.key)) first.set(r.key, i); });
  return [...keys].sort((a, b) => (pos.has(a) ? pos.get(a) : 1e9 + first.get(a)) - (pos.has(b) ? pos.get(b) : 1e9 + first.get(b)));
}
const dispKey = (rr, L) => { const r = rr[rr.length - 1]; return !L ? r.label : r.gone ? `${r.label}(計画から削除)` : r.planned === false ? `${r.label}(計画にない作業)` : r.label; };
function weeksOf(recs, ws, until) {
  if (!recs.length) return [];
  const a = weekOf(recs[0].date, ws), b = weekOf(until ?? recs[recs.length - 1].date, ws);
  const out = [];
  for (let w = a; w <= b; w += 7) out.push(w);
  return out;
}

// ---- 担当のタスク(マイログの仕様書 7.1 節)
// 最新の版のタスク t の今の様子(マイログの仕様書 7.1 節・プロジェクト分析の仕様書 6.9 節)。me があれば、時間・確認の結果は me の記録だけで数える
function taskInfo(L, byKey, today, t, me) {
  const key = keyOf(t), rr = byKey.get(key) || [];
  const st = lastStatus(rr, memberNames(t.by));
  const status = st ? st.val.status : t.status ?? 'todo';
  const s = L.r.sched.start + t.d0, e = endOf(L, t);
  const mineR = me ? rr.filter((r) => r.who === me) : rr;
  // 始めた日(7.3 節): 初めて hours: を書いた日と、初めて実行中・完了・問題発生を報告した日の早い方。メモだけの記録は数えない
  const begun = rr.find((r) => r.val.hours || (r.val.status && r.val.status !== 'todo'));
  // 確認待ち(7.1 節): 最後の review: が最後の状態の報告と同じか後にあり、完了と報告していない
  const lastRv = lastOf(rr.filter((r) => r.val.review), 'review');
  // 依頼した相手の全員が、依頼の日以降に確認の結果(reviewed:)を書いていれば、確認待ちは終わる(相手の記録が読めるプロジェクト分析のとき)
  const replied = !!lastRv && lastRv.val.review.every((to) => rr.some((r) => r.who === to && r.val.reviewed !== undefined && r.date >= lastRv.date));
  const rvw = status !== 'done' && !!lastRv && (!st || cmp(lastRv, st) >= 0) && !replied;
  return { t, key, st, begun: begun ? begun.date : null, rvw, label: labelOfNode(t), name: rr.length ? rr[rr.length - 1].name : shortName(t, index(L).wbs), status, s, e, late: e < today && status !== 'done', pg: lastProgress(rr, memberNames(t.by)), last: rr.length ? rr[rr.length - 1] : null, hrs: mineR.reduce((x, r) => x + (r.val.hours || 0), 0), hd: new Set(mineR.filter((r) => r.val.hours).map((r) => r.date)).size, rv: lastOf(mineR.filter((r) => r.val.reviewed !== undefined), 'reviewed') };
}
// 区分(7.1 節): 遅延 → 問題発生 → 開始予定日を過ぎた未着手 → 実行中 → 開始予定日がまだ先 → 完了 の順に判定して、1 つに決める
const catOf = (x, today) => (x.late ? 'late' : x.status === 'blocked' ? 'blocked' : x.status === 'todo' && x.s <= today ? 'overstart' : x.status === 'doing' ? 'doing' : x.status === 'todo' ? 'future' : 'done');
function myTasks(a, recs, byKey, today) {
  const L = a.latest, me = a.who;
  const out = { tasks: [], review: [], cat: Object.fromEntries(CATS.map((c) => [c.id, []])) };
  if (!L) return out;
  const order = new Map(L.r.bySec.WBS.map((n, i) => [n, i]));
  const info = (t) => taskInfo(L, byKey, today, t, me);
  const sortT = (list) => list.sort((x, y) => x.s - y.s || order.get(x.t) - order.get(y.t));
  out.tasks = sortT(L.r.tasks.filter((t) => memberNames(t.by).includes(me)).map(info));
  out.review = sortT(L.r.tasks.filter((t) => memberNames(t.review).includes(me) && !memberNames(t.by).includes(me)).map(info));
  for (const x of out.tasks) out.cat[catOf(x, today)].push(x);
  return out;
}
// 区分の表の並び(7.1 節): 対応が要る区分(遅延・問題発生・開始予定日を過ぎた未着手)を、実行中のすぐ下にまとめる
const CATS = [
  { id: 'doing', label: '実行中のタスク', short: '実行中' },
  { id: 'late', label: '遅延のタスク', short: '遅延' },
  { id: 'blocked', label: '問題発生のタスク', short: '問題発生' },
  { id: 'overstart', label: '開始予定日を過ぎた未着手のタスク', short: '開始予定日を過ぎた未着手' },
  { id: 'future', label: '開始予定日がまだ先のタスク', short: '開始予定日がまだ先' },
  { id: 'done', label: '完了したタスク', short: '完了' },
];
// 未解決の問題(4.3 節)。日数によらず、すべて。戻り値は [{ r, kind: 'issue' | 'blocked' }](記録の順)
// solved: は、同じ記録先か同じ名前(書いたままの名前。名前が変わる前の問題も閉じられるように)の、それより後の記録なら閉じる。
// 同じ日なら、同じマイログでは後ろの行、別の人のマイログでは行の順によらず後とみなす(プロジェクト分析で一覧の順によって結果が変わらないように)
function openProblems(recs, L) {
  const solved = recs.filter((x) => x.val.solved !== undefined);
  const after = (x, r) => x.date > r.date || (x.date === r.date && ((x.fi ?? 0) !== (r.fi ?? 0) || cmp(x, r) > 0));
  const closers = (r) => solved.filter((x) => (x.key === r.key || x.name === r.name) && after(x, r));
  const out = [];
  for (const [, rr] of groupByKey(recs)) {
    const open = new Set();
    for (const r of rr) if (r.val.issue !== undefined && !closers(r).length) { out.push({ r, kind: 'issue' }); open.add(r); }
    // status: blocked は、ほかの状態か solved: で閉じる。最後の状態が問題発生のとき、その続きの最初の blocked から。
    // 日ごとの状態は、その日までの人ごとの最後の報告でまとめた状態(4.2 節。一覧の順によらない)
    let run = [];
    const sr = authorRecs(rr.filter((r) => r.val.status !== undefined), authorsOf(L, rr[0].key)); // 作成者の記録だけ(4.2 節)
    for (const { date: d, v } of timeline(sr, 'status', combineStatus)) {
      const dr = sr.filter((r) => r.date === d);
      if (v === 'blocked') {
        // その日の blocked のうち、続きに入るもの: 同じマイログでは、その日の最後の別の状態より後ろの blocked
        for (const r of dr) if (r.val.status === 'blocked' && !dr.some((x) => (x.fi ?? 0) === (r.fi ?? 0) && x.val.status !== 'blocked' && cmp(x, r) > 0)) run.push(r);
      } else run = [];
    }
    run.sort(cmp);
    let since = run[0] || null;
    while (since) {
      const c = closers(since);
      if (!c.length) break;
      const lc = c.reduce((a, b) => (after(b, a) ? b : a));
      const cur = since;
      // 閉じた後の blocked は、閉じた solved: より後で、いまの blocked より記録の順で後ろのもの(同じ blocked に戻らないように)
      since = run.find((r) => cmp(r, cur) > 0 && after(r, lc)) || null;
    }
    if (since && !open.has(since)) out.push({ r: since, kind: 'blocked' });
  }
  return out.sort((a, b) => cmp(a.r, b.r));
}
function openIssues(byKey) { return openProblems([...byKey.values()].flat().sort(cmp)).map((x) => x.r); }
// ガントチャート(7.4 節)
function myGantt(my, recs, today) {
  const DW = 18, RH = 26, LW = 300, TOP = 44;
  const worked = new Map();
  for (const r of recs) if (r.val.hours) { if (!worked.has(r.key)) worked.set(r.key, new Set()); worked.get(r.key).add(r.date); }
  // 期間の始まりは、担当のタスクの予定の始まりと、担当のタスクに hours: を書いた最初の日(担当外の記録は入れない)
  const keys = new Set(my.tasks.map((x) => keyOf(x.t)));
  const firstRec = Math.min(Infinity, ...recs.filter((r) => r.val.hours && keys.has(r.key)).map((r) => r.date));
  const d0 = Math.min(...my.tasks.map((x) => x.s), firstRec);
  const d1 = Math.max(...my.tasks.map((x) => x.e), today);
  const n = d1 - d0 + 1;
  if (n > 1096) return { error: `図の期間が ${n} 日あり、長すぎるので描きません(日付の打ち間違いがないか確かめてください)` };
  const gx = LW, out = [];
  // 目盛り: 月・日の 2 段
  let lastM = null;
  for (let i = 0; i < n; i++) {
    const ds = fmtDate(d0 + i), x = gx + i * DW;
    if (ds.slice(5, 7) !== lastM) { lastM = ds.slice(5, 7); out.push(T_(x + 2, 14, `${+lastM} 月`, { fs: 11, fill: COL.sub }), `<path d="M${x} 0V${TOP + my.tasks.length * RH}" stroke="${COL.grid}"/>`); }
    out.push(T_(x + DW / 2, 34, String(+ds.slice(8)), { fs: 10, anchor: 'middle', fill: COL.sub }));
  }
  out.push(`<path d="M0 ${TOP}H${gx + n * DW}" stroke="${COL.line}"/>`);
  my.tasks.forEach((x, k) => {
    const y = TOP + k * RH;
    out.push(`<path d="M0 ${y + RH}H${gx + n * DW}" stroke="${COL.grid}"/>`);
    const num = `${x.t.num} `, room = LW - 12 - textW(num, 12);
    let s = x.label;
    if (textW(s, 12) > room) { while (s.length > 1 && textW(`…${s}`, 12) > room) s = s.slice(1); s = `…${s}`; }
    out.push(`<g><title>${esc(`${x.t.num} ${x.label}`)}</title>${T_(4, y + 17, num + s, { fs: 12 })}</g>`);
    const bx = gx + (x.s - d0) * DW, bw = (x.e - x.s + 1) * DW;
    out.push(`<rect x="${bx}" y="${y + 5}" width="${bw}" height="12" ${x.status === 'todo' ? `fill="#fff" stroke="${COL.line}"` : `fill="${STATUS_FILL[x.status]}" stroke="${COL.line}" stroke-width="0.5"`}/>`);
    for (const d of worked.get(x.key) || []) out.push(`<circle cx="${gx + (d - d0) * DW + DW / 2}" cy="${y + 21.5}" r="2.5" fill="${COL.line}"/>`);
    if (x.late) out.push(`<circle cx="${bx + bw - 1}" cy="${y + 5}" r="4" fill="${COL.accent}" stroke="#fff" stroke-width="1"/>`);
  });
  const tx = gx + (today - d0) * DW;
  out.push(`<path d="M${tx} ${TOP - 4}V${TOP + my.tasks.length * RH}" stroke="${COL.accent}" stroke-width="1.5"/>`);
  return { frag: out.join(''), w: gx + n * DW + 4, h: TOP + my.tasks.length * RH + 4 };
}

// ---- 今週の予定(7.2 節): 予定の期間が今週にかかる担当のタスク
function weekPlan(my, today, ws) {
  const w0 = weekOf(today, ws), w1 = w0 + 6;
  return { w0, w1, list: my.tasks.filter((x) => x.s <= w1 && x.e >= w0).map((x) => ({ x, a: Math.max(x.s, w0), b: Math.min(x.e, w1) })) };
}
// ---- 計画の変更のうち自分に関係するもの(7.2 節): 照合に使える版の最後の 2 つを、対応名で比べる
function planChanges(a) {
  const V = a.V || [], me = a.who;
  if (V.length < 2) return null;
  // 最新の版と、それより前の日付の最後の版を比べる(同じ日付の途中の保存は比べない)。前の日付の版がなければ 1 つ前の版
  const B = V[V.length - 1];
  const A = V.slice(0, -1).filter((x) => x.date < B.date).pop() ?? V[V.length - 2];
  const map = (e) => new Map(e.r.tasks.map((t) => [keyOf(t), t]));
  const ta = map(A), tb = map(B);
  // 2 つの版の要素の対応(5.6 節。対応名が同じもの・移動)。名前の変更は対応しない
  const fw = verMap(A, B), bw = new Map([...fw].map(([x, y]) => [y, x]));
  // タスクでなくなっても、要素が残っていれば「計画から削除」とはしない(子を足して途中の要素になった など)
  const nodeIn = (e, k) => (k ? index(e).byKey.get(k) || null : null);
  const has = (t, k) => !!t && memberNames(t[k]).includes(me);
  const names = (t, k) => memberNames(t[k]).join('・') || '(なし)';
  const span = (e, t) => { const x = e.r.sched.start + t.d0, y = e.r.sched.start + t.d1; return x === y ? mmdd(x) : `${mmdd(x)}〜${mmdd(y)}`; };
  const parentOf = (n) => (n.parent && n.parent.parent ? labelOfNode(n.parent) : '(根)');
  const rows = [];
  const add = (kind, t, text) => rows.push({ kind, label: labelOfNode(t), text });
  for (const [k, t] of tb) {
    const k0 = bw.get(k) ?? null;
    const o = ta.get(k0) || nodeIn(A, k0);
    if (o && k0 !== k && (has(t, 'by') || has(o, 'by') || has(t, 'review') || has(o, 'review'))) add('移動', t, `親: ${parentOf(o)} → ${parentOf(t)}`);
    if (has(t, 'by') && !has(o, 'by')) add('作成者の追加', t, o ? `作成者: ${names(o, 'by')} → ${names(t, 'by')}` : `計画に追加(${span(B, t)}、${P.fmtDays(t.days)} 日)`);
    else if (has(t, 'by') && has(o, 'by') && ta.has(k0)) {
      const s0 = span(A, o), s1 = span(B, t);
      // 最新の版で完了のタスクは出さない(完了のタスクは版の日付の下限がなく、日程が前へ詰まることがあるため。7.2 節)
      if ((s0 !== s1 || o.days !== t.days) && t.status !== 'done') add('日程の変更', t, `${s0} → ${s1}${o.days !== t.days ? `(日数 ${P.fmtDays(o.days)} → ${P.fmtDays(t.days)})` : ''}`);
    }
    if (has(t, 'review') && !has(o, 'review')) add('確認者の追加', t, o ? `確認者: ${names(o, 'review')} → ${names(t, 'review')}` : `計画に追加(作成者: ${names(t, 'by')})`);
  }
  for (const [k, o] of ta) {
    const k1 = fw.get(k) ?? null;
    const t = tb.get(k1) || nodeIn(B, k1);
    if (has(o, 'by') && !has(t, 'by')) add('作成者の削除', o, t ? `作成者: ${names(o, 'by')} → ${names(t, 'by')}` : '計画から削除');
    if (has(o, 'review') && !has(t, 'review')) add('確認者の削除', o, t ? `確認者: ${names(o, 'review')} → ${names(t, 'review')}` : '計画から削除');
  }
  const KO = ['作成者の追加', '作成者の削除', '日程の変更', '確認者の追加', '確認者の削除', '移動'];
  rows.sort((x, y) => KO.indexOf(x.kind) - KO.indexOf(y.kind));
  return { A, B, rows };
}
// ---- 担当するテスト項目(7.6 節): 担当のタスクの対象(for:)の PBS の要素が実現する(realizes:)機能の MOP
function myTests(a, my, byKey) {
  const L = a.latest, fs = new Map();
  for (const x of my.tasks) for (const pn of x.t.for || []) for (const f of (pn.R && pn.R.realizes) || []) { if (!fs.has(f)) fs.set(f, []); if (!fs.get(f).includes(x.t.num)) fs.get(f).push(x.t.num); }
  const rows = [];
  for (const f of L.r.bySec.FBS || []) {
    if (!fs.has(f)) continue;
    const rr = (byKey.get(keyOf(f)) || []).filter((r) => r.val.test);
    const nums = fs.get(f).join('、');
    if (!f.mops.length) { rows.push({ cells: [labelOfNode(f), '(MOP なし)', '', '―', nums] }); continue; }
    f.mops.forEach((m, i) => {
      const last = lastTest(rr.filter((r) => r.val.mop === m.trim()));
      rows.push({ cells: [labelOfNode(f), m, f.mopChecked[i] ? '✓' : '', last ? `${last.val.test}(${fmtDate(last.date)})` : '未実施', nums], ref: last ? refOf(last) : null });
    });
  }
  return rows;
}
// ---- 記録のカレンダー(7.5 節): 週を行、曜日を列にして、日ごとの時間を書く
const WD_JA = ['日', '月', '火', '水', '木', '金', '土'];
function calendar(recs, today, ws) {
  const hrs = new Map(), any = new Set();
  for (const r of recs) { any.add(r.date); if (r.val.hours) hrs.set(r.date, (hrs.get(r.date) ?? 0) + r.val.hours); }
  const ds = recs.map((r) => r.date);
  const d0 = weekOf(Math.min(today, ...ds), ws), d1 = weekOf(Math.max(today, ...ds), ws) + 6;
  if (d1 - d0 + 1 > 1092) return { error: `期間が ${d1 - d0 + 1} 日あり、長すぎるので描きません(156 週まで)` };
  const CW = 54, CH = 38, TOP = 20, out = [];
  for (let k = 0; k < 7; k++) out.push(T_(k * CW + CW / 2, 14, WD_JA[(ws + k) % 7], { fs: 11, anchor: 'middle', fill: COL.sub }));
  const nW = (d1 - d0 + 1) / 7;
  for (let w = 0; w < nW; w++) for (let k = 0; k < 7; k++) {
    const d = d0 + w * 7 + k, x = k * CW, y = TOP + w * CH, h = hrs.get(d) ?? 0;
    const fill = h >= 500 ? '#9a9a96' : h >= 200 ? '#c8c8c4' : h > 0 ? '#e6e6e2' : '#fff';
    out.push(`<rect x="${x}" y="${y}" width="${CW}" height="${CH}" fill="${fill}" stroke="${COL.grid}"/>`);
    out.push(T_(x + 4, y + 12, `${+fmtDate(d).slice(5, 7)}/${+fmtDate(d).slice(8)}`, { fs: 10, fill: COL.sub }));
    if (h) out.push(T_(x + CW - 4, y + CH - 6, fmtH(h), { fs: 12, anchor: 'end' }));
    else if (any.has(d)) out.push(T_(x + CW - 4, y + CH - 6, '記録', { fs: 10, anchor: 'end', fill: COL.sub }));
    if (d === today) out.push(`<rect x="${x + 1}" y="${y + 1}" width="${CW - 2}" height="${CH - 2}" fill="none" stroke="${COL.accent}" stroke-width="2"/>`);
  }
  return { frag: out.join(''), w: 7 * CW + 2, h: TOP + nW * CH + 2 };
}
// ---- 週のまとめ(7.7 節): 選べる週(新しい順)。最初の記録の週から、今週か最後の記録の週まで
function weekOptions(a, today) {
  const ws = WD.indexOf(a.set && a.set.week ? a.set.week.value : 'mon');
  const ds = [...(a.recs || []).map((r) => r.date), ...(a.days || []).map((d) => d.date)];
  const out = [];
  for (let w = weekOf(Math.max(today, ...ds), ws), w0 = weekOf(Math.min(today, ...ds), ws); w >= w0 && out.length < 520; w -= 7) out.push(w);
  return out;
}

function blocksMy(a, view, ctx) {
  const L = a.latest, today = ctx.today, th = { ...TH_DEFAULT, ...(ctx.th || {}) };
  const ws = WD.indexOf(a.set.week ? a.set.week.value : 'mon');
  const logs = [{ who: a.who, recs: a.recs }];
  const recs = allRecs(logs);
  const byKey = groupByKey(recs);
  const B = [];
  const my = myTasks(a, recs, byKey, today);
  const noPlan = { t: 'p', text: (a.plans || []).length ? '計画書の一覧に、照合に使える版(エラーがなく version: のある版)がありません。計画書の一覧の各版の知らせを見てください' : '計画書を追加すると、担当のタスクが出ます(「計画書を追加」で .plan・.plans を読み込みます)', fill: COL.accent };
  // タスクの行: 番号・タスク・予定の期間・(日数・計画の状態)・今の状態・進捗率・…。行を押すと「今日の記録」(11.4 節)
  const taskRef = (x) => ({ ...(x.last ? refOf(x.last) : {}), act: 'task', key: x.key, name: x.name });
  const period = (x) => (x.s === x.e ? mmdd(x.s) : `${mmdd(x.s)}〜${mmdd(x.e)}`); // 1 日だけなら「MM-DD」(プロジェクト分析と同じ)
  const stNow = (x) => (x.rvw ? { ...stCell(x.status), t: `${STATUS[x.status]}(確認待ち)` } : stCell(x.status));
  const nowCols = [{ h: 'WBS 番号' }, { h: 'タスク', max: 280 }, { h: '予定の期間' }, { h: '今の進捗' }, { h: '進捗率', right: true }];
  const nowRow = (x) => ({ cells: [x.t.num, x.label, period(x), stNow(x), x.pg ? `${x.pg.val.progress} %` : '―'], ref: taskRef(x) });
  const reviewTable = (name) => ({ t: 'table', name, cols: [{ h: 'タスク', max: 280 }, { h: '作成者' }, { h: '終了予定日' }, { h: '計画の進捗' }, { h: '確認の結果' }], rows: my.review.map((x) => ({ cells: [x.label, memberNames(x.t.by).join('・') || '(担当なし)', fmtDate(x.e), STATUS[x.t.status ?? 'todo'], x.rv ? `${x.rv.val.reviewed}(${fmtDate(x.rv.date)})` : '―'], ref: x.rv ? refOf(x.rv) : null })) });
  if (view === 'summary') {
    const sig = signals(logs, { L, today, th, ws, me: a.who });
    B.push({ t: 'h2', label: `サマリー(${fmtDate(today)})` });
    if (L) {
      B.push({ t: 'p', text: `今日 ${fmtDate(today)}。計画書: ${labels(a.plans).get(L)}(${L.name})。担当のタスク ${my.tasks.length} 件(${CATS.map((c) => `${c.short} ${my.cat[c.id].length}`).join('、')})。確認するタスク ${my.review.length} 件。`, fill: COL.text });
      // 区分ごとの件数を 1 つの表にまとめる(7.2 節)。タスクの詳しい内容は、タスクのビューで見る
      B.push({ t: 'h2', label: 'タスクの区分' });
      B.push({ t: 'table', name: 'タスクの区分', cols: [{ h: '区分' }, { h: '件数', right: true }, { h: '日数', right: true }, { h: 'タスク(WBS 番号)', max: 360 }],
        rows: CATS.map((c) => { const list = my.cat[c.id]; return { cells: [c.short, String(list.length), P.fmtDays(list.reduce((x, y) => x + y.t.days, 0)), c.id === 'done' ? '―' : list.map((x) => (c.id === 'late' ? `${x.t.num}(${today - x.e} 日)` : x.t.num)).join('、') || '―'] }; }) });
      const wp = weekPlan(my, today, ws);
      B.push({ t: 'h2', label: `今週の予定(${mmdd(wp.w0)}〜${mmdd(wp.w1)})` });
      if (wp.list.length) B.push({ t: 'table', name: '今週の予定', cols: [{ h: 'WBS 番号' }, { h: 'タスク', max: 280 }, { h: '予定の期間' }, { h: '今週の日' }, { h: '今の進捗' }], rows: wp.list.map(({ x, a: d0, b: d1 }) => ({ cells: [x.t.num, x.label, period(x), d0 === d1 ? mmdd(d0) : `${mmdd(d0)}〜${mmdd(d1)}`, stNow(x)], ref: taskRef(x) })) });
      else B.push({ t: 'p', text: 'なし', fill: COL.text });
      const pc = planChanges(a);
      B.push({ t: 'h2', label: pc ? `計画の変更(${labels(a.plans).get(pc.A)} → ${labels(a.plans).get(pc.B)})` : '計画の変更' });
      if (!pc) B.push({ t: 'p', text: '照合に使える版が 1 つだけなので、比べられません', fill: COL.text });
      else if (!pc.rows.length) B.push({ t: 'p', text: '作成者・確認者・日程の変更はありません', fill: COL.text });
      else B.push({ t: 'table', name: '計画の変更', cols: [{ h: '変更' }, { h: 'タスク', max: 280 }, { h: '内容', max: 300 }], rows: pc.rows.map((x) => ({ cells: [x.kind, x.label, x.text] })) });
    } else B.push(noPlan);
    B.push({ t: 'h2', label: '未解決の問題' });
    const open = openIssues(byKey).filter((r) => r.date <= today); // 今日より後の日付の記録は数えない(兆候と同じ)
    if (open.length) B.push({ t: 'table', name: '未解決の問題', cols: [{ h: '記録先', max: 260 }, { h: '内容', max: 300 }, { h: '日付' }, { h: '日数', right: true }], rows: open.map((r) => ({ cells: [r.label, r.val.issue ?? '問題発生(status: blocked)', fmtDate(r.date), `${today - r.date} 日`], ref: { ...refOf(r), act: 'solve' } })) });
    else B.push({ t: 'p', text: 'なし', fill: COL.text });
    B.push({ t: 'h2', label: `要確認(${fmtDate(today)})` });
    const thText = `規則の値: S1 ${th.S1} 日、S2 ${th.S2} 日、S5 ${th.S5} 日、S7 ${th.S7} %、S8 ${th.S8} 日。`;
    B.push({ t: 'p', text: thText });
    if (!L) B.push({ t: 'p', text: `${(a.plans || []).length ? '照合に使える版があると' : '計画書を読み込むと'}判定する兆候: S1・S4・S5・S7・S9`, fill: COL.accent });
    if (sig.length) B.push({ t: 'table', name: `要確認(${fmtDate(today)})`, caption: `今日 ${fmtDate(today)}。${thText}`, cols: [{ h: '兆候', max: 200 }, { h: '記録先', max: 220 }, { h: '内容', max: 360 }, { h: '日付' }], rows: sig.map((x) => ({ cells: [`${x.code} ${SIG_NAME[x.code]}`, x.label, x.text, x.date === null ? '―' : fmtDate(x.date)], ref: x.rec ? { ...refOf(x.rec), act: x.code === 'S2' ? 'solve' : undefined } : null })) });
    else B.push({ t: 'p', text: '兆候はありません', fill: COL.text });
    const q = requests(logs, null, false);
    B.push({ t: 'h2', label: '出した依頼' });
    B.push({ t: 'p', text: '返事があったかは、プロジェクト分析で突き合わせます。' });
    if (q.length) B.push({ t: 'table', name: '出した依頼', cols: [{ h: '日付' }, { h: '種類' }, { h: '相手' }, { h: '記録先', max: 300 }], rows: q.map((x) => ({ cells: [fmtDate(x.date), KIND_JA[x.kind], x.to, x.label], ref: refOf(x.rec) })) });
    else B.push({ t: 'p', text: 'なし', fill: COL.text });
    if (L) {
      B.push({ t: 'h2', label: '確認するタスク' });
      if (my.review.length) B.push(reviewTable('確認するタスク')); else B.push({ t: 'p', text: 'なし', fill: COL.text });
    }
    return B;
  }
  if (view === 'mytasks') {
    const fullCols = [{ h: 'WBS 番号' }, { h: 'タスク', max: 260 }, { h: '予定の期間' }, { h: '始めた日' }, { h: '日数', right: true }, { h: '作業日数', right: true }, { h: '計画の進捗' }, { h: '今の進捗' }, { h: '進捗率', right: true }, { h: '合計時間', right: true }, { h: '最後の記録' }];
    const fullRow = (x) => ({ cells: [x.t.num, x.label, period(x), x.begun === null ? '―' : mmdd(x.begun), P.fmtDays(x.t.days), x.hd ? String(x.hd) : '―', STATUS[x.t.status ?? 'todo'], stNow(x), x.pg ? `${x.pg.val.progress} %` : '―', x.hrs ? fmtH(x.hrs) : '―', x.last ? fmtDate(x.last.date) : '記録なし'], ref: taskRef(x) });
    if (L) {
      for (const c of CATS) {
        const list = my.cat[c.id];
        B.push({ t: 'h2', label: `${c.label}(${list.length} 件)` });
        if (list.length) B.push({ t: 'table', name: c.label, cols: c.id === 'late' ? [...fullCols, { h: '遅延', right: true }] : fullCols, rows: list.map((x) => { const r = fullRow(x); if (c.id === 'late') r.cells.push({ t: `${today - x.e} 日`, fill: COL.accent }); return r; }) });
        else B.push({ t: 'p', text: 'なし', fill: COL.text });
      }
      B.push({ t: 'h2', label: `確認するタスク(${my.review.length} 件)` });
      if (my.review.length) B.push(reviewTable('確認するタスク')); else B.push({ t: 'p', text: 'なし', fill: COL.text });
    } else B.push({ t: 'h2', label: 'タスク' }, noPlan);
    const mine = new Set([...my.tasks, ...my.review].map((x) => x.key));
    const keys = keyOrder([...byKey.keys()].filter((k) => !mine.has(k)), L, recs);
    B.push({ t: 'h2', label: L ? '担当外の記録' : '記録先ごとのまとめ' });
    if (!keys.length) { B.push({ t: 'p', text: '記録がありません', fill: COL.text }); return B; }
    const rows = keys.map((k) => {
      const rr = byKey.get(k);
      const hrs = rr.reduce((x, r) => x + (r.val.hours || 0), 0);
      const hd = new Set(rr.filter((r) => r.val.hours).map((r) => r.date)).size;
      const st = lastStatus(rr, authorsOf(L, k)), pg = lastProgress(rr, authorsOf(L, k));
      return { cells: [dispKey(rr, L), hrs ? fmtH(hrs) : '―', hd || '―', fmtDate(rr[0].date), fmtDate(rr[rr.length - 1].date), st ? stCell(st.val.status) : '―', pg ? `${pg.val.progress} %` : '―'], ref: refOf(rr[rr.length - 1]) };
    });
    B.push({ t: 'table', name: L ? '担当外の記録' : '記録先ごとのまとめ', cols: [{ h: '記録先', max: 300 }, { h: '合計時間', right: true }, { h: '作業日数', right: true }, { h: '最初の日' }, { h: '最後の日' }, { h: '最後の進捗' }, { h: '最後の進捗率', right: true }], rows });
    return B;
  }
  if (view === 'gantt') {
    B.push({ t: 'h2', label: 'ガントチャート' });
    if (!L) { B.push(noPlan); return B; }
    if (!my.tasks.length) { B.push({ t: 'p', text: '計画に担当のタスクがありません', fill: COL.text }); return B; }
    const g = myGantt(my, recs, today);
    if (g.error) { B.push({ t: 'p', text: g.error, fill: COL.accent }); return B; }
    B.push({ t: 'p', text: `棒は計画の予定(担当を入れた日程)、色は今の進捗、棒の下の点は hours: を書いた日。縦線は今日 ${fmtDate(today)}、えんじの丸は遅延。` });
    B.push({ t: 'fig', id: 'gantt', draw: () => g });
    return B;
  }
  if (view === 'week') {
    const w0 = typeof ctx.week === 'number' ? ctx.week : weekOf(today, ws), w1 = w0 + 6;
    const wr = recs.filter((r) => r.date >= w0 && r.date <= w1);
    const tot = wr.reduce((x, r) => x + (r.val.hours || 0), 0);
    B.push({ t: 'h2', label: `週のまとめ(${fmtDate(w0)}〜${fmtDate(w1)})` });
    B.push({ t: 'p', text: `${a.who}。記録日数 ${new Set(wr.map((r) => r.date)).size} 日、合計時間 ${fmtH(tot)} 時間。`, fill: COL.text });
    const none = () => B.push({ t: 'p', text: 'なし', fill: COL.text });
    B.push({ t: 'h2', label: 'この週の作業時間' });
    const hk = groupByKey(wr.filter((r) => r.val.hours));
    if (hk.size) B.push({ t: 'table', name: 'この週の作業時間', cols: [{ h: '記録先', max: 300 }, { h: '時間', right: true }, { h: '日' }], rows: keyOrder(hk.keys(), L, wr).map((k) => { const rr = hk.get(k); return { cells: [dispKey(rr, L), fmtH(rr.reduce((x, r) => x + r.val.hours, 0)), [...new Set(rr.map((r) => mmdd(r.date)))].join('、')], ref: refOf(rr[rr.length - 1]) }; }) }); else none();
    B.push({ t: 'h2', label: 'この週の報告' });
    const sr = wr.filter((r) => r.val.status || r.val.progress !== undefined);
    if (sr.length) B.push({ t: 'table', name: 'この週の報告', cols: [{ h: '日付' }, { h: '記録先', max: 300 }, { h: '進捗' }, { h: '進捗率', right: true }], rows: sr.map((r) => ({ cells: [fmtDate(r.date), dispKey([r], L), r.val.status ? stCell(r.val.status) : '', r.val.progress !== undefined ? `${r.val.progress} %` : ''], ref: refOf(r) })) }); else none();
    B.push({ t: 'h2', label: 'この週の問題と解決' });
    const ir = [];
    for (const r of wr) { if (r.val.issue) ir.push([r, '問題', r.val.issue]); if (r.val.solved) ir.push([r, '解決', r.val.solved]); }
    if (ir.length) B.push({ t: 'table', name: 'この週の問題と解決', cols: [{ h: '日付' }, { h: '記録先', max: 260 }, { h: '種類' }, { h: '内容', max: 300 }], rows: ir.map(([r, k, v]) => ({ cells: [fmtDate(r.date), dispKey([r], L), k, v], ref: refOf(r) })) }); else none();
    B.push({ t: 'h2', label: 'この週の依頼と返事' });
    const qr = [];
    for (const r of wr) {
      for (const to of r.val.review || []) qr.push([r, '確認の依頼', to]);
      for (const to of r.val.ask || []) qr.push([r, '質問', to]);
      if (r.val.reviewed) qr.push([r, '確認の結果', r.val.reviewed]);
      if (r.val.answered) qr.push([r, '回答', r.val.answered]);
    }
    if (qr.length) B.push({ t: 'table', name: 'この週の依頼と返事', cols: [{ h: '日付' }, { h: '種類' }, { h: '相手・内容', max: 260 }, { h: '記録先', max: 260 }], rows: qr.map(([r, k, v]) => ({ cells: [fmtDate(r.date), k, v, dispKey([r], L)], ref: refOf(r) })) }); else none();
    B.push({ t: 'h2', label: 'この週のメモ' });
    const nr = [];
    for (const d of a.days) if (d.date >= w0 && d.date <= w1 && d.note) nr.push([d.date, '(日付の行)', d.note, { start: d.start, end: d.end }, d.line]);
    for (const r of wr) if (r.val.note) nr.push([r.date, dispKey([r], L), r.val.note, refOf(r), r.line]);
    nr.sort((x, y) => x[0] - y[0] || x[4] - y[4]);
    if (nr.length) B.push({ t: 'table', name: 'この週のメモ', cols: [{ h: '日付' }, { h: '記録先', max: 260 }, { h: 'メモ', max: 360 }], rows: nr.map(([d, k, v, ref]) => ({ cells: [fmtDate(d), k, v], ref: k === '(日付の行)' ? null : ref })) }); else none();
    B.push({ t: 'h2', label: 'この週のテスト・TRL・TPM' });
    const tr = [];
    for (const r of wr) { if (r.val.test) tr.push([r, `テスト ${r.val.test}: ${r.val.mop}`]); if (r.val.trl !== undefined) tr.push([r, `TRL ${r.val.trl}`]); if (r.val.tpm) tr.push([r, `TPM ${r.val.tpm}`]); }
    if (tr.length) B.push({ t: 'table', name: 'この週のテスト・TRL・TPM', cols: [{ h: '日付' }, { h: '機能', max: 240 }, { h: '内容', max: 340 }], rows: tr.map(([r, v]) => ({ cells: [fmtDate(r.date), dispKey([r], L), v], ref: refOf(r) })) }); else none();
    return B;
  }
  if (view === 'hours') {
    const hr = recs.filter((r) => r.val.hours);
    B.push({ t: 'h2', label: '週ごとの作業時間' });
    B.push({ t: 'p', text: `週の始まり: ${a.set.week ? a.set.week.value : 'mon(省略時)'}。列の見出しは週の始まりの日付。` });
    if (!hr.length) { B.push({ t: 'p', text: 'hours: の記録がありません', fill: COL.text }); return B; }
    const weeks = weeksOf(hr, ws);
    const hk = groupByKey(hr);
    const keys = keyOrder(hk.keys(), L, hr);
    const sumW = (rr, w) => rr.filter((r) => weekOf(r.date, ws) === w).reduce((s, r) => s + r.val.hours, 0);
    const rows = keys.map((k) => { const rr = hk.get(k); return { cells: [dispKey(rr, L), ...weeks.map((w) => { const v = sumW(rr, w); return v ? fmtH(v) : ''; }), fmtH(rr.reduce((s, r) => s + r.val.hours, 0))], ref: refOf(rr[rr.length - 1]) }; });
    const tot = weeks.map((w) => sumW(hr, w));
    rows.push({ cells: [{ t: '合計', weight: '600' }, ...tot.map((v) => ({ t: fmtH(v), weight: '600' })), { t: fmtH(tot.reduce((s, v) => s + v, 0)), weight: '600' }] });
    B.push({ t: 'table', name: '週ごとの作業時間', cols: [{ h: '記録先', max: 300 }, ...weeks.map((w) => ({ h: `${mmdd(w)}〜`, right: true })), { h: '合計時間', right: true }], rows });
    B.push({ t: 'h2', label: '週ごとの合計時間' });
    B.push({ t: 'fig', id: 'weekly', draw: () => barChart(weeks.map((w, i) => ({ label: `${mmdd(w)}〜`, v: tot[i] / 100, label2: fmtH(tot[i]) })), '時間') });
    B.push({ t: 'h2', label: '記録のカレンダー' });
    const cal = calendar(recs, today, ws);
    if (cal.error) B.push({ t: 'p', text: cal.error, fill: COL.accent });
    else { B.push({ t: 'p', text: '日ごとの合計時間(hours: の合計)。時間を書かずに記録だけある日は「記録」。太い枠は今日。' }); B.push({ t: 'fig', id: 'calendar', draw: () => cal }); }
    return B;
  }
  if (view === 'tests') {
    B.push({ t: 'h2', label: '担当するテスト項目' });
    if (!L) B.push(noPlan);
    else {
      B.push({ t: 'p', text: '担当のタスクの対象(for:)の PBS の要素が実現する(realizes:)機能の MOP。「計画」は計画でチェック済み(mop*:)、「最後のテスト」はこのマイログの test: の記録。' });
      const tt = myTests(a, my, byKey);
      if (tt.length) B.push({ t: 'table', name: '担当するテスト項目', cols: [{ h: '機能', max: 220 }, { h: 'MOP', max: 300 }, { h: '計画' }, { h: '最後のテスト' }, { h: '関係するタスク', max: 220 }], rows: tt });
      else B.push({ t: 'p', text: 'なし(担当のタスクに対象の PBS の要素がないか、その要素が機能を実現していません)', fill: COL.text });
    }
    const tr = recs.filter((r) => r.val.test);
    B.push({ t: 'h2', label: 'テストの記録' });
    if (tr.length) {
      const seen = new Set();
      B.push({ t: 'table', name: 'テストの記録', cols: [{ h: '日付' }, { h: '機能', max: 220 }, { h: 'MOP', max: 300 }, { h: '結果' }, { h: 'メモ', max: 240 }], rows: tr.map((r) => { const k = `${r.key}|${r.val.mop}`; const re = seen.has(k); seen.add(k); return { cells: [fmtDate(r.date), dispKey([r], L), r.val.mop, `${re ? '再 ' : ''}${r.val.test}`, r.val.note ?? ''], ref: refOf(r) }; }) });
    } else B.push({ t: 'p', text: 'test: の記録がありません', fill: COL.text });
    for (const [k, name] of [['trl', 'TRL の推移'], ['tpm', 'TPM の推移']]) {
      const rr = recs.filter((r) => r.val[k] !== undefined);
      B.push({ t: 'h2', label: name });
      if (!rr.length) { B.push({ t: 'p', text: `${k}: の記録がありません`, fill: COL.text }); continue; }
      const weeks = weeksOf(rr, ws), g = groupByKey(rr), keys = keyOrder(g.keys(), L, rr);
      B.push({ t: 'table', name, cols: [{ h: '機能', max: 260 }, ...weeks.map((w) => ({ h: `${mmdd(w)}〜`, right: k === 'trl', max: 200 }))], rows: keys.map((key) => { const x = g.get(key); return { cells: [dispKey(x, L), ...weeks.map((w) => { const l = (k === 'trl' ? lastTrl : (y) => lastOf(y, k))(x.filter((r) => weekOf(r.date, ws) === w)); return l ? String(l.val[k]) : ''; })], ref: refOf(x[x.length - 1]) }; }) });
    }
    return B;
  }
  return B;
}
// マイログのビューを描く。a は analyze の結果、ctx: { today, th }
function render(a, view, ctx) { const lay = layout(blocksMy(a, view, ctx)); return { svg: lay.svg, anchors: lay.anchors, lay }; }
function pieces(a, view, ctx) { return piecesOf(layout(blocksMy(a, view, ctx))); }
function printMy(a, ctx) { const out = []; for (const v of VIEWS) out.push(...printPages(blocksMy(a, v.id, ctx))); return out; }

// ================= AI で記録(マイログの仕様書 11.6 節) =================
// 生成 AI に貼るプロンプトを作る。アプリは AI に何も送らない。人の名前は伏せる(本人は「本人」、ほかの members: は「メンバーA」…)
const AI_DAYS = 3; // 状況に入れる過去の記録: 記録のある最後の 3 日
function memberLabel(i) { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return `メンバー${s}`; }
function maskNames(text, me, others) {
  // 長い名前から先に照らす(短い名前が長い名前の一部のときに崩さないため)。番号は、文の中に名前として最初に出る順。文に出ない名前は対応に入れない
  const names = [...new Set([...others.filter((n) => n && n !== me), ...(me ? [me] : [])])].sort((x, y) => y.length - x.length);
  if (!names.length) return { text, map: [] };
  const re = new RegExp(names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  const label = new Map(), map = [];
  const out = text.replace(re, (m) => {
    if (m === me) return '本人';
    if (!label.has(m)) { label.set(m, memberLabel(label.size)); map.push([label.get(m), m]); }
    return label.get(m);
  });
  return { text: out, map };
}
function aiPrompt(a, ctx) {
  const today = ctx.today, L = a.latest, me = a.who;
  const logs = [{ who: me, recs: a.recs }];
  const recs = allRecs(logs);
  const byKey = groupByKey(recs);
  const my = myTasks(a, recs, byKey, today);
  const lines = a.text.split('\n');
  const td = fmtDate(today);
  const hasToday = a.days.some((d) => d.date === today);
  const out = [];
  const P_ = (...x) => out.push(...x);
  P_('あなたは、マイログ(プロジェクトの作業の記録)の「今日の記録」を書く手伝いをします。',
    '本人に質問し、その答えだけをもとに、今日の記録の行を作ってください。',
    '',
    '## 進め方',
    '1. 質問は 1 回に 1〜2 問ずつにする。下の「今日の状況」を使って、具体的に尋ねる(例: 実行中のタスクの進み具合、未解決の問題がどうなったか)。',
    '2. 尋ねること: 今日作業したタスクとかけた時間、各タスクの状態と進捗率、困っていること・起きた問題、解決したこと、人に頼んだこと(確認の依頼・質問)、頼まれた確認の結果や答えたこと、テストをしたか(したら MOP ごとの結果)。',
    '3. 時間・進捗率・状態・結果は、本人の答えのとおりに書く。推測で埋めない。答えがあいまいなら、尋ね直す。',
    '4. 質問が終わったら、記録の行の案と、その内容を日本語の文で言い直したもの(例: 「通知用APIの実装に 2 時間、進捗率 80 %。」)を並べて見せ、「この内容で正しいですか。直すところはありますか」と尋ねる。',
    '5. 本人が正しいと答えるまで 4. を繰り返す。正しいと答えたら、今日の分の行だけを 1 つのコードブロックで出す。説明の文はコードブロックの外に書く。',
    '6. 「本人」「メンバーA」などは、人の名前を伏せたものである。そのまま使い、本当の名前を尋ねたり推測したりしない。',
    '',
    '## 書き方',
    hasToday ? `- 今日(${td})の日付の行はすでにあるので、日付の行は出さず、記録の行だけを出す。下の「今日すでに書いた記録」と同じ内容は出し直さない。` : `- 1 行目に日付の行「- ${td}」(字下げなし)を書き、その下に記録の行を書く。`,
    '- 記録の行は、空白 2 つで字下げして「  - 名前 予約語: 値 予約語: 値 …」と書く。1 行に 1 つの名前。',
    '- 名前は、下の「書ける名前」から 1 文字も変えずに選ぶ。一覧にない作業は、本人に名前を確かめてから、本人が言ったとおりに書く。',
    '- タスクに書ける属性: hours:(その日にかけた時間。数。小数は 2 桁まで)、status:(todo・doing・done・blocked のどれか。todo は実行前、doing は実行中、done は完了、blocked は問題発生)、progress:(進捗率。0〜100 の整数で % は付けない)、review:(確認を頼んだ相手)、reviewed:(頼まれた確認の結果。ok か ng)',
    '- 機能に書ける属性: test:(テストの結果。ok か ng)と mop:(テストした MOP の文。下の一覧の文を 1 文字も変えずに)を必ず組で書く。trl:(TRL。0 以上の整数)、tpm:(測った値と単位)',
    '- どちらにも書ける属性: issue:(起きた問題)、solved:(問題が解決したこと。問題を書いた名前と同じ名前に書く)、ask:(質問した相手)、answered:(受けた質問に答えたことの要旨)、note:(メモ)',
    '- タスクの属性と機能の属性は、同じ行に書かない(別の行にする)。値の中に「空白 + 予約語 + :」の形を入れない。',
    '- 見出し(#)・番号付きのリスト・説明の文の行は書かない。** と __ は、名前と、名前を書く値(review:・ask:)には書かない(__init__.py のような名前も不可)。note:・issue:・solved:・answered:・mop:・tpm: の文には書ける。',
    '- 相手が何人もいるときは、カンマで区切る(例: review: メンバーA, メンバーB)。',
    '');
  // 伏せるのは、マイログと計画から取った中身の値だけ(D() で印を付ける)。見出しや決まった語は、同じ行にあっても伏せない
  const D = (v) => `\u0001${v}\u0002`;
  P_('## 今日の状況', `- 今日: ${td}`, `- 本人: 本人`);
  if (!L) P_('- 計画が読み込まれていないので、担当のタスクはわからない。作業した名前は本人に尋ねる。');
  else {
    const catOf = new Map(); for (const c of CATS) for (const x of my.cat[c.id]) catOf.set(x, c.short);
    const live = my.tasks.filter((x) => x.status !== 'done');
    P_('', '### 担当のタスク(完了以外)');
    if (!live.length) P_('- なし');
    const sn = (x) => D(shortName(x.t, index(L).wbs));
    for (const x of live) P_(`- ${sn(x)}(予定 ${x.s === x.e ? mmdd(x.s) : `${mmdd(x.s)}〜${mmdd(x.e)}`}、${catOf.get(x)}、今の進捗 ${STATUS[x.status]}${x.rvw ? '(確認待ち。確認を頼んで返事を待っている)' : ''}${x.pg ? `、進捗率 ${x.pg.val.progress} %` : ''}${x.last ? `、最後の記録 ${fmtDate(x.last.date)}` : '、記録なし'})`);
    const rv = my.review.filter((x) => !x.rv || x.rv.val.reviewed === 'ng');
    P_('', '### 確認するタスク(本人が確認者。まだ ok を出していないもの)');
    if (!rv.length) P_('- なし');
    for (const x of rv) P_(`- ${sn(x)}(作成者 ${memberNames(x.t.by).length ? memberNames(x.t.by).map(D).join('・') : 'なし'}、終了予定日 ${mmdd(x.e)}、確認の結果 ${x.rv ? `${x.rv.val.reviewed}(${fmtDate(x.rv.date)})` : 'まだ'})`);
    const tt = [];
    const fs = new Map();
    for (const x of my.tasks) for (const pn of x.t.for || []) for (const f of (pn.R && pn.R.realizes) || []) fs.set(f, true);
    for (const f of L.r.bySec.FBS || []) if (fs.has(f)) for (const m of f.mops) {
      const last = lastTest((byKey.get(keyOf(f)) || []).filter((r) => r.val.test && r.val.mop === m.trim()));
      tt.push(`- ${D(shortName(f, index(L).fbs))} の MOP「${D(m.trim())}」(最後のテスト: ${last ? `${last.val.test}(${fmtDate(last.date)})` : 'まだ'})`);
    }
    P_('', '### 担当するテスト項目(機能の名前と MOP の文)');
    P_(...(tt.length ? tt : ['- なし']));
  }
  const open = openIssues(byKey).filter((r) => r.date <= today);
  P_('', '### 未解決の問題');
  if (!open.length) P_('- なし');
  for (const r of open) P_(`- ${D(r.name)}: ${r.val.issue !== undefined ? D(r.val.issue) : '問題発生(status: blocked)'}(${fmtDate(r.date)} から)`);
  // 書ける名前
  if (L) {
    const sn = (x) => shortName(x.t, index(L).wbs);
    const nm = [...new Set([...my.tasks.filter((x) => x.status !== 'done').map(sn), ...my.review.map(sn)])];
    const fn = []; for (const f of L.r.bySec.FBS || []) if (my.tasks.some((x) => (x.t.for || []).some((pn) => ((pn.R && pn.R.realizes) || []).includes(f)))) fn.push(shortName(f, index(L).fbs));
    P_('', '### 書ける名前', `- タスク: ${nm.map(D).join('、') || 'なし'}`, `- 機能: ${fn.map(D).join('、') || 'なし'}`, '- 完了したタスクやほかのタスクに書くときは、本人に名前を確かめる。');
  }
  // 記録のある最後の 3 日(今日を除く)と、今日すでに書いた記録
  const dayText = (d) => D([lines[d.line - 1], ...d.recs.map((r) => lines[r.line - 1])].join('\n'));
  const pd = [...new Set(a.days.filter((d) => d.date < today && d.recs.length).map((d) => d.date))].sort((x, y) => x - y).slice(-AI_DAYS);
  const past = a.days.filter((d) => pd.includes(d.date) && d.recs.length).map((d, i) => [d, i]).sort((x, y) => x[0].date - y[0].date || x[1] - y[1]).map((x) => x[0]);
  P_('', `### 最近の記録(記録のある最後の ${AI_DAYS} 日。書き方の見本にもする)`);
  P_(past.length ? ['```', ...past.map(dayText), '```'].join('\n') : '- なし');
  if (hasToday) P_('', '### 今日すでに書いた記録', ['```', ...a.days.filter((d) => d.date === today).map(dayText), '```'].join('\n'));
  P_('', 'では、最初の質問から始めてください。');
  // 名前を伏せる: 計画のどの版の members: にいる名前と、依頼の相手。印を付けた値を、出てくる順に 1 つにつないで伏せる(記号の順をそろえるため)
  const mem = new Set(); for (const e of a.V || []) for (const m of index(e).members) mem.add(m);
  for (const r of a.recs) for (const k of ['review', 'ask']) for (const n of r.val[k] || []) mem.add(n);
  const whole = out.join('\n');
  const vals = []; whole.replace(/\u0001([^\u0002]*)\u0002/g, (x, v) => { vals.push(v); return x; });
  const m = maskNames(vals.join('\u0000'), me, [...mem]);
  const masked = m.text.split('\u0000');
  let k = 0;
  return { text: whole.replace(/\u0001[^\u0002]*\u0002/g, () => masked[k++]), map: m.map };
}

// ================= 名前の補完(マイログの仕様書 8 章) =================
// 候補の名前: 照合する版のタスク・WBS の途中の要素・FBS の要素。part を含むもの。入れる名前は一意に決まるいちばん短い修飾名
function nameCandidates(plans, date, part) {
  const V = plans.filter((e) => e.usable);
  const e = versionFor(V, date);
  if (!e) return [];
  const ix = index(e);
  const out = [];
  // マイログの予約語(「空白 + 予約語 + :」)や「空白 + //」を含む名前は、マイログの行に書けないので候補に出さない(8 章)。外した名前は out.excluded
  out.excluded = [];
  const add = (n, all, kind) => {
    const ins = shortName(n, all);
    if (part && !ins.includes(part) && !labelOfNode(n).includes(part)) return;
    if (unwritable(ins)) { out.excluded.push(labelOfNode(n)); return; }
    out.push({ insert: ins, label: labelOfNode(n), kind });
  };
  for (const n of ix.wbs) if (!n.children.length) add(n, ix.wbs, 'タスク');
  for (const n of ix.fbs) if (n.parent) add(n, ix.fbs, '機能');
  return out;
}
// マイログの記録の行に、名前や値として書けない文字列(「空白 + 予約語 + :」か「空白 + //」を含む)
const UNWRITABLE = new RegExp(`(^|[ \\t])(${ALL_K.join('|')}):|[ \\t]//`);
const unwritable = (s) => UNWRITABLE.test(s);
// MOP の候補: 記録先の FBS の要素の MOP の文
function mopCandidates(plans, date, name, part) {
  const V = plans.filter((e) => e.usable);
  const e = versionFor(V, date);
  if (!e) return [];
  const c = findNodes(index(e).fbs, name.split('::').map((x) => x.trim()));
  if (c.length !== 1) return [];
  return c[0].mops.filter((t) => (!part || t.includes(part)) && !unwritable(` ${t.trim()}`)).map((t) => ({ insert: t, label: t, kind: 'MOP' }));
}

// ================= 画面からの編集(マイログの仕様書 11 章) =================
// どの操作も、書き換えたテキストを返す({ text, line(選ぶ記録の行の番号) } か { error })。
// 書き込む前に解析し直し、エラーが出ない・ほかの記録が変わらない・意図したとおりになる、を確かめる(11.1 節)
const Edit = (() => {
  const lineInfo = (text, start) => {
    const end = text.indexOf('\n', start);
    const raw = text.slice(start, end < 0 ? text.length : end);
    let cut = raw.length;
    for (let k = 0; k < raw.length - 1; k++) if (raw[k] === '/' && raw[k + 1] === '/' && (k === 0 || raw[k - 1] === ' ' || raw[k - 1] === '\t')) { cut = k; break; }
    return { raw, end: start + raw.length, indent: /^[ \t]*/.exec(raw)[0], comment: raw.slice(cut).trim() };
  };
  const sig = (r) => `${r.date}|${r.name}|${Object.values(r.at).sort((a, b) => a.keyStart - b.keyStart).map((a) => `${a.key}:${a.text}`).join(' ')}`;
  const build = (indent, name, attrs, comment) => `${indent}- ${name}${attrs.map((a) => ` ${a.key}: ${a.text}`).join('')}${comment ? ` ${comment}` : ''}`;
  const lineNo = (text, pos) => text.slice(0, pos).split('\n').length;
  // 記録の行(テキストの中の開始位置で指す)
  function recAt(p, start) { return p.recs.find((r) => r.start === start) ?? null; }
  // 書き換えを確かめる。target: { line, name, attrs: { key: 値の文字 | null }, date }、removed: 消した記録の数、added: 足した記録の数
  function verify(old, nt, opt, target, change) {
    const q = parse(nt, opt);
    const e = q.diags.find((d) => d.level === 'error');
    if (e) return { error: `書き換えるとエラーになるので、書き込みませんでした(${e.message})` };
    const t = target ? q.recs.find((r) => r.line === target.line) : null;
    if (target) {
      if (!t) return { error: '書き換えた記録の行が見つからないので、書き込みませんでした' };
      if (target.name !== undefined && t.name !== target.name) return { error: `名前が「${t.name}」と読まれるので、書き込みませんでした(名前に「空白 + 予約語 + :」や「//」を書けません)` };
      if (target.date !== undefined && t.date !== target.date) return { error: '記録が意図した日付の記録にならないので、書き込みませんでした' };
      for (const [k, v] of Object.entries(target.attrs || {})) {
        const got = t.at[k] ? t.at[k].text : null;
        if (got !== v) return { error: `${k}: の値が「${got ?? '(なし)'}」と読まれるので、書き込みませんでした(値に「空白 + 予約語 + :」や「//」を書けません)` };
      }
    }
    // ほかの記録が変わらない
    const a = old.recs.filter((r) => !change.oldStart || r.start !== change.oldStart).map(sig);
    const b = q.recs.filter((r) => !t || r !== t).map(sig);
    if (a.join('\n') !== b.join('\n')) return { error: 'ほかの記録の行が変わってしまうので、書き込みませんでした' };
    return { text: nt, line: t ? t.line : null };
  }
  // 記録の行の属性を書き換える。vals: { key: 値の文字(空なら消す) }。name を渡すと名前も書き換える
  function setAttrs(text, opt, start, vals, name) {
    const p = parse(text, opt);
    if (!p.ok) return { error: 'テキストにエラーがあるので、画面から編集できません' };
    const r = recAt(p, start);
    if (!r) return { error: '記録の行が見つかりません' };
    const li = lineInfo(p.text, r.start);
    const attrs = Object.values(r.at).sort((x, y) => x.keyStart - y.keyStart).map((a) => ({ key: a.key, text: a.text }));
    const want = {};
    for (const [k, v0] of Object.entries(vals)) {
      const v = String(v0 ?? '').trim();
      const i = attrs.findIndex((a) => a.key === k);
      if (!v) { if (i >= 0) attrs.splice(i, 1); want[k] = null; continue; }
      if (i >= 0) attrs[i].text = v; else attrs.push({ key: k, text: v });
      want[k] = v;
    }
    const nm = name === undefined ? r.name : String(name).trim();
    if (!nm) return { error: '名前は空にできません' };
    const nt = p.text.slice(0, r.start) + build(li.indent, nm, attrs, li.comment) + p.text.slice(li.end);
    return verify(p, nt, opt, { line: r.line, name: nm, attrs: want }, { oldStart: r.start });
  }
  // 記録の行を消す(日付の行は残す)
  function remove(text, opt, start) {
    const p = parse(text, opt);
    if (!p.ok) return { error: 'テキストにエラーがあるので、画面から編集できません' };
    const r = recAt(p, start);
    if (!r) return { error: '記録の行が見つかりません' };
    const li = lineInfo(p.text, r.start);
    const nt = p.text.slice(0, r.start) + p.text.slice(Math.min(p.text.length, li.end + 1));
    const res = verify(p, nt, opt, null, { oldStart: r.start });
    return res.error ? res : { text: res.text, line: null };
  }
  // 記録の行を足す(11.3 節)。date は日数、vals は { key: 値 }(空は書かない)
  function add(text, opt, date, name, vals) {
    const p = parse(text, opt);
    if (!p.ok) return { error: 'テキストにエラーがあるので、画面から編集できません' };
    const nm = String(name ?? '').trim();
    if (!nm) return { error: '名前を書いてください' };
    const attrs = [], want = {};
    for (const [k, v0] of Object.entries(vals)) { const v = String(v0 ?? '').trim(); if (v) { attrs.push({ key: k, text: v }); want[k] = v; } }
    if (!attrs.length) return { error: '時間・進捗・問題など、属性を 1 つ以上書いてください' };
    const t = p.text;
    const same = p.days.filter((d) => d.date === date);
    let nt, pos;
    if (same.length) {
      const d = same[same.length - 1];
      const lastRec = d.recs.length ? d.recs[d.recs.length - 1] : null;
      const indent = lastRec ? lineInfo(t, lastRec.start).indent : '  ';
      const at = lastRec ? lineInfo(t, lastRec.start).end : lineInfo(t, d.start).end;
      const ins = `\n${build(indent, nm, attrs, '')}`;
      nt = t.slice(0, at) + ins + t.slice(at);
      pos = at + 1;
    } else {
      const later = p.days.find((d) => d.date > date);
      const block = `- ${fmtDate(date)}\n${build('  ', nm, attrs, '')}\n`;
      if (later) { nt = t.slice(0, later.start) + block + t.slice(later.start); pos = later.start + block.indexOf('\n') + 1; }
      else {
        const pre = t === '' ? '' : t.endsWith('\n') ? (t.endsWith('\n\n') ? '' : '\n') : '\n\n';
        nt = t + pre + block;
        pos = t.length + pre.length + block.indexOf('\n') + 1;
      }
    }
    return verify(p, nt, opt, { line: lineNo(nt, pos), name: nm, attrs: want, date }, {});
  }
  // 今日の記録に書く(11.4 節・11.5 節): 今日の日付の行の記録に同じ名前の行があれば(最後のもの)その行に、なければ足す
  return { setAttrs, remove, add };
})();
// 画面から今日の記録に書く(11.4 節・11.5 節)。a: analyze の結果。戻り値は Edit の結果({ text, line } か { error })
// 今日の、同じ記録先の行(書いた名前によらない)を見る。足すときの名前は nameForWrite。足した行が別の記録先になるときは書かない
// 足した行が同じ記録先になるかを確かめる。記録先が今日の版にない(名前の変更の前の記録先など)ときは、書いたままの名前で足すので、同じ名前なら認める(4.3 節の同じ名前の規則で閉じる)
function checkKey(res, a, opt, key, today, written) {
  if (res.error || !res.line) return res;
  const b = analyze(res.text, a.plans || [], opt);
  const r = b.ok ? b.recs.find((x) => x.line === res.line) : null;
  const L = a.V && a.V.length ? versionFor(a.V, today) : null;
  const byName = !(L && index(L).byKey.has(key)) && r && r.name === written;
  return r && (r.key === key || byName) ? res : { error: '同じ記録先に書けませんでした(その名前が別の要素を指します)。テキストに直接書いてください' };
}
const addFor = (text, opt, a, today, key, written, vals) => checkKey(Edit.add(text, opt, today, nameForWrite(a.V, today, key, written), vals), a, opt, key, today, written);
function writeToday(text, opt, a, today, key, written, k, v) {
  const rr = a.recs.filter((x) => x.date === today && x.key === key);
  const t = [...rr].reverse().find((x) => x.at[k]) || rr[rr.length - 1] || null;
  if (!String(v).trim()) {
    if (!t || !t.at[k]) return { error: `今日の記録に ${k}: がないので、消すものはありません` };
    return Edit.setAttrs(text, opt, t.start, { [k]: '' });
  }
  return t ? Edit.setAttrs(text, opt, t.start, { [k]: v }) : addFor(text, opt, a, today, key, written, { [k]: v });
}
// 解決の記録: 今日の同じ記録先の最後の行。その行が問題(issue: か status: blocked)なら、新しい行に書く
function writeSolved(text, opt, a, today, key, written, v) {
  const rr = a.recs.filter((x) => x.date === today && x.key === key);
  const t = rr[rr.length - 1] || null;
  const opens = t && (t.val.issue !== undefined || t.val.status === 'blocked');
  return t && !opens ? Edit.setAttrs(text, opt, t.start, { solved: v }) : addFor(text, opt, a, today, key, written, { solved: v });
}

// ---- 例の日付をずらす(マイログの仕様書 8 章)。例は EXAMPLE_TODAY を今日とみなして作ってあり、読み込んだ日が今日になるよう、すべての日付を同じ日数だけずらす
const EXAMPLE_TODAY = '2026-04-29';
function shiftDates(text, delta) {
  return text.replace(/(^|[^\d-])(\d{4}-\d{2}-\d{2})(?![\d])/g, (m, pre, d) => { const n = parseDate(d); return n === null ? m : pre + fmtDate(n + delta); });
}
// 例を読み込むときのずらし方: 日付をずらし、week: の曜日も同じ日数だけずらす(ずらす日数が 7 の倍数でないと曜日が変わり、週の区切りがずれるため)
function shiftExample(text, delta) {
  return shiftDates(text, delta).replace(/^week:[ \t]*(mon|tue|wed|thu|fri|sat|sun)\b/m, (m, d) => `week: ${WD[(((WD.indexOf(d) + delta) % 7) + 7) % 7]}`);
}

return { lastTest, lastTrl, lastProgress, combineStatus, alignOrder, unwritable, remap, verMap, mapKey, openProblems, lastStatus, writeToday, writeSolved, nameForWrite, shiftExample, taskInfo, catOf, mmdd, cmp, endOf, memberNames, shortName, refOf, stCell, keyOrder, dispKey, weeksOf, openIssues, wrap, aiPrompt, maskNames, memberLabel, AI_DAYS, weekOptions, weekPlan, planChanges, myTests, calendar, EXAMPLE_TODAY, shiftDates, CATS, Edit, parse, analyze, stripVersion, misplacedVersion, setVersion, byName, loadPlan, sortList, addEntries, moveEntry, labels, fromPlans, versionFor, index, keyOf, labelOfNode, findNodes, allRecs, groupByKey, lastOf, stateOf, requests, signals, layout, piecesOf, printPages, drawTable, barChart, tsv, render, pieces, printMy, nameCandidates, mopCandidates, parseDate, fmtDate, weekOf, fmtH, WD, VIEWS, STATUS, STATUS_FILL, SIG_NAME, NEED_PLAN, TH_DEFAULT, KIND_JA, COL, T_, esc, textW, wrapSvg, cleanSvg };
})();
if (typeof module !== 'undefined') module.exports = Log;
/*LOG-END*/
