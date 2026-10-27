/*CORE-BEGIN*/
// ---- 計算部(DOM を使わない。Node でも動く)。プロジェクト計画 版 0.31
const Plan = (() => {
'use strict';

const SECTIONS = ['version', 'start', 'end', 'off', 'members', 'FBS', 'PBS', 'WBS'];
const ALLOWED = {
  members: ['off', 'note'],
  FBS: ['mop', 'mop*', 'note'],
  PBS: ['realizes', 'note'],
  WBS: ['for', 'days', 'by', 'review', 'after', 'status', 'note'],
};
const REF_ATTRS = ['realizes', 'for', 'by', 'review', 'after'];
const WD = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const WD_JA = ['日', '月', '火', '水', '木', '金', '土'];
// タスクの状態(status: の値)。書かなければ todo
const STATUS = { todo: '実行前', doing: '実行中', done: '完了', blocked: '問題発生' };
const SEC_JA = { FBS: 'FBS', PBS: 'PBS', WBS: 'WBS', members: 'members' };

// ---- 日付(1970-01-01 からの日数で表す)
function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return Math.round(t / 86400000);
}
function fmtDate(dn) {
  const dt = new Date(dn * 86400000);
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}
function dateParts(dn) { const dt = new Date(dn * 86400000); return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), w: dt.getUTCDay() }; }
const weekday = (dn) => ((dn % 7) + 7 + 4) % 7; // 1970-01-01 は木曜

// 日数は 1/1000 日を単位とする整数で持つ(仕様書 3.5 節)
function fmtDays(milli) {
  const i = Math.floor(milli / 1000), f = milli % 1000;
  if (!f) return String(i);
  return `${i}.${String(f).padStart(3, '0').replace(/0+$/, '')}`;
}

// 前後の空白を除いた範囲
function trimRange(str, a, b) {
  while (a < b && /[ \t]/.test(str[a])) a++;
  while (b > a && /[ \t]/.test(str[b - 1])) b--;
  return { text: str.slice(a, b), a, b };
}

// ================= 解析 =================
function parse(text0) {
  // 先頭の BOM は読み飛ばす(画面では開くときに除いている)
  const text = text0.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const diags = [];
  const lines = text.split('\n');
  const sec = {};          // 節の名前 → 節の情報
  const nodes = [];        // FBS・PBS・WBS の要素(根を含む)を書いた順に
  const members = [];
  let cur = null;          // いまの節
  let off = 0;

  const err = (ln, start, end, message, cat = '構文') => diags.push({ level: 'error', cat, line: ln, start, end, message });
  const warn = (ln, start, end, message, cat) => diags.push({ level: 'warn', cat, line: ln, start, end, message });
  // 正しくない場所の version:(仕様書 3.3 節)。保存を止めるのに使うので印を付ける
  const verErr = (ln, start, end, message) => diags.push({ level: 'error', cat: '構文', line: ln, start, end, message, ver: true });

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const ls = off;
    off += raw.length + 1;
    const ln = i + 1;
    // 注: // が行頭か、空白・タブの直後のときだけ(仕様書 3.8 節)
    let cut = raw.length;
    for (let k = 0; k < raw.length - 1; k++) {
      if (raw[k] === '/' && raw[k + 1] === '/' && (k === 0 || raw[k - 1] === ' ' || raw[k - 1] === '\t')) { cut = k; break; }
    }
    const s = raw.slice(0, cut).replace(/[ \t]+$/, '');
    if (!s.trim()) continue;
    const lead = /^[ \t\u3000]*/.exec(s)[0];
    const E = (a, b, msg) => err(ln, ls + a, ls + b, msg);
    if (lead.includes('\u3000')) { const k = lead.indexOf('\u3000'); if (/^version:/.test(s.slice(lead.length))) { verErr(ln, ls + k, ls + lead.length + 8, 'version: は 1 行目にだけ、字下げせずに書けます。保存のときにアプリが書くので、この行は消してください(字下げに全角空白が使われています)'); continue; } E(k, k + 1, '字下げに全角空白が使われています。半角の空白かタブにしてください'); continue; }
    let ind = 0;
    for (const ch of lead) ind = ch === '\t' ? (Math.floor(ind / 4) + 1) * 4 : ind + 1;
    const c0 = lead.length;
    const c = s.slice(c0);
    const secm = /^(version|start|end|off|members|FBS|PBS|WBS):/.exec(c);
    if (secm) {
      // version: は 1 行目にだけ書ける(仕様書 3.3 節)
      if (secm[1] === 'version' && (ind > 0 || lead || ln !== 1)) { verErr(ln, ls + c0, ls + c0 + secm[0].length, 'version: は 1 行目にだけ、字下げせずに書けます。保存のときにアプリが書くので、この行は消してください'); continue; }
      if (ind > 0) { E(c0, c0 + secm[0].length, `節の行「${secm[0]}」は字下げせず、行頭から書いてください`); continue; }
      handleSection(secm[1], ln, ls, secm[0].length, s);
      continue;
    }
    if (c[0] === '#') { E(c0, s.length, '見出し(#)は使えません。階層は「- 」の字下げだけで表します'); continue; }
    if (/^\d+[.)](\s|$)/.test(c)) { E(c0, s.length, '番号付きのリストは使えません。「- 」で書いてください(管理番号はツールが振ります)'); continue; }
    if (/^[*+](\s|$)/.test(c)) { E(c0, c0 + 1, 'リストの印は「- 」だけです(「* 」「+ 」は使えません)'); continue; }
    if (c.startsWith('```')) { E(c0, s.length, 'コードブロック(```)は使えません。この行を消してください'); continue; }
    if (/^-[\u3000\u00a0]/.test(c)) { E(c0 + 1, c0 + 2, '「-」の後ろは半角の空白にしてください(全角の空白は使えません)'); continue; }
    if (/^-([ \t]|$)/.test(c)) { handleItem(ln, ls, ind, c0, s); continue; }
    E(c0, s.length, 'この行は書き方に合いません。説明の文は書けません(メモは要素の note: に書きます)。要素は「- 名前」、節は「WBS: 名前」のように書きます');
  }

  function handleSection(key, ln, ls, klen, s) {
    if (sec[key]) { err(ln, ls, ls + klen, `「${key}:」が 2 回書かれています。各節は 1 回だけ書けます(${sec[key].line} 行で書いています)`); cur = { key: '_dup' }; return; }
    const rest = s.slice(klen);
    const restA = klen;
    // version: は最後にファイルとして保存した日(仕様書 4.1 節)。図と日程には使わない
    if (key === 'version' || key === 'start' || key === 'end') {
      const v = trimRange(s, restA, s.length);
      const dn = parseDate(v.text);
      if (dn === null) err(ln, ls + v.a, ls + Math.max(v.b, v.a + 1), v.text ? `日付「${v.text}」が読めません。YYYY-MM-DD の形の実在する日付で書いてください` : `${key}: の後ろに日付を書いてください`);
      sec[key] = { line: ln, start: ls, end: ls + s.length, date: dn, vStart: ls + v.a, vEnd: ls + v.b };
      cur = { key };
      return;
    }
    if (key === 'off') {
      const list = parseOffList(s, restA, s.length, ln, ls);
      sec.off = { line: ln, start: ls, end: ls + s.length, list };
      cur = { key };
      return;
    }
    if (key === 'members') {
      if (rest.trim()) err(ln, ls + restA, ls + s.length, 'members: の後ろには何も書きません。担当者は次の行から「- 名前」で書きます');
      sec.members = { line: ln, start: ls, end: ls + s.length };
      cur = { key, lastInd: -1 };
      return;
    }
    // FBS・PBS・WBS: 後ろに根の名前(仕様書 3.3 節)
    const pa = parseAttrs(s, restA, ln, ls, key);
    if (!pa) { cur = { key: '_bad' }; return; }
    if (!pa.name.text) err(ln, ls, ls + klen, `${key}: の後ろに根の名前を書いてください(例: ${key}: カレンダーアプリ)`);
    const ra = pa.attrs.find((a) => a.key === 'after');
    if (ra) err(ln, ra.kstart, ra.end, '根の行には after: を書けません(根の下の要素はすべて根の下位なので、依存関係が循環します)');
    const root = makeNode(key, null, pa, ln, ls, s, -1);
    sec[key] = { line: ln, start: ls, end: ls + s.length, root };
    cur = { key, root, stack: [] };
  }

  function handleItem(ln, ls, ind, c0, s) {
    if (!cur || !(cur.key === 'members' || cur.root)) {
      if (cur && (cur.key === '_dup' || cur.key === '_bad')) return; // 前の行のエラーに含める
      err(ln, ls + c0, ls + c0 + 1, cur ? `「${cur.key}:」の下には要素を書けません。要素は members:・FBS:・PBS:・WBS: の下に書きます` : '要素の行の前に、members:・FBS:・PBS:・WBS: のどれかの節の行が必要です');
      return;
    }
    const pa = parseAttrs(s, c0 + 1, ln, ls, cur.key);
    if (!pa) return;
    if (!pa.name.text) { err(ln, ls + c0, ls + c0 + 1, '名前がありません。「- 」の後ろに名前を書いてください'); return; }
    if (cur.key === 'members') {
      if (cur.lastInd >= 0 && ind > cur.lastInd) { err(ln, ls + c0, ls + s.length, '担当者の下に字下げした行は書けません(担当者は子を持ちません)'); return; }
      cur.lastInd = ind;
      const dup = members.find((m) => m.name === pa.name.text);
      if (dup) { err(ln, ls + pa.name.a, ls + pa.name.b, `担当者「${pa.name.text}」が 2 回書かれています(${dup.line} 行)`); return; }
      const m = { name: pa.name.text, line: ln, start: ls + c0, end: ls + s.length, nameStart: ls + pa.name.a, nameEnd: ls + pa.name.b, off: [], note: null,
        lineStart: ls, lineEnd: ls + lines[ln - 1].length, lead: s.slice(0, c0), attrList: pa.attrs, isMember: true };
      for (const at of pa.attrs) {
        if (at.key === 'off') m.off = at.off;
        if (at.key === 'note') m.note = at.text;
      }
      members.push(m);
      return;
    }
    // 字下げは相対的(仕様書 3.4 節)
    // 前の要素の行より深ければその子。同じか浅ければ、同じ節で前にある要素の行のうち、
    // 深さがこの行以下で最も近い行の兄弟。該当する行がなければ根の子
    const st = cur.stack;
    let parent;
    if (!st.length) parent = cur.root;
    else if (ind > st[st.length - 1].ind) parent = st[st.length - 1].node;
    else {
      let k = st.length - 1;
      while (k >= 0 && st[k].ind > ind) k--;
      parent = k >= 0 ? st[k].node.parent : cur.root;
    }
    const sib = parent.children.find((x) => x.name === pa.name.text);
    if (sib) err(ln, ls + pa.name.a, ls + pa.name.b, `同じ親「${parent.name}」の下に「${pa.name.text}」が 2 つあります(${sib.line} 行)。兄弟どうしで同じ名前は使えません`);
    const node = makeNode(cur.key, parent, pa, ln, ls, s, ind);
    st.push({ ind, node });
  }

  function makeNode(key, parent, pa, ln, ls, s, ind) {
    const n = {
      id: `n${nodes.length}`, sec: key, name: pa.name.text, parent, children: [], depth: parent ? parent.depth + 1 : 0,
      line: ln, start: ls, end: ls + s.length, nameStart: ls + pa.name.a, nameEnd: ls + pa.name.b,
      attrs: {}, mops: [], mopChecked: [], note: null, order: nodes.length,
      // 図からの編集で使う: 行の始まりと終わり(注を含む)、字下げの文字列、属性の並び(位置つき)
      lineStart: ls, lineEnd: ls + lines[ln - 1].length, lead: parent ? /^[ \t]*/.exec(s)[0] : '', attrList: pa.attrs,
    };
    for (const at of pa.attrs) {
      if (at.key === 'mop' || at.key === 'mop*') { n.mops.push(at.text); n.mopChecked.push(at.key === 'mop*'); }
      else if (at.key === 'note') n.note = at.text;
      else n.attrs[at.key] = at;
    }
    if (parent) parent.children.push(n);
    nodes.push(n);
    return n;
  }

  // 名前と属性に分ける(仕様書 3.5・3.6 節)。エラーなら null
  function parseAttrs(s, from, ln, ls, key) {
    const re = /(^|[ \t])(realizes|for|days|by|review|after|status|note|mop\*?|off):/g;
    re.lastIndex = from;
    const hits = [];
    let m;
    const body = s;
    // from の位置は「- 」の空白(または「FBS:」の直後)なので、最初の属性も「空白 + 予約語 + :」で見つかる
    while ((m = re.exec(body))) {
      const ks = m.index + m[1].length;
      if (ks < from) continue;
      hits.push({ key: m[2], ks, vs: ks + m[2].length + 1 });
    }
    let ok = true;
    const E = (a, b, msg) => { err(ln, ls + a, ls + b, msg); ok = false; };
    const name = trimRange(body, from, hits.length ? hits[0].ks : body.length);
    if (/\*\*|__/.test(name.text)) E(name.a, name.b, '太字(** や __)は使えません');
    if (name.text.includes(',')) E(name.a, name.b, `名前「${name.text}」にカンマ(,)は使えません(参照の区切りと区別できないため)`);
    if (name.text.includes('::')) E(name.a, name.b, `名前「${name.text}」に :: は使えません(修飾名の区切りと区別できないため)`);
    const attrs = [];
    const seen = new Set();
    for (let h = 0; h < hits.length; h++) {
      const x = hits[h];
      const v = trimRange(body, x.vs, h + 1 < hits.length ? hits[h + 1].ks : body.length);
      const kend = x.ks + x.key.length + 1;
      const allowed = key === 'members' ? ALLOWED.members : ALLOWED[key];
      if (!allowed || !allowed.includes(x.key)) {
        E(x.ks, kend, `「${x.key}:」は ${key}: の${key === 'members' ? '担当者' : '要素'}には書けません(書けるもの: ${(allowed ?? []).map((k) => `${k}:`).join(' ')})`);
        continue;
      }
      if (x.key !== 'mop' && x.key !== 'mop*' && seen.has(x.key)) { E(x.ks, kend, `「${x.key}:」が同じ行に 2 回あります`); continue; }
      seen.add(x.key);
      if (/\*\*|__/.test(v.text)) { E(v.a, Math.max(v.b, v.a + 1), '太字(** や __)は使えません'); continue; }
      if (!v.text) { E(x.ks, kend, `「${x.key}:」の後ろに値がありません`); continue; }
      const at = { key: x.key, text: v.text, start: ls + v.a, end: ls + v.b, kstart: ls + x.ks, line: ln };
      if (x.key === 'off') { at.off = parseOffList(body, v.a, v.b, ln, ls); if (!at.off) ok = false; }
      else if (x.key === 'days') {
        const d = /^(\d+)(?:\.(\d+))?$/.exec(v.text);
        if (!d) { E(v.a, v.b, `日数「${v.text}」が読めません。0 以上の数で書いてください(例: 3、1.5)`); continue; }
        if (d[2] && d[2].length > 3) { E(v.a, v.b, `日数「${v.text}」の小数は 3 桁までです`); continue; }
        // 上限は読み取った値の大きさで判定する(先頭の 0 は桁に数えない。小数部も含める)
        const ip = d[1].replace(/^0+(?=\d)/, '');
        at.milli = ip.length > 6 ? Infinity : +ip * 1000 + (d[2] ? +d[2].padEnd(3, '0') : 0);
        if (at.milli > 36500000) { E(v.a, v.b, `日数「${v.text}」が大きすぎます(36500 日まで)`); continue; }
      } else if (x.key === 'status') {
        if (!Object.hasOwn(STATUS, v.text)) { E(v.a, v.b, `状態「${v.text}」が読めません。${Object.keys(STATUS).map((k) => `${k}(${STATUS[k]})`).join('・')}のどれかを書いてください`); continue; }
      } else if (REF_ATTRS.includes(x.key)) {
        at.refs = [];
        let p = v.a;
        const parts = v.text.split(',');
        for (const part of parts) {
          const r = trimRange(body, p, p + part.length);
          p += part.length + 1;
          if (!r.text) { E(v.a, v.b, `「${x.key}:」の並びに空の項目があります(カンマが続いています)`); continue; }
          const segs = r.text.split('::').map((t) => t.trim());
          if (segs.some((t) => !t)) { E(r.a, r.b, `「${r.text}」の :: の前後に名前がありません`); continue; }
          at.refs.push({ text: r.text, segs, start: ls + r.a, end: ls + r.b, line: ln, noRoot: x.key === 'after' });
        }
      }
      attrs.push(at);
    }
    return ok ? { name, attrs } : (name.text ? { name, attrs, partial: true } : null);
  }

  function parseOffList(s, a, b, ln, ls) {
    const out = [];
    const v = trimRange(s, a, b);
    if (!v.text) { err(ln, ls + a, ls + Math.max(b, a + 1), 'off: の後ろに休み(日付・範囲・曜日)を書いてください'); return out; }
    let p = v.a;
    for (const part of v.text.split(',')) {
      const r = trimRange(s, p, p + part.length);
      p += part.length + 1;
      const E = (msg) => err(ln, ls + r.a, ls + Math.max(r.b, r.a + 1), msg);
      if (!r.text) { E('off: の並びに空の項目があります'); continue; }
      if (Object.prototype.hasOwnProperty.call(WD, r.text)) { out.push({ type: 'wd', v: WD[r.text] }); continue; }
      const rm = /^(.+?)\.\.(.+)$/.exec(r.text);
      if (rm) {
        const x = parseDate(rm[1].trim()), y = parseDate(rm[2].trim());
        if (x === null || y === null) { E(`範囲「${r.text}」が読めません。YYYY-MM-DD..YYYY-MM-DD の形で書いてください`); continue; }
        if (x > y) { E(`範囲「${r.text}」の始めが終わりより後です`); continue; }
        out.push({ type: 'r', a: x, b: y });
        continue;
      }
      const d = parseDate(r.text);
      if (d === null) { E(`「${r.text}」が読めません。日付(YYYY-MM-DD)、範囲(日付..日付)、曜日(mon tue wed thu fri sat sun)のどれかで書いてください`); continue; }
      out.push({ type: 'd', v: d });
    }
    return out;
  }

  // 必須の節(仕様書 3.3 節)
  for (const k of ['start', 'members', 'WBS']) {
    if (!sec[k]) err(1, 0, Math.min(text.indexOf('\n') < 0 ? text.length : text.indexOf('\n'), 1e9), `「${k}:」がありません(必須の節です)`, '必須');
  }
  if (sec.start && sec.end && sec.start.date !== null && sec.end.date !== null && sec.end.date < sec.start.date) {
    err(sec.end.line, sec.end.start, sec.end.end, `end: の日付が start: の日付(${fmtDate(sec.start.date)})より前です`);
  }
  return { text, diags, sec, nodes, members };
}

// ================= 意味の解析・検査・計算 =================
function analyze(text) {
  const p = parse(text);
  const diags = p.diags;
  const res = { text: p.text, parse: p, diags, ok: false };
  // エラーがあるときは、エラーだけを出す(仕様書 10 章)
  const fail = () => { for (let i = diags.length - 1; i >= 0; i--) if (diags[i].level !== 'error') diags.splice(i, 1); return res; };
  if (diags.some((d) => d.level === 'error')) return fail();
  const { sec, nodes, members } = p;
  const err = (r, message, cat = '参照') => diags.push({ level: 'error', cat, line: r.line, start: r.start, end: r.end, message });
  const warn = (r, message, cat) => diags.push({ level: 'warn', cat, line: r.line, start: r.start, end: r.end, message });
  const bySec = { FBS: [], PBS: [], WBS: [] };
  for (const n of nodes) bySec[n.sec].push(n);
  const qname = (n) => { const a = []; for (let x = n; x; x = x.parent) a.unshift(x.name); return a.join('::'); };
  const isAnc = (a, b) => { for (let x = b.parent; x; x = x.parent) if (x === a) return true; return false; }; // a が b の先祖

  // ---- 参照の解決(仕様書 3.7 節)
  function resolveNode(secKey, ref, noRoot) {
    if (!sec[secKey]) return { error: `${secKey}: がないので「${ref.text}」を参照できません` };
    const last = ref.segs[ref.segs.length - 1];
    const cands = bySec[secKey].filter((n) => {
      if (n.name !== last) return false;
      if (noRoot && !n.parent) return false;
      let a = n.parent;
      for (let k = ref.segs.length - 2; k >= 0; k--) { if (!a || a.name !== ref.segs[k]) return false; a = a.parent; }
      return true;
    });
    if (!cands.length) {
      if (noRoot && ref.segs.length === 1 && sec[secKey].root.name === last) return { error: `「${ref.text}」は ${secKey} の根なので after: に書けません(根の下の要素はすべて根の下位です)` };
      return { error: `「${ref.text}」が ${secKey} にありません` };
    }
    if (cands.length > 1) return { error: `「${ref.text}」が ${secKey} に ${cands.length} つあり、どれか決まりません。親::子 の形で書いてください(候補: ${cands.map(qname).join('、')})` };
    return { node: cands[0] };
  }
  const resolveList = (at, fn) => {
    const out = [];
    const seen = new Set();
    for (const r of at.refs) {
      const x = fn(r);
      if (x.error) { err(r, x.error); continue; }
      r.node = x.node;
      if (seen.has(x.node)) { warn(r, `「${r.text}」が ${at.key}: に 2 回書かれています(1 回とみなします)`, '書き方'); continue; }
      seen.add(x.node);
      out.push(x.node);
    }
    return out;
  };
  const memberOf = (r) => {
    if (r.segs.length > 1) return { error: `担当者の名前「${r.text}」に :: は使えません` };
    const m = members.find((x) => x.name === r.text);
    return m ? { node: m } : { error: `担当者「${r.text}」が members: にいません` };
  };
  for (const n of nodes) {
    n.R = {};
    for (const k of Object.keys(n.attrs)) {
      const at = n.attrs[k];
      if (!at.refs) continue;
      if (k === 'realizes') n.R.realizes = resolveList(at, (r) => resolveNode('FBS', r, false));
      if (k === 'for') n.R.for = resolveList(at, (r) => resolveNode('PBS', r, false));
      if (k === 'after') n.R.after = resolveList(at, (r) => resolveNode('WBS', r, true));
      if (k === 'by' || k === 'review') n.R[k] = resolveList(at, memberOf);
    }
  }
  // after: の自分・先祖・子孫(仕様書 4.4 節)
  for (const n of bySec.WBS) {
    if (!n.R.after) continue;
    const at = n.attrs.after;
    n.R.after.forEach((t, i) => {
      if (t === n || isAnc(t, n) || isAnc(n, t)) {
        const r = at.refs.find((x) => resolveNode('WBS', x, true).node === t) ?? at;
        err(r, `「${t.name}」は${t === n ? '自分自身' : isAnc(t, n) ? 'この要素の上位' : 'この要素の下位'}なので after: に書けません(依存関係が循環します)`, '循環');
      }
    });
  }
  if (diags.some((d) => d.level === 'error')) return fail();

  // ---- WBS: 受け継ぎ・タスク・日数
  const wroot = sec.WBS.root;
  const eff = (n, k) => (n.R[k] !== undefined ? n.R[k] : n.parent ? eff(n.parent, k) : []);
  const leavesUnder = (n) => (n.children.length ? n.children.flatMap(leavesUnder) : [n]);
  const tasks = bySec.WBS.filter((n) => n.parent && !n.children.length);
  for (const n of bySec.WBS) {
    n.by = eff(n, 'by'); n.review = eff(n, 'review'); n.for = eff(n, 'for');
    for (const k of ['days', 'status']) if (n.attrs[k] && (n.children.length || !n.parent)) warn(n.attrs[k], `${k}: は末端のタスクにだけ書けます(「${n.name}」は${n.parent ? '途中の要素' : '根'}なので無視します)`, '書き方');
  }
  for (const t of tasks) {
    t.status = t.attrs.status ? t.attrs.status.text : 'todo';
    if (t.attrs.days) {
      t.days = t.attrs.days.milli;
      if (!t.days) warn(t.attrs.days, `タスク「${t.name}」の days: が 0 です(タスクの期間がありません)`, '書き方');
    }
    else { t.days = 0; warn({ line: t.line, start: t.nameStart, end: t.nameEnd }, `タスク「${t.name}」に days: がありません(日数 0 として計算します)`, '書き方'); }
  }
  // 依存関係: 途中の要素や根の after: は下のタスクすべてに適用し、子の after: と合わせる(仕様書 4.4 節)
  for (const t of tasks) {
    const pre = new Set();
    for (let x = t; x; x = x.parent) for (const tg of x.R.after ?? []) for (const l of leavesUnder(tg)) pre.add(l);
    t.pred = [...pre].sort((a, b) => a.order - b.order);
    t.succ = [];
  }
  for (const t of tasks) for (const q of t.pred) q.succ.push(t);
  // 循環(仕様書 5.3 節)
  const indeg = new Map(tasks.map((t) => [t, t.pred.length]));
  const topo = [];
  const queue = tasks.filter((t) => !t.pred.length);
  while (queue.length) {
    queue.sort((a, b) => a.order - b.order);
    const t = queue.shift();
    topo.push(t);
    for (const s of t.succ) { indeg.set(s, indeg.get(s) - 1); if (!indeg.get(s)) queue.push(s); }
  }
  if (topo.length < tasks.length) {
    const rest = new Set(tasks.filter((t) => !topo.includes(t)));
    // 循環を 1 つ見つけて示す
    const start = [...rest].sort((a, b) => a.order - b.order)[0];
    const path = [start];
    const seenIdx = new Map([[start, 0]]);
    let x = start;
    for (;;) {
      const nx = x.pred.filter((q) => rest.has(q)).sort((a, b) => a.order - b.order)[0];
      if (seenIdx.has(nx)) { const cyc = path.slice(seenIdx.get(nx)).reverse(); cyc.push(cyc[0]); err({ line: nx.line, start: nx.nameStart, end: nx.nameEnd }, `依存関係が循環しています: ${cyc.map((q) => q.name).join(' → ')}`, '循環'); break; }
      seenIdx.set(nx, path.length); path.push(nx); x = nx;
    }
    return fail();
  }

  // ---- 検査(仕様書 5 章)。結果はすべて警告。根は検査しない
  const checks = [];
  const C = (code, n, message) => { checks.push({ code, node: n }); warn({ line: n.line, start: n.nameStart, end: n.nameEnd }, message, `検査 ${code}`); };
  // 末端は自分自身に対応が必要。途中の要素は自分か子孫のどれかに対応があれば満たす(仕様書 5.2 節)。根は検査しない
  const leafCheck = (list, has, code, msg) => {
    const sat = (n) => has(n) || n.children.some(sat);
    for (const n of list) if (n.parent && !sat(n)) C(code, n, msg(n) + (n.children.length ? '(下の要素にもありません)' : ''));
  };
  const realizedBy = new Map();
  for (const n of bySec.PBS) for (const f of n.R.realizes ?? []) { if (!realizedBy.has(f)) realizedBy.set(f, []); realizedBy.get(f).push(n); }
  const tasksFor = new Map();
  for (const t of tasks) for (const q of t.for) { if (!tasksFor.has(q)) tasksFor.set(q, []); tasksFor.get(q).push(t); }
  if (sec.FBS && sec.PBS) {
    leafCheck(bySec.FBS, (n) => realizedBy.has(n), 'C1', (n) => `FBS の「${n.name}」を実現する PBS の要素がありません(PBS の要素に realizes: で書きます)`);
    leafCheck(bySec.PBS, (n) => (n.R.realizes ?? []).length > 0, 'C2', (n) => `PBS の「${n.name}」が FBS のどの要素も実現していません(realizes: がありません)`);
  }
  if (sec.FBS && bySec.FBS.some((n) => n.mops.length)) {
    leafCheck(bySec.FBS, (n) => n.mops.length > 0, 'C3', (n) => `FBS の「${n.name}」に MOP(mop: か mop*:)がありません`);
  }
  if (sec.PBS) leafCheck(bySec.PBS, (n) => tasksFor.has(n), 'C4', (n) => `PBS の「${n.name}」のためのタスクがありません(WBS のタスクに for: で書きます)`);
  for (const t of tasks) if (!t.by.length) C('C5', t, `タスク「${t.name}」に担当者(by:)がいません`);
  if (!tasks.length) warn({ line: sec.WBS.line, start: sec.WBS.start, end: sec.WBS.end }, 'WBS にタスクがありません(WBS: の下に「- 名前」で書きます)', '書き方');

  // ---- 管理番号(仕様書 7.1 節)
  const number = (n, prefix) => n.children.forEach((c, i) => { c.num = prefix ? `${prefix}.${i + 1}` : String(i + 1); number(c, c.num); });
  for (const k of ['FBS', 'PBS', 'WBS']) if (sec[k]) { sec[k].root.num = ''; number(sec[k].root, ''); }

  // ---- クリティカルパス(仕様書 6.2 節)
  for (const t of topo) { t.ES = Math.max(0, ...t.pred.map((q) => q.EF)); t.EF = t.ES + t.days; }
  const T = tasks.length ? Math.max(...tasks.map((t) => t.EF)) : 0;
  for (let i = topo.length - 1; i >= 0; i--) {
    const t = topo[i];
    t.LF = t.succ.length ? Math.min(...t.succ.map((s) => s.LS)) : T;
    t.LS = t.LF - t.days;
    t.TF = t.LS - t.ES;
    t.crit = t.TF === 0;
  }

  // ---- 担当を入れた日程(仕様書 6.3 節)
  const start = sec.start.date;
  const gOff = sec.off ? sec.off.list : [];
  const hit = (list, dn) => list.some((o) => (o.type === 'wd' ? weekday(dn) === o.v : o.type === 'd' ? dn === o.v : o.a <= dn && dn <= o.b));
  const LIMIT = 36600; // 100 年分。これを超えても作業できる日がなければ計算をやめる
  const workDay = (t, day) => !hit(gOff, start + day) && t.by.every((m) => !hit(m.off, start + day));
  let stuck = null;
  const norm = (t, s) => {
    let day = Math.floor(s / 1000);
    if (workDay(t, day)) return s;
    let n = 0;
    do { day++; if (++n > LIMIT) { stuck = t; return Infinity; } } while (!workDay(t, day));
    return day * 1000;
  };
  const finish = (t, s) => {
    if (s === Infinity) return Infinity;
    let x = s, rem = t.days, n = 0; // n は作業できない日が続いた日数
    while (rem > 0) {
      const day = Math.floor(x / 1000);
      if (!workDay(t, day)) { if (++n > LIMIT) { stuck = t; return Infinity; } x = (day + 1) * 1000; continue; }
      n = 0;
      const avail = (day + 1) * 1000 - x;
      if (rem <= avail) return x + rem;
      rem -= avail; x = (day + 1) * 1000;
    }
    return x;
  };
  const busy = new Map(members.map((m) => [m, []]));
  const placed = new Set();
  const order = [];
  while (placed.size < tasks.length && !stuck) {
    const elig = tasks.filter((t) => !placed.has(t) && t.pred.every((q) => placed.has(q)));
    elig.sort((a, b) => a.LS - b.LS || a.order - b.order);
    const t = elig[0];
    const c0 = Math.max(0, ...t.pred.map((q) => q.f));
    // 日数 0 のタスクは、休みに当たっても次の作業日へ送らず、先行が終わった時刻に置く(仕様書 6.3 節)
    if (t.days === 0) { t.s = c0; t.f = c0; placed.add(t); order.push(t); continue; }
    const cands = [c0];
    for (const m of t.by) for (const [, b] of busy.get(m)) if (b > c0) cands.push(b);
    cands.sort((a, b) => a - b);
    let done = false;
    for (const c of cands) {
      const s = norm(t, c);
      const f = finish(t, s);
      if (stuck) break;
      const ok = t.days === 0 || t.by.every((m) => busy.get(m).every(([a, b]) => !(a < f && s < b)));
      if (ok) { t.s = s; t.f = f; done = true; break; }
    }
    if (!done) break;
    if (t.days > 0) for (const m of t.by) busy.get(m).push([t.s, t.f]);
    placed.add(t);
    order.push(t);
  }
  if (stuck) {
    err({ line: stuck.line, start: stuck.nameStart, end: stuck.nameEnd }, `タスク「${stuck.name}」の日程を計算できません。休み(off:)のため、担当者全員が作業できる日が見つかりません`, '日程');
    return fail();
  }
  const finishMax = tasks.length ? Math.max(...tasks.map((t) => t.f)) : 0;
  // 日数 0 のタスクは、先行が終わった日(時刻が日の始まりちょうどなら前の日)に属させる
  const lastDay = (t) => (t.f > t.s ? Math.ceil(t.f / 1000) - 1 : Math.max(0, Math.ceil(t.s / 1000) - 1));
  const firstDay = (t) => (t.f > t.s ? Math.floor(t.s / 1000) : lastDay(t));
  for (const t of tasks) { t.d0 = firstDay(t); t.d1 = lastDay(t); }
  const spanDays = tasks.length ? Math.max(...tasks.map((t) => t.d1)) + 1 : 0;
  const finishDate = tasks.length ? start + spanDays - 1 : null;
  if (sec.end && finishDate !== null && finishDate > sec.end.date) {
    warn({ line: sec.end.line, start: sec.end.start, end: sec.end.end }, `日程の終わり(${fmtDate(finishDate)})が end:(${fmtDate(sec.end.date)})を ${finishDate - sec.end.date} 日超えています`, '日程');
  }

  Object.assign(res, {
    ok: true, sec, nodes, bySec, members, tasks, topo, order, checks, qname,
    cp: { T }, sched: { start, spanDays, finishDate, finishMax },
    isOff: (dn) => hit(gOff, dn), memberOff: (m, dn) => hit(m.off, dn),
  });
  return res;
}

// ================= 描画(SVG の文字列) =================
const FONT = "'Hiragino Sans','Noto Sans JP','Yu Gothic UI','Meiryo','Segoe UI',sans-serif";
const COL = { accent: '#8b1a2b', line: '#333', warnFill: '#fff3c4', warnLine: '#b07800', blue: '#2b8fd8', grid: '#c8c8c4', off: '#e6e6e2', head: '#f4f4f2', text: '#222', sub: '#666' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const charW = (ch, fs) => (/[\u0000-\u024f\uff61-\uff9f]/.test(ch) ? 0.6 : 1) * fs;
const textW = (s, fs) => [...s].reduce((a, ch) => a + charW(ch, fs), 0);
function wrap(s, maxW, fs) {
  const out = [];
  let cur = '', w = 0;
  for (const ch of s) {
    const cw = charW(ch, fs);
    if (w + cw > maxW && cur) { out.push(cur); cur = ''; w = 0; }
    cur += ch; w += cw;
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}
function clip(s, maxW, fs) {
  if (textW(s, fs) <= maxW) return s;
  let out = '', w = textW('…', fs);
  for (const ch of s) { const cw = charW(ch, fs); if (w + cw > maxW) break; out += ch; w += cw; }
  return `${out}…`;
}
const T_ = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.fs ?? 13}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.fill ? ` fill="${o.fill}"` : ''}${o.weight ? ` font-weight="${o.weight}"` : ''}${o.dom ? ` dominant-baseline="${o.dom}"` : ''}${o.halo ? ' stroke="#fff" stroke-width="4" stroke-linejoin="round" paint-order="stroke"' : ''}>${esc(s)}</text>`;
const wrapSvg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(w)}" height="${Math.ceil(h)}" viewBox="0 0 ${Math.ceil(w)} ${Math.ceil(h)}" font-family="${esc(FONT)}"><rect x="0" y="0" width="${Math.ceil(w)}" height="${Math.ceil(h)}" fill="#fff"/>${body}</svg>`;
const sel = (n) => `data-id="${n.id}" data-start="${n.start}" data-end="${n.end}"`;

// 担当者の表示: メンバー全員(2 人以上)なら「全員」と書く(多人数で列が切れて読めなくなるため)
const who = (r, list) => (list.length >= 2 && list.length === r.members.length ? '全員' : list.map((m) => m.name).join('・'));

// ---- 木(FBS・PBS・WBS。仕様書 7.1 節)
// 子がすべて末端なら、子を親の下に縦に並べる(横に広がりすぎないため)。それ以外は横に並べる
// opt.keep: 描く要素の集合(印刷でページを分けるとき。根からその要素までの道と、その下を描く)
function renderTree(r, key, opt = {}) {
  const root = r.sec[key].root;
  const kids = (n) => (opt.keep ? n.children.filter((c) => opt.keep.has(c)) : n.children);
  const warned = new Set(r.checks.filter((c) => c.node.sec === key).map((c) => c.node));
  const FS = 13, SFS = 11, PADX = 10, PADY = 7, GAPX = 18, GAPY = 34, VIND = 22, VGAP = 10, MAXW = 200;
  const box = (n) => {
    const head = key === 'WBS' && n.num ? `${n.num} ` : '';
    const lines = wrap(head + n.name, MAXW - 2 * PADX, FS);
    const sub = [];
    if (key === 'FBS') n.mops.forEach((m, i) => sub.push(...wrap(`${n.mopChecked[i] ? '✓ ' : ''}MOP: ${m}`, MAXW - 2 * PADX, SFS)));
    if (key === 'WBS' && n.parent && !n.children.length) {
      const bits = [`${fmtDays(n.days)} 日`];
      if (n.by.length) bits.push(`作成 ${who(r, n.by)}`);
      if (n.review.length) bits.push(`確認 ${who(r, n.review)}`);
      sub.push(...wrap(bits.join(' / '), MAXW - 2 * PADX, SFS));
    }
    const w = Math.max(70, Math.min(MAXW, Math.max(...lines.map((l) => textW(l, FS)), ...sub.map((l) => textW(l, SFS))) + 2 * PADX));
    const h = PADY * 2 + lines.length * FS * 1.35 + sub.length * SFS * 1.35;
    return { lines, sub, w, h };
  };
  const B = new Map();
  const size = (n) => {
    const b = box(n);
    B.set(n, b);
    if (!kids(n).length) { b.tw = b.w; b.th = b.h; b.mode = 'leaf'; return; }
    kids(n).forEach(size);
    if (kids(n).every((c) => !kids(c).length)) {
      b.mode = 'v';
      b.tw = Math.max(b.w, VIND + Math.max(...kids(n).map((c) => B.get(c).tw)));
      b.th = b.h + kids(n).reduce((a, c) => a + VGAP + B.get(c).th, 0);
    } else {
      b.mode = 'h';
      const cw = kids(n).reduce((a, c) => a + B.get(c).tw, 0) + GAPX * (kids(n).length - 1);
      b.tw = Math.max(b.w, cw);
      b.th = b.h + GAPY + Math.max(...kids(n).map((c) => B.get(c).th));
    }
  };
  size(root);
  const out = [];
  const place = (n, x, y) => {
    const b = B.get(n);
    let bx;
    if (b.mode === 'v') bx = x; else bx = x + (b.tw - b.w) / 2;
    b.x = bx; b.y = y;
    if (b.mode === 'v') {
      let cy = y + b.h + VGAP;
      const lx = bx + 12;
      for (const c of kids(n)) {
        place(c, bx + VIND, cy);
        const cb = B.get(c);
        out.push(`<path d="M${lx} ${cy + cb.h / 2}H${bx + VIND}" fill="none" stroke="${COL.line}"/>`);
        cy += cb.th + VGAP;
      }
      const lastC = B.get(kids(n)[kids(n).length - 1]);
      out.push(`<path d="M${lx} ${y + b.h}V${lastC.y + lastC.h / 2}" fill="none" stroke="${COL.line}"/>`);
    } else if (b.mode === 'h') {
      const cw = kids(n).reduce((a, c) => a + B.get(c).tw, 0) + GAPX * (kids(n).length - 1);
      let cx = x + (b.tw - cw) / 2;
      const cy = y + b.h + GAPY;
      const mids = [];
      for (const c of kids(n)) { place(c, cx, cy); const cb = B.get(c); mids.push(cb.x + cb.w / 2); cx += cb.tw + GAPX; }
      const pm = bx + b.w / 2, my = y + b.h + GAPY / 2;
      out.push(`<path d="M${pm} ${y + b.h}V${my}" fill="none" stroke="${COL.line}"/>`);
      out.push(`<path d="M${Math.min(pm, ...mids)} ${my}H${Math.max(pm, ...mids)}" fill="none" stroke="${COL.line}"/>`);
      for (const m of mids) out.push(`<path d="M${m} ${my}V${cy}" fill="none" stroke="${COL.line}"/>`);
    }
    const w = warned.has(n);
    let t = `<g ${sel(n)}><title>${esc(r.qname(n))}${n.note ? `\n${esc(n.note)}` : ''}</title><rect x="${bx}" y="${y}" width="${b.w}" height="${b.h}" rx="6" fill="${w ? COL.warnFill : '#fff'}" stroke="${w ? COL.warnLine : COL.line}" stroke-width="1.5"${w ? ' stroke-dasharray="5 3"' : ''}/>`;
    let ty = y + PADY + FS;
    for (const l of b.lines) { t += T_(bx + b.w / 2, ty, l, { fs: FS, anchor: 'middle' }); ty += FS * 1.35; }
    for (const l of b.sub) { t += T_(bx + b.w / 2, ty - 1, l, { fs: SFS, anchor: 'middle', fill: COL.sub }); ty += SFS * 1.35; }
    out.push(`${t}</g>`);
  };
  const M = 20;
  const titleH = 24;
  place(root, M, M + titleH);
  const rb = B.get(root);
  const legend = warned.size ? '   点線の黄色い枠は検査の警告がある要素' : '';
  return wrapSvg(Math.max(rb.tw, textW(`${key}${legend}`, 13)) + 2 * M, rb.th + 2 * M + titleH, T_(M, M + 12, `${key}${legend}`, { fs: 13, weight: '600' }) + out.join(''));
}

// ---- FBS と PBS の対応(仕様書 7.2 節)。左に FBS、右に PBS を並べ、実現の対応を線で結ぶ
function renderMatch(r) {
  const F = r.bySec.FBS, P = r.bySec.PBS;
  const warned = new Set(r.checks.filter((c) => c.code === 'C1' || c.code === 'C2').map((c) => c.node));
  const FS = 13, RH = 30, IND = 16, BW = 200, GAP = 180, M = 20, TOP = 74;
  const colX = [M, M + 6 * IND + BW + GAP];
  const pos = new Map();
  const out = [];
  const col = (list, ci) => list.forEach((n, i) => {
    const x = colX[ci] + n.depth * IND, y = TOP + i * RH;
    pos.set(n, { x, y, w: BW, h: RH - 8 });
    const w = warned.has(n);
    const label = clip(n.parent ? n.name : `${n.sec}: ${n.name}`, BW - 14, FS);
    out.push(`<g ${sel(n)}><title>${esc(r.qname(n))}</title><rect x="${x}" y="${y}" width="${BW}" height="${RH - 8}" rx="5" fill="${w ? COL.warnFill : '#fff'}" stroke="${w ? COL.warnLine : COL.line}" stroke-width="1.3"${w ? ' stroke-dasharray="5 3"' : ''}/>${T_(x + 7, y + (RH - 8) / 2 + 4.5, label, { fs: FS, weight: n.parent ? null : '600' })}</g>`);
  });
  col(F, 0); col(P, 1);
  const lines = [];
  for (const p of P) for (const f of p.R.realizes ?? []) {
    const a = pos.get(f), b = pos.get(p);
    const d = `M${a.x + a.w} ${a.y + a.h / 2}L${b.x} ${b.y + b.h / 2}`;
    lines.push(`<g data-rel="${p.id}|${f.id}"><title>${esc(`${f.name} ― ${p.name}`)}</title><path d="${d}" fill="none" stroke="${COL.line}" stroke-width="1.2"/><path d="${d}" fill="none" stroke="transparent" stroke-width="10"/></g>`);
  }
  const h = TOP + Math.max(F.length, P.length) * RH + M;
  const w = colX[1] + 6 * IND + BW + M;
  const head = T_(M, 24, 'FBS と PBS の対応', { fs: 13, weight: '600' })
    + T_(colX[0], 58, 'FBS', { fs: 14, weight: '600' }) + T_(colX[1], 58, 'PBS', { fs: 14, weight: '600' })
    + (warned.size ? T_(colX[0] + 60, 58, '点線の黄色い枠は対応がない要素(検査 C1・C2)', { fs: 11, fill: COL.sub }) : '');
  return wrapSvg(w, h, head + lines.join('') + out.join(''));
}

// ---- アローダイアグラム(仕様書 7.3 節)。丸が事象、矢印がタスク。ダミー作業は点線
function buildAOA(tasks) {
  // 推移的に冗長な依存を除く(図を簡単にするため。依存関係の意味は変わらない)
  const reach = new Map();
  const reachOf = (t) => { if (reach.has(t)) return reach.get(t); const s = new Set(); for (const q of t.pred) { s.add(q); for (const x of reachOf(q)) s.add(x); } reach.set(t, s); return s; };
  const P = new Map();
  for (const t of tasks) P.set(t, t.pred.filter((q) => !t.pred.some((o) => o !== q && reachOf(o).has(q))));
  const key = (set) => set.map((q) => q.order).sort((a, b) => a - b).join(',');
  const events = [];
  const ev = () => { const e = { id: events.length, inA: [], outA: [] }; events.push(e); return e; };
  const src = ev();
  const startOf = new Map([['', src]]);
  const sets = [];
  for (const t of tasks) { const k = key(P.get(t)); if (!startOf.has(k)) { startOf.set(k, ev()); sets.push({ k, members: P.get(t) }); } }
  const sink = ev();
  const arcs = [];
  const used = new Set(); // すでに矢印のある「始まり→終わり」の組(平行な矢印を避ける)
  const pairKey = (a, b) => `${a.id}>${b.id}`;
  const canEnd = (end, st) => !used.has(pairKey(st, end));
  const arc = (from, to, task) => { arcs.push({ from, to, task }); from.outA.push(arcs.length - 1); to.inA.push(arcs.length - 1); used.add(pairKey(from, to)); };
  // ダミーを減らす: 先行の集合 P が別の集合 P' に真に含まれるとき、P の開始の事象から P' の開始の事象へダミーを 1 本出せば、
  // P のタスクは P' へ個別につながなくてよい。大きい部分集合から順に選び、P' のタスクを覆う(依存関係の意味は変わらない)
  const covered = new Map(); // 集合 → その集合のタスクのうち、部分集合のダミーで覆ったタスク
  for (const big of sets) {
    const subs = sets.filter((s) => s !== big && s.members.length < big.members.length && s.members.every((m) => big.members.includes(m)))
      .sort((a, b) => b.members.length - a.members.length || a.k.localeCompare(b.k));
    const cov = new Set();
    for (const s of subs) {
      if (s.members.every((m) => cov.has(m))) continue;
      arc(startOf.get(s.k), startOf.get(big.k), null);
      for (const m of s.members) cov.add(m);
    }
    covered.set(big, cov);
  }
  // タスクごとに、自分がつながる必要のある後続の集合(部分集合のダミーで覆われていないもの)
  const Q = new Map(tasks.map((t) => [t, sets.filter((s) => s.members.includes(t) && !covered.get(s).has(t))]));
  for (const t of tasks) {
    const st = startOf.get(key(P.get(t)));
    const q = Q.get(t);
    // 後続の集合が 1 つだけなら、その開始の事象に直接入れる。なければ終わりの事象に入れる
    let target = null;
    const isLast = !sets.some((s) => s.members.includes(t));
    if (isLast) target = sink;
    else if (q.length === 1) target = startOf.get(q[0].k);
    if (target && canEnd(target, st)) { arc(st, target, t); t.endEv = target; continue; }
    const f = ev();
    arc(st, f, t);
    t.endEv = f;
    if (isLast) arc(f, sink, null);
    for (const s of q) arc(f, startOf.get(s.k), null);
  }
  // 入る矢印のない事象(使われなかった開始の事象)を除き、番号を振り直す
  const live = events.filter((e) => e === src || e.inA.length || e.outA.length);
  // 順位(始まりからの矢印の数の最大)
  const rank = new Map([[src, 0]]);
  const ordE = [];
  const indeg = new Map(live.map((e) => [e, e.inA.length]));
  const q = [src];
  while (q.length) {
    const e = q.shift();
    ordE.push(e);
    for (const ai of e.outA) {
      const to = arcs[ai].to;
      rank.set(to, Math.max(rank.get(to) ?? 0, rank.get(e) + 1));
      indeg.set(to, indeg.get(to) - 1);
      if (!indeg.get(to)) q.push(to);
    }
  }
  return { events: live, arcs, rank, src, sink };
}
// opt.part: 'diagram' なら矢印の図だけ、'table' ならタスクの表だけ(opt.rows でその範囲 [始め, 終わり))を描く(印刷でページを分けるとき)
function renderAOA(r, opt = {}) {
  const tasks = r.tasks;
  const out = [];
  const M = 30, RX = 150, RY = 80, R = 15, TOP = 90;
  if (!tasks.length) return wrapSvg(400, 80, T_(M, 40, 'WBS にタスクがありません', { fs: 13 }));
  const g = buildAOA(tasks);
  // 2 順位以上をまたぐ矢印は、途中の順位に見えない点を置いて折れ線で描く(丸や他の矢印の上を通らないため)
  const pts = []; // 配置する点(事象と、見えない点)
  const lbl = []; // 矢印の文字(線の上に重なっても読めるよう、白い縁取りを付けて最後に描く)
  const chain = g.arcs.map((a) => {
    const r0 = g.rank.get(a.from), r1 = g.rank.get(a.to);
    const c = [a.from];
    for (let k = r0 + 1; k < r1; k++) { const v = { id: 1e6 + pts.length, virtual: true, rank: k }; pts.push(v); c.push(v); }
    c.push(a.to);
    return c;
  });
  const rankOf = (p) => (p.virtual ? p.rank : g.rank.get(p) ?? 0);
  const prevOf = new Map(); // 点 → 1 つ前の順位の、つながる点の一覧
  for (const c of chain) for (let i = 1; i < c.length; i++) { if (!prevOf.has(c[i])) prevOf.set(c[i], []); prevOf.get(c[i]).push(c[i - 1]); }
  const byRank = new Map();
  for (const p of [...g.events, ...pts]) { const k = rankOf(p); if (!byRank.has(k)) byRank.set(k, []); byRank.get(k).push(p); }
  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  // 各順位の中の並び: 最初は作られた順、次に前の順位の平均の位置で並べ直す(1 回)
  const yOf = new Map();
  for (const k of ranks) {
    const list = byRank.get(k);
    if (k > 0) {
      const bary = (p) => { const ys = (prevOf.get(p) ?? []).map((q) => yOf.get(q)).filter((v) => v !== undefined); return ys.length ? ys.reduce((x, y) => x + y, 0) / ys.length : 0; };
      list.sort((a, b) => bary(a) - bary(b) || a.id - b.id);
    }
    list.forEach((p, i) => yOf.set(p, i - (list.length - 1) / 2));
  }
  const maxN = Math.max(...ranks.map((k) => byRank.get(k).length));
  const H = Math.max(1, maxN) * RY;
  const cx = (p) => M + R + rankOf(p) * RX;
  const cy = (p) => TOP + H / 2 + yOf.get(p) * RY;
  g.arcs.forEach((a, ai) => {
    const c = chain[ai];
    const P_ = c.map((p) => [cx(p), cy(p)]);
    // 始まりと終わりは丸の縁で切る
    const cut = (p, q, d) => { const L = Math.hypot(q[0] - p[0], q[1] - p[1]); return [p[0] + (q[0] - p[0]) / L * d, p[1] + (q[1] - p[1]) / L * d]; };
    P_[0] = cut(P_[0], P_[1], R);
    const n = P_.length - 1;
    P_[n] = cut(P_[n], P_[n - 1], R + 1);
    const [ex, ey] = P_[n], [px, py] = P_[n - 1];
    const L = Math.hypot(ex - px, ey - py), ux = (ex - px) / L, uy = (ey - py) / L;
    const crit = a.task ? a.task.crit : false;
    const color = crit ? COL.accent : COL.line;
    const d = P_.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');
    const ah = `M${ex} ${ey}L${ex - ux * 9 - uy * 4.5} ${ey - uy * 9 + ux * 4.5}L${ex - ux * 9 + uy * 4.5} ${ey - uy * 9 - ux * 4.5}Z`;
    let s = `<path d="${d}" fill="none" stroke="${color}" stroke-width="${crit ? 2.6 : 1.3}"${a.task ? '' : ' stroke-dasharray="5 4"'}/><path d="${ah}" fill="${color}"/>`;
    if (a.task) {
      const t = a.task;
      // 文字は最初の区間の中ほど、矢印の上側に置く
      const [sx, sy] = P_[0], [qx, qy] = P_[1];
      const L1 = Math.hypot(qx - sx, qy - sy), vx = (qx - sx) / L1, vy = (qy - sy) / L1;
      // 始まりの丸の近くは矢印が集まるので、区間の 6 割の位置に置く
      const mx = sx + (qx - sx) * 0.6, my = sy + (qy - sy) * 0.6;
      const nx = vy, ny = -vx;
      const sg = ny > 0 ? -1 : 1, off = 18 + 10 * Math.abs(vx);
      const lx = mx + nx * off * sg, ly = my + ny * off * sg;
      lbl.push(T_(lx, ly - 2, t.num, { fs: 12, anchor: 'middle', fill: color, weight: crit ? '600' : null, halo: true }) + T_(lx, ly + 12, `${fmtDays(t.days)}日`, { fs: 12, anchor: 'middle', fill: color, halo: true }));
      s = `<g ${sel(t)}><title>${esc(`${t.num} ${t.name}(${fmtDays(t.days)} 日)`)}</title>${s}<path d="${d}" fill="none" stroke="transparent" stroke-width="12"/></g>`;
    }
    out.push(s);
  });
  for (const e of g.events) out.push(`<circle cx="${cx(e)}" cy="${cy(e)}" r="${R}" fill="#fff" stroke="${COL.line}" stroke-width="1.5"/>`);
  out.push(`<g pointer-events="none">${lbl.join('')}</g>`); // 文字はクリックを通す(矢印を選び・ドラッグできるように)
  const W = M * 2 + R * 2 + Math.max(...ranks) * RX;
  const head0 = summaryText(r);
  if (opt.part === 'diagram') return wrapSvg(Math.max(W, textW(head0[0], 13) + 2 * M), TOP + H + M, T_(M, 26, head0[0], { fs: 13, weight: '600' }) + T_(M, 46, head0[1], { fs: 11, fill: COL.sub }) + out.join(''));
  // 下にタスクの表(管理番号・名前・日数・最早開始・最遅開始・余裕)
  const FS = 12, RH = 20;
  const cols = [['管理番号', 70], ['タスク', 260], ['日数', 50], ['最早開始', 70], ['最遅開始', 70], ['余裕', 50]];
  const tw = cols.reduce((a, c) => a + c[1], 0);
  let ty = opt.part === 'table' ? TOP - 30 : TOP + H + 30;
  const tbl = [];
  // 画面の図(分けない図)では、表の上に題を置く(題の右に表の保存のボタンを置くため。仕様書 7.3 節)
  if (!opt.part) { tbl.push(T_(M, ty + 13, 'タスクの表', { fs: 13, weight: '600' })); opt.collect?.anchors.push({ kind: 'table', index: opt.collect.tables.length, label: 'タスクの表', y: ty + 13, fs: 13 }); ty += 23; }
  const tbl0 = tbl.length, ty0 = ty;
  let x = M;
  tbl.push(`<rect x="${M}" y="${ty}" width="${tw}" height="${RH}" fill="${COL.head}" stroke="${COL.grid}"/>`);
  for (const [h, w] of cols) { tbl.push(T_(x + 5, ty + 14, h, { fs: FS, weight: '600' })); x += w; }
  ty += RH;
  const sorted = [...tasks].sort((a, b) => a.order - b.order);
  for (const t of opt.rows ? sorted.slice(opt.rows[0], opt.rows[1]) : sorted) {
    const cells = [t.num, clip(t.name, 250, FS), fmtDays(t.days), fmtDays(t.ES), fmtDays(t.LS), fmtDays(t.TF)];
    x = M;
    let row = `<rect x="${M}" y="${ty}" width="${tw}" height="${RH}" fill="#fff" stroke="${COL.grid}"/>`;
    cells.forEach((c, i) => { row += T_(x + 5, ty + 14, c, { fs: FS, fill: t.crit ? COL.accent : COL.text, weight: t.crit ? '600' : null }); x += cols[i][1]; });
    tbl.push(`<g ${sel(t)}>${row}</g>`);
    ty += RH;
  }
  const head = summaryText(r);
  opt.collect?.tables.push({ name: 'タスクの表', header: cols.map((c) => c[0]), rows: sorted.map((t) => [t.num, t.name, fmtDays(t.days), fmtDays(t.ES), fmtDays(t.LS), fmtDays(t.TF)]), frag: tbl.slice(tbl0).join(''), box: [M, ty0, tw, ty - ty0] });
  if (opt.part === 'table') return wrapSvg(Math.max(M + tw + M, textW(head[0], 13) + 2 * M), ty + M, T_(M, 26, head[0], { fs: 13, weight: '600' }) + tbl.join(''));
  const svgW = Math.max(W, M + tw + M, textW(head[0], 13) + 2 * M);
  return wrapSvg(svgW, ty + M, T_(M, 26, head[0], { fs: 13, weight: '600' }) + T_(M, 46, head[1], { fs: 11, fill: COL.sub }) + out.join('') + tbl.join(''));
}
function summaryText(r) {
  const cp = `クリティカルパス ${fmtDays(r.cp.T)} 日`;
  const sc = r.sched.finishDate === null ? '担当と休みを入れた日程 0 日' : `担当と休みを入れた日程 ${r.sched.spanDays} 日(${fmtDate(r.sched.start)} 〜 ${fmtDate(r.sched.finishDate)})`;
  return [`${cp} / ${sc}`, '赤い太線・赤字がクリティカルパスのタスク(余裕 0)。点線はダミー作業。日数・最早開始・最遅開始・余裕の単位は日'];
}

// ---- WBS の表(役割分担とガントチャートの左側。スライド 16・17 枚目の形)
function wbsTable(r) {
  const tasks = r.tasks;
  const levels = Math.max(1, ...tasks.map((t) => t.depth)) - 1; // 根とタスクの間の段の数
  const FS = 12, RH = 22;
  const colW = [];
  for (let k = 1; k <= levels; k++) {
    const names = r.bySec.WBS.filter((n) => n.depth === k && n.children.length).map((n) => `${n.num} ${n.name}`);
    colW.push(Math.min(170, Math.max(70, ...names.map((s) => textW(s, FS) + 12))));
  }
  const taskW = Math.min(330, Math.max(120, ...tasks.map((t) => textW(`${t.num} ${t.name}`, FS) + 12)));
  return { levels, colW, taskW, FS, RH };
}
// o.rows: 描くタスクの範囲 [始め, 終わり)(印刷で行を区切るとき)
function drawWbsLeft(r, L, x0, y0, extraCols, o = {}) {
  const out = [];
  const { levels, colW, taskW, FS, RH } = L;
  const tasks = o.rows ? r.tasks.slice(o.rows[0], o.rows[1]) : r.tasks;
  const rowOf = new Map(tasks.map((t, i) => [t, i]));
  // 途中の要素は、下のタスクの行をまとめたセル
  for (const n of r.bySec.WBS) {
    if (!n.parent || !n.children.length) continue;
    const lv = r.tasks.length ? n.depth : 0;
    const leaves = [];
    const walk = (x) => (x.children.length ? x.children.forEach(walk) : leaves.push(x));
    walk(n);
    const inRows = leaves.filter((t) => rowOf.has(t));
    if (!inRows.length) continue;
    const r0 = Math.min(...inRows.map((t) => rowOf.get(t))), r1 = Math.max(...inRows.map((t) => rowOf.get(t)));
    let x = x0;
    for (let k = 1; k < lv; k++) x += colW[k - 1];
    const w = colW[lv - 1], y = y0 + r0 * RH, h = (r1 - r0 + 1) * RH;
    const lines = wrap(`${n.num} ${n.name}`, w - 10, FS);
    const maxLines = Math.max(1, Math.floor(h / (FS * 1.3)));
    const shown = lines.slice(0, maxLines);
    if (lines.length > maxLines) shown[maxLines - 1] = clip(shown[maxLines - 1] + '……', w - 10, FS);
    let t = `<g ${sel(n)}><title>${esc(r.qname(n))}</title><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="${COL.grid}"/>`;
    const sy = y + h / 2 - (shown.length - 1) * FS * 1.3 / 2 + 4;
    shown.forEach((l, i) => { t += T_(x + 5, sy + i * FS * 1.3, l, { fs: FS }); });
    out.push(`${t}</g>`);
  }
  // タスクの行
  tasks.forEach((t, i) => {
    const y = y0 + i * RH;
    let x = x0;
    for (let k = 1; k < t.depth; k++) x += colW[k - 1];
    // 浅い段のタスクは、空いた段の分もタスクのセルに含める
    const w = x0 + colW.reduce((a, b) => a + b, 0) + taskW - x;
    let s = `<rect x="${x}" y="${y}" width="${w}" height="${RH}" fill="#fff" stroke="${COL.grid}"/>`;
    s += T_(x + 5, y + 15, clip(`${t.num} ${t.name}`, w - 10, FS), { fs: FS, fill: t.crit && o.crit !== false ? COL.accent : COL.text });
    let cx = x0 + colW.reduce((a, b) => a + b, 0) + taskW;
    for (const [w2, val, fill] of extraCols(t)) { s += `<rect x="${cx}" y="${y}" width="${w2}" height="${RH}" fill="#fff" stroke="${COL.grid}"/>` + T_(cx + 5, y + 15, clip(val, w2 - 10, FS), { fs: FS, fill }); cx += w2; }
    out.push(`<g ${sel(t)}><title>${esc(`${r.qname(t)}${t.note ? `\n${t.note}` : ''}`)}</title>${s}</g>`);
  });
  return out.join('');
}
function headerCells(L, x0, y0, h, extra) {
  const out = [];
  let x = x0;
  const names = [];
  for (let k = 1; k <= L.levels; k++) names.push(`第 ${k} 層`);
  const cols = names.map((n, i) => [n, L.colW[i]]).concat([['タスク', L.taskW]], extra);
  for (const [n, w] of cols) { out.push(`<rect x="${x}" y="${y0}" width="${w}" height="${h}" fill="${COL.head}" stroke="${COL.grid}"/>` + T_(x + w / 2, y0 + h / 2 + 4, n, { fs: L.FS, anchor: 'middle', weight: '600' })); x += w; }
  return { svg: out.join(''), x };
}

// ---- テスト項目(MOP)の表(仕様書 7.6 節)
// 左は FBS の階層(途中の要素は下の行をまとめたセル)。MOP 1 つにつき 1 行。MOP のない末端の要素は「(MOP なし)」の 1 行。
// 途中の要素や根に書いた MOP は、その要素の「全体」の行にする
// opt.rows: 表の行の範囲 [始め, 終わり)(印刷で行を区切るとき)。件数の表示は全体のまま
function renderMop(r, opt = {}) {
  const root = r.sec.FBS.root, F = r.bySec.FBS;
  const M = 20, TOP = 50, FS = 12, LH = FS * 1.35, PAD = 5, MINH = 22;
  const warned = new Set(r.checks.filter((c) => c.code === 'C3').map((c) => c.node));
  const hasP = !!r.sec.PBS;
  const realizedBy = new Map();
  if (hasP) for (const p of r.bySec.PBS) for (const f of p.R.realizes ?? []) { if (!realizedBy.has(f)) realizedBy.set(f, []); realizedBy.get(f).push(p); }
  const rows = [], own = new Map(), span = new Map();
  const walk = (n) => {
    const r0 = rows.length;
    n.mops.forEach((m, i) => rows.push({ n, i }));
    if (n.parent && !n.children.length && !n.mops.length) rows.push({ n, i: -1 });
    if (rows.length > r0) own.set(n, [r0, rows.length - 1]);
    n.children.forEach(walk);
    if (rows.length > r0) span.set(n, [r0, rows.length - 1]);
  };
  walk(root);
  const allMops = rows.filter((x) => x.i >= 0);
  const total0 = allMops.length, done0 = allMops.filter((x) => x.n.mopChecked[x.i]).length;
  if (opt.rows) {
    const keep = rows.slice(opt.rows[0], opt.rows[1]);
    rows.length = 0; rows.push(...keep); own.clear(); span.clear();
    rows.forEach((x, k) => {
      const o = own.get(x.n); own.set(x.n, o ? [o[0], k] : [k, k]);
      for (let a = x.n; a; a = a.parent) { const sp = span.get(a); span.set(a, sp ? [sp[0], k] : [k, k]); }
    });
  }
  const title = T_(M, 24, `テスト項目(MOP): ${root.name}`, { fs: 13, weight: '600' });
  if (!rows.length) return wrapSvg(Math.max(420, textW(`テスト項目(MOP): ${root.name}`, 13) + 2 * M), 80, title + T_(M, 50, 'FBS に要素がありません', { fs: 12 }));
  const LV = Math.max(0, ...F.filter((n) => n.parent && n.children.length).map((n) => n.depth));
  const label = (n) => (n.children.length || !n.parent ? `「${n.name}」全体` : n.name);
  const colW = [];
  for (let k = 1; k <= LV; k++) colW.push(Math.min(170, Math.max(70, ...F.filter((n) => n.depth === k && n.children.length).map((n) => textW(n.name, FS) + 12))));
  const funW = Math.min(240, Math.max(110, ...[...own.keys()].map((n) => textW(label(n), FS) + 12)));
  const chkW = 34;
  const mopW = Math.min(380, Math.max(170, ...rows.map((x) => (x.i < 0 ? 90 : textW(x.n.mops[x.i], FS) + 12))));
  const pbsName = (n) => (realizedBy.get(n) ?? []).map((p) => p.name).join('、');
  const pbsW = hasP ? Math.min(300, Math.max(130, ...[...own.keys()].map((n) => textW(pbsName(n), FS) + 12))) : 0;
  // 行の高さ: MOP の文の折り返しに合わせる。PBS の欄が収まらなければ、その要素の最後の行を高くする
  const mopLines = rows.map((x) => (x.i < 0 ? ['(MOP なし)'] : wrap(x.n.mops[x.i], mopW - 2 * PAD, FS)));
  const rh = mopLines.map((l) => Math.max(MINH, l.length * LH + 8));
  const fit = (n, w, t) => { const [a, b] = own.get(n); const need = wrap(t, w - 2 * PAD, FS).length * LH + 8; let h = 0; for (let k = a; k <= b; k++) h += rh[k]; if (need > h) rh[b] += need - h; };
  for (const n of own.keys()) { fit(n, funW + colW.slice(Math.max(0, (n.children.length || !n.parent ? n.depth : n.depth - 1))).reduce((a, b) => a + b, 0), label(n)); if (hasP) fit(n, pbsW, pbsName(n)); }
  const HY = TOP, HH = 26, Y0 = HY + HH;
  const ry = [Y0];
  for (const h of rh) ry.push(ry[ry.length - 1] + h);
  const x0 = M;
  const colX = [x0];
  for (const w of colW) colX.push(colX[colX.length - 1] + w);
  const funX = colX[colX.length - 1], chkX = funX + funW, mopX = chkX + chkW, pbsX = mopX + mopW, endX = pbsX + pbsW;
  const out = [];
  // 見出し
  const heads = colW.map((w, i) => [`第 ${i + 1} 層`, colX[i], w]).concat([['機能', funX, funW], ['済', chkX, chkW], ['テスト項目(MOP)', mopX, mopW]], hasP ? [['実現する PBS の要素', pbsX, pbsW]] : []);
  for (const [t, x, w] of heads) out.push(`<rect x="${x}" y="${HY}" width="${w}" height="${HH}" fill="${COL.head}" stroke="${COL.grid}"/>` + T_(x + w / 2, HY + 17, t, { fs: FS, anchor: 'middle', weight: '600' }));
  const cellRect = (x, y, w, h, wn) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${wn ? COL.warnFill : '#fff'}" stroke="${wn ? COL.warnLine : COL.grid}"${wn ? ' stroke-dasharray="5 3"' : ''}/>`;
  const cellText = (x, y, w, h, t) => {
    const lines = wrap(t, w - 2 * PAD, FS);
    const max = Math.max(1, Math.floor((h - 4) / LH));
    const shown = lines.slice(0, max);
    if (lines.length > max) shown[max - 1] = clip(`${shown[max - 1]}……`, w - 2 * PAD, FS);
    const sy = y + h / 2 - (shown.length - 1) * LH / 2 + 4;
    return shown.map((l, i) => T_(x + PAD, sy + i * LH, l, { fs: FS })).join('');
  };
  // 途中の要素: 下の行をまとめたセル
  for (const n of F) {
    if (!n.parent || !n.children.length || !span.has(n)) continue;
    const [a, b] = span.get(n), x = colX[n.depth - 1], w = colW[n.depth - 1], y = ry[a], h = ry[b + 1] - ry[a];
    out.push(`<g ${sel(n)}><title>${esc(r.qname(n))}</title>${cellRect(x, y, w, h, warned.has(n))}${cellText(x, y, w, h, n.name)}</g>`);
  }
  for (const [n, [a, b]] of own) {
    const lx = n.children.length || !n.parent ? colX[n.depth] ?? funX : colX[n.depth - 1];
    const y = ry[a], h = ry[b + 1] - ry[a], wn = warned.has(n);
    let g = `<g ${sel(n)}><title>${esc(r.qname(n))}</title>${cellRect(lx, y, chkX - lx, h, wn)}${cellText(lx, y, chkX - lx, h, label(n))}`;
    if (hasP) g += cellRect(pbsX, y, pbsW, h, false) + cellText(pbsX, y, pbsW, h, pbsName(n));
    out.push(`${g}</g>`);
    const atts = n.attrList.filter((x) => x.key === 'mop' || x.key === 'mop*');
    for (let k = a; k <= b; k++) {
      const i = rows[k].i, yy = ry[k], hh = rh[k];
      out.push(`<rect x="${chkX}" y="${yy}" width="${chkW}" height="${hh}" fill="#fff" stroke="${COL.grid}"/>`);
      if (i < 0) { out.push(`<g ${sel(n)}>${cellRect(mopX, yy, mopW, hh, wn)}${T_(mopX + PAD, yy + hh / 2 + 4, '(MOP なし)', { fs: FS, fill: COL.sub })}</g>`); continue; }
      const at = atts[i], ck = n.mopChecked[i];
      const lines = mopLines[k], sy = yy + hh / 2 - (lines.length - 1) * LH / 2 + 4;
      out.push(`<g data-id="${n.id}" data-start="${at.kstart}" data-end="${at.end}"><title>${esc(n.mops[i])}</title><rect x="${mopX}" y="${yy}" width="${mopW}" height="${hh}" fill="#fff" stroke="${COL.grid}"/>${lines.map((l, j) => T_(mopX + PAD, sy + j * LH, l, { fs: FS })).join('')}</g>`);
      const cx = chkX + chkW / 2, cy = yy + hh / 2;
      out.push(`<g data-mop="${n.id}|${i}" data-checked="${ck ? 1 : 0}"><title>${ck ? 'チェック済み(mop*:)。クリックで外す' : '未チェック(mop:)。クリックでチェック済みにする'}</title><rect x="${chkX + 1}" y="${yy + 1}" width="${chkW - 2}" height="${hh - 2}" fill="transparent"/><rect x="${cx - 7}" y="${cy - 7}" width="14" height="14" rx="2" fill="#fff" stroke="${COL.line}" stroke-width="1.3"/>${ck ? `<path d="M${cx - 4.5} ${cy}l3 3.2l6-6.6" fill="none" stroke="${COL.line}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` : ''}</g>`);
    }
  }
  if (opt.collect) {
    const anc = (n) => { const a = []; for (let x = n.children.length || !n.parent ? n : n.parent; x && x.parent; x = x.parent) a.unshift(x); return a; };
    opt.collect.anchors.push({ kind: 'table', index: opt.collect.tables.length, label: `テスト項目(MOP): ${root.name}`, y: 24, fs: 13 });
    opt.collect.tables.push({ name: 'テスト項目(MOP)', header: heads.map((h) => h[0]),
      rows: rows.map((x) => { const a = anc(x.n); return [...Array.from({ length: LV }, (_, k) => (a[k] ? a[k].name : '')), label(x.n), x.i >= 0 && x.n.mopChecked[x.i] ? '✓' : '', x.i < 0 ? '(MOP なし)' : x.n.mops[x.i], ...(hasP ? [pbsName(x.n)] : [])]; }),
      frag: out.join(''), box: [x0, HY, endX - x0, ry[ry.length - 1] - HY] });
  }
  const sub = `チェック済み ${done0} / ${total0} 件。済の欄をクリックすると、mop:(未チェック)と mop*:(チェック済み)が切り替わる${warned.size ? '。点線の黄色い枠は MOP がない要素(検査 C3)' : ''}`;
  const W = Math.max(endX + M, textW(sub, 11) + 2 * M, textW(`テスト項目(MOP): ${root.name}`, 13) + 2 * M);
  return wrapSvg(W, ry[ry.length - 1] + M, title + T_(M, 42, sub, { fs: 11, fill: COL.sub }) + out.join(''));
}

// ---- 役割分担(仕様書 7.4 節)
// opt.rows: タスクの表の範囲 [始め, 終わり)。opt.table === false ならタスクの表を描かない。opt.sum === false なら担当者ごとのまとめを描かない(印刷でページを分けるとき)
function renderRoles(r, opt = {}) {
  const M = 20, TOP = 46;
  if (!r.tasks.length) return wrapSvg(400, 80, T_(M, 40, 'WBS にタスクがありません', { fs: 13 }));
  const L = wbsTable(r);
  const pw = (list) => Math.min(200, Math.max(70, ...r.tasks.map((t) => textW(list(t), L.FS) + 12)));
  const byW = pw((t) => who(r, t.by)), rvW = pw((t) => who(r, t.review));
  const extra = [['作成', byW], ['確認', rvW], ['日数', 50]];
  const hc = headerCells(L, M, TOP, L.RH, extra);
  const table = opt.table !== false;
  const nRows = opt.rows ? opt.rows[1] - opt.rows[0] : r.tasks.length;
  const body = table ? drawWbsLeft(r, L, M, TOP + L.RH, (t) => [[byW, who(r, t.by) || '(なし)'], [rvW, who(r, t.review)], [50, fmtDays(t.days)]], { rows: opt.rows }) : '';
  const tableW = hc.x - M;
  if (opt.collect && table) {
    const anc = (t) => { const a = []; for (let x = t.parent; x && x.parent; x = x.parent) a.unshift(x); return a; };
    opt.collect.anchors.push({ kind: 'table', index: opt.collect.tables.length, label: `役割分担: ${r.sec.WBS.root.name}`, y: 28, fs: 13 });
    opt.collect.tables.push({ name: '役割分担', header: [...Array.from({ length: L.levels }, (_, k) => `第 ${k + 1} 層`), 'タスク', '作成', '確認', '日数'],
      rows: r.tasks.map((t) => { const a = anc(t); return [...Array.from({ length: L.levels }, (_, k) => (a[k] ? `${a[k].num} ${a[k].name}` : '')), `${t.num} ${t.name}`, who(r, t.by) || '(なし)', who(r, t.review), fmtDays(t.days)]; }),
      frag: hc.svg + body, box: [M, TOP, tableW, L.RH * (nRows + 1)] });
  }
  // 担当者ごとのまとめ
  let y = table ? TOP + L.RH * (nRows + 1) + 30 : TOP + 22;
  const sum = [];
  const titleW = textW(`役割分担: ${r.sec.WBS.root.name}`, 13); // 題が図の幅に収まるように
  if (opt.sum === false) return wrapSvg(Math.max(tableW, 450, titleW) + 2 * M, y - 30 + M, T_(M, 28, `役割分担: ${r.sec.WBS.root.name}`, { fs: 13, weight: '600' }) + hc.svg + body);
  sum.push(T_(M, y - 8, '担当者ごとのまとめ', { fs: 13, weight: '600' }));
  const cols = [['担当者', 120], ['作成するタスク', 100], ['作成の日数の合計', 130], ['確認するタスク', 100]];
  const sum0 = sum.length, sy0 = y, sumRows = [];
  let x = M;
  for (const [h, w] of cols) { sum.push(`<rect x="${x}" y="${y}" width="${w}" height="${L.RH}" fill="${COL.head}" stroke="${COL.grid}"/>` + T_(x + 5, y + 15, h, { fs: L.FS, weight: '600' })); x += w; }
  y += L.RH;
  for (const m of r.members) {
    const mk = r.tasks.filter((t) => t.by.includes(m)), rv = r.tasks.filter((t) => t.review.includes(m));
    const vals = [m.name, `${mk.length} 件`, `${fmtDays(mk.reduce((a, t) => a + t.days, 0))} 日`, `${rv.length} 件`];
    sumRows.push(vals);
    x = M;
    let row = '';
    vals.forEach((v, i) => { row += `<rect x="${x}" y="${y}" width="${cols[i][1]}" height="${L.RH}" fill="#fff" stroke="${COL.grid}"/>` + T_(x + 5, y + 15, clip(v, cols[i][1] - 10, L.FS), { fs: L.FS }); x += cols[i][1]; });
    sum.push(`<g data-id="m${r.members.indexOf(m)}" data-start="${m.start}" data-end="${m.end}">${row}</g>`);
    y += L.RH;
  }
  if (opt.collect) {
    opt.collect.anchors.push({ kind: 'table', index: opt.collect.tables.length, label: '担当者ごとのまとめ', y: sy0 - 8, fs: 13 });
    opt.collect.tables.push({ name: '担当者ごとのまとめ', header: cols.map((c) => c[0]), rows: sumRows, frag: sum.slice(sum0).join(''), box: [M, sy0, cols.reduce((a, c) => a + c[1], 0), y - sy0] });
  }
  const W = Math.max(tableW, 450, titleW) + 2 * M;
  return wrapSvg(W, y + M, T_(M, 28, `役割分担: ${r.sec.WBS.root.name}`, { fs: 13, weight: '600' }) + (table ? hc.svg + body : '') + sum.join(''));
}

// ---- ガントチャート(仕様書 7.5 節)
// 状態の塗り(仕様書 7.5 節)。実行前は白地に黒枠、完了は目立たない灰、問題発生だけを強調の色にする
const STATUS_FILL = { todo: '#fff', doing: COL.blue, done: '#bdbdb8', blocked: COL.accent };
const statusAttr = (st) => `fill="${STATUS_FILL[st]}"${st === 'todo' ? ` stroke="${COL.line}" stroke-width="1"` : ''}`;
// 遅れ: 今日より前の日に終わる予定で、完了になっていないタスク(today は 1970-01-01 からの日数)
const isLate = (r, t, today) => today !== null && t.status !== 'done' && today > r.sched.start + t.d1;
// ---- ガントチャートと担当者別ガントチャートで共通の部品
// 日付の目盛り(月・日・曜日の 3 段)と、本体の日の列(全体の休みは灰色)
function timeGrid(r, gx, TOP, HR, nDays, DW, bodyY, bodyH) {
  const s0 = r.sched.start, out = [];
  let mStart = 0;
  for (let d = 0; d <= nDays; d++) {
    const p = d < nDays ? dateParts(s0 + d) : null;
    if (d === nDays || (d > 0 && p.d === 1)) {
      const pp = dateParts(s0 + mStart);
      out.push(`<rect x="${gx + mStart * DW}" y="${TOP}" width="${(d - mStart) * DW}" height="${HR}" fill="${COL.head}" stroke="${COL.grid}"/>` + T_(gx + mStart * DW + 4, TOP + 15, `${pp.y}年${pp.m}月`, { fs: 11 }));
      mStart = d;
    }
  }
  for (let d = 0; d < nDays; d++) {
    const dn = s0 + d, p = dateParts(dn), x = gx + d * DW;
    const off = r.isOff(dn);
    out.push(`<rect x="${x}" y="${TOP + HR}" width="${DW}" height="${HR}" fill="${off ? COL.off : COL.head}" stroke="${COL.grid}"/>` + T_(x + DW / 2, TOP + HR + 15, String(p.d), { fs: 11, anchor: 'middle' }));
    out.push(`<rect x="${x}" y="${TOP + 2 * HR}" width="${DW}" height="${HR}" fill="${off ? COL.off : COL.head}" stroke="${COL.grid}"/>` + T_(x + DW / 2, TOP + 2 * HR + 15, WD_JA[p.w], { fs: 11, anchor: 'middle', fill: p.w === 0 ? '#b00020' : p.w === 6 ? '#1d4ed8' : COL.text }));
    out.push(`<rect x="${x}" y="${bodyY}" width="${DW}" height="${bodyH}" fill="${off ? COL.off : '#fff'}" stroke="${COL.grid}" stroke-width=".6"/>`);
  }
  return out;
}
const HATCH = '<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fff"/><path d="M0 0V6" stroke="#bbb" stroke-width="2"/></pattern></defs>';
// タスクの棒(休みの日で切り、続いている日は 1 本にする。日数 0 はひし形)
function barSvg(r, t, gx, DW, y, h, fill) {
  const s0 = r.sched.start;
  if (t.f === t.s) return `<path d="M${gx + t.s / 1000 * DW} ${y}l${h / 2} ${h / 2}l${-h / 2} ${h / 2}l${-h / 2} ${-h / 2}Z" ${fill}/>`;
  const segs = [];
  for (let d = t.d0; d <= t.d1; d++) {
    if (r.isOff(s0 + d) || t.by.some((m) => r.memberOff(m, s0 + d))) continue;
    const a = Math.max(t.s, d * 1000), b = Math.min(t.f, (d + 1) * 1000);
    if (b <= a) continue;
    if (segs.length && segs[segs.length - 1][1] === a) segs[segs.length - 1][1] = b; else segs.push([a, b]);
  }
  return segs.map(([a, b]) => `<rect x="${gx + a / 1000 * DW}" y="${y}" width="${(b - a) / 1000 * DW}" height="${h}" ${fill}/>`).join('');
}
// end: の線と今日の線
function markLines(r, gx, TOP, HR, nDays, DW, bottom, endD, today) {
  const s0 = r.sched.start, out = [];
  if (endD) {
    const x = gx + endD * DW;
    out.push(`<path d="M${x} ${TOP + HR}V${bottom + 6}" stroke="${COL.accent}" stroke-width="2" stroke-dasharray="6 3"/>` + T_(x + 3, bottom + 18, 'end', { fs: 11, fill: COL.accent }));
  }
  // 今日の線(今日の列の始まり。これより左で終わる棒が、完了でなければ遅れ)
  if (today !== null && today >= s0 && today < s0 + nDays) {
    const x = gx + (today - s0) * DW;
    out.push(`<path d="M${x} ${TOP + HR}V${bottom + 6}" stroke="${COL.line}" stroke-width="2"/>` + T_(x - 3, bottom + 18, '今日', { fs: 11, anchor: 'end', fill: COL.line, weight: '600' }));
  }
  return out;
}
// 凡例: 状態の塗り、遅れ、休み
// twoLines: 説明の文を 2 行目に回す(担当者別ガントチャート。図の幅が説明の文で広がりすぎないように)
function legendSvg(today, M, extra = '', lateMark = false, twoLines = false) {
  const lg = [];
  let lx = M;
  for (const k of Object.keys(STATUS)) {
    lg.push(`<rect x="${lx}" y="35" width="18" height="11" ${statusAttr(k)}/>` + T_(lx + 22, 45, STATUS[k], { fs: 11 }));
    lx += 22 + textW(STATUS[k], 11) + 14;
  }
  if (today !== null && lateMark) { lg.push(`<circle cx="${lx + 5}" cy="41" r="4" fill="${COL.accent}"/>`); lx += 12; }
  if (today !== null) { lg.push(T_(lx, 45, '遅れ', { fs: 11, fill: COL.accent, weight: '600' })); lx += textW('遅れ', 11); }
  const lateDef = today !== null ? `: 今日(${fmtDate(today)})より前に終わる予定で、完了になっていないタスク。` : '';
  const rest = `${twoLines ? '' : lateDef}灰色の列は全体の休み、斜線は担当者の休み。棒は休みの日を除いて描く${extra}`;
  if (!twoLines) { lg.push(T_(lx, 45, rest, { fs: 11, fill: COL.sub })); return { svg: lg.join(''), w: lx + textW(rest, 11) }; }
  if (lateDef) lg.push(T_(lx, 45, lateDef.replace(/。$/, ''), { fs: 11, fill: COL.sub }));
  const lines = ['灰色の列は全体の休み、斜線は担当者の休み。棒は休みの日を除いて描く。', ...extra.split('。').filter(Boolean).map((x) => `${x}。`)];
  lines.forEach((l, i) => lg.push(T_(M, 61 + i * 15, l, { fs: 11, fill: COL.sub })));
  return { svg: lg.join(''), w: Math.max(lx + textW(lateDef, 11), ...lines.map((l) => M + textW(l, 11))), h: 61 + (lines.length - 1) * 15 };
}
const lateText = (t, gx, DW, y, h) => T_(gx + t.f / 1000 * DW + (t.f === t.s ? h / 2 : 0) + 5, y + h / 2 + 4, '遅れ', { fs: 11, fill: COL.accent, weight: '600' });
const barTitle = (r, t, late) => `${t.num} ${t.name}: ${fmtDate(r.sched.start + t.d0)} 〜 ${fmtDate(r.sched.start + t.d1)}(${fmtDays(t.days)} 日)、${STATUS[t.status]}${late ? '、遅れ' : ''}`;
// 図の日数(日程の終わりと end: の遅い方まで)
const figDays = (r) => { const endD = r.sec.end && r.sec.end.date !== null ? r.sec.end.date - r.sched.start + 1 : 0; return { endD, nDays: Math.max(r.sched.spanDays, endD, 1) }; };

// opts.rows: 描くタスクの範囲 [始め, 終わり)(印刷で行を区切るとき)
function renderGantt(r, opts = {}) {
  const M = 20, TOP = 58;
  if (!r.tasks.length) return wrapSvg(400, 80, T_(M, 40, 'WBS にタスクがありません', { fs: 13 }));
  const L = wbsTable(r);
  const byW = Math.min(160, Math.max(60, ...r.tasks.map((t) => textW(who(r, t.by), L.FS) + 12)));
  const DW = 24, HR = L.RH; // 1 日の幅、見出しの 1 段の高さ
  const s0 = r.sched.start;
  const { endD, nDays } = figDays(r);
  const today = opts.today ? parseDate(opts.today) : null;
  const stW = 64;
  const left = headerCells(L, M, TOP, HR * 3, [['担当者', byW], ['状態', stW]]);
  const gx = left.x;
  const T = opts.rows ? r.tasks.slice(opts.rows[0], opts.rows[1]) : r.tasks;
  const bodyY = TOP + HR * 3, n = T.length;
  const out = [left.svg, ...timeGrid(r, gx, TOP, HR, nDays, DW, bodyY, n * L.RH)];
  for (let i = 0; i <= n; i++) out.push(`<path d="M${gx} ${bodyY + i * L.RH}H${gx + nDays * DW}" stroke="${COL.grid}" stroke-width=".6"/>`);
  // 担当者の個人の休み(タスクの行に薄い斜線)
  T.forEach((t, i) => {
    for (let d = 0; d < nDays; d++) {
      if (r.isOff(s0 + d)) continue;
      if (t.by.some((m) => r.memberOff(m, s0 + d))) out.push(`<rect x="${gx + d * DW + .5}" y="${bodyY + i * L.RH + .5}" width="${DW - 1}" height="${L.RH - 1}" fill="url(#hatch)"/>`);
    }
  });
  // 棒
  const handles = [];
  T.forEach((t, i) => {
    const y = bodyY + i * L.RH + 4, h = L.RH - 8;
    let s = barSvg(r, t, gx, DW, y, h, statusAttr(t.status));
    const late = isLate(r, t, today);
    if (late) s += lateText(t, gx, DW, y, h);
    out.push(`<g ${sel(t)}><title>${esc(barTitle(r, t, late))}</title>${s}</g>`);
    if (t.days > 0) handles.push(`<rect data-handle="${t.id}" data-days="${t.days}" data-dw="${DW}" data-gx="${gx}" x="${gx + t.f / 1000 * DW - 4}" y="${y - 1}" width="8" height="${h + 2}" fill="transparent"><title>ドラッグで日数を変える</title></rect>`);
  });
  out.push(...markLines(r, gx, TOP, HR, nDays, DW, bodyY + n * L.RH, endD, today));
  out.push(...handles);
  const body = drawWbsLeft(r, L, M, bodyY, (t) => [[byW, who(r, t.by)], [stW, STATUS[t.status], t.status === 'blocked' ? COL.accent : undefined]], { crit: false, rows: opts.rows });
  const head = summaryText(r);
  const lg = legendSvg(today, M);
  const W = gx + nDays * DW + M + 30;
  return wrapSvg(Math.max(W, textW(head[0], 13) + 2 * M, lg.w + M), bodyY + n * L.RH + 30 + M, HATCH + T_(M, 24, head[0], { fs: 13, weight: '600' })
    + lg.svg + out.join('') + body);
}

// ---- 担当者別ガントチャート(仕様書 7.7 節)
// 担当者 1 人につき 1 行。その人が作成者(by:)のタスクの棒を日程どおりに並べる。左に作成の日数・稼働率・確認の件数
function peopleLoad(r) {
  const s0 = r.sched.start, { nDays } = figDays(r);
  const rows = r.members.map((m, i) => {
    const tasks = r.tasks.filter((t) => t.by.includes(m));
    let cap = 0;
    for (let d = 0; d < nDays; d++) if (!r.isOff(s0 + d) && !r.memberOff(m, s0 + d)) cap++;
    const days = tasks.reduce((a, t) => a + t.days, 0);
    return { m, i, tasks, days, cap, rate: cap ? days / (cap * 1000) : null, review: r.tasks.filter((t) => t.review.includes(m)).length };
  });
  const none = r.tasks.filter((t) => !t.by.length);
  return { rows, none: none.length ? { tasks: none, days: none.reduce((a, t) => a + t.days, 0) } : null, nDays };
}
// opts.rows: 描く行の範囲 [始め, 終わり)(印刷で行を区切るとき。横棒の長さの基準は全体のまま)
function renderPeople(r, opts = {}) {
  const M = 20, TOP = 108, FS = 12, RH = 26, HR = 22, DW = 24;
  if (!r.tasks.length) return wrapSvg(400, 80, T_(M, 40, 'WBS にタスクがありません', { fs: 13 }));
  const today = opts.today ? parseDate(opts.today) : null;
  const s0 = r.sched.start, { endD } = figDays(r);
  const ld = peopleLoad(r), nDays = ld.nDays;
  // 並び: 書いた順(既定)。作成の日数か稼働率で、少ない順・多い順に並べ替えられる(表示だけ。同じなら書いた順)
  const sort = opts.sort && ['days', 'rate'].includes(opts.sort.key) && ['asc', 'desc'].includes(opts.sort.dir) ? opts.sort : null;
  const rows = [...ld.rows];
  if (sort) {
    const v = (x) => (sort.key === 'days' ? x.days : x.rate ?? -1);
    rows.sort((a, b) => (sort.dir === 'asc' ? v(a) - v(b) : v(b) - v(a)) || a.i - b.i);
  }
  const all = rows.map((x) => ({ name: x.m.name, member: x.m, i: x.i, tasks: x.tasks, days: x.days, rate: x.rate, review: x.review }));
  if (ld.none) all.push({ name: '(担当なし)', member: null, tasks: ld.none.tasks, days: ld.none.days, rate: null, review: null });
  const nameW = Math.min(160, Math.max(70, ...all.map((x) => textW(x.name, FS) + 12)));
  const daysW = 150, rateW = 70, revW = 52;
  // 横棒の長さは、担当者のうち作成の日数がいちばん多い人を最長にする(担当なしの行は含めない。はみ出すときは最長で止める)
  const maxDays = Math.max(1, ...rows.map((x) => x.days));
  const mark = (k) => (sort?.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
  const cols = [['担当者', nameW, null], [`作成の日数${mark('days')}`, daysW, 'days'], [`稼働率${mark('rate')}`, rateW, 'rate'], ['確認', revW, null]];
  const out = [];
  let x = M;
  for (const [t, w, k] of cols) {
    const cell = `<rect x="${x}" y="${TOP}" width="${w}" height="${HR * 3}" fill="${COL.head}" stroke="${COL.grid}"/>` + T_(x + w / 2, TOP + HR * 1.5 + 4, t, { fs: FS, anchor: 'middle', weight: '600' });
    out.push(k ? `<g data-sort="${k}"><title>クリックで並べ替える(書いた順 → 少ない順 → 多い順)</title>${cell}</g>` : cell);
    x += w;
  }
  const shown = opts.rows ? all.slice(opts.rows[0], opts.rows[1]) : all;
  const gx = x, bodyY = TOP + HR * 3, n = shown.length;
  out.push(...timeGrid(r, gx, TOP, HR, nDays, DW, bodyY, n * RH));
  for (let i = 0; i <= n; i++) out.push(`<path d="M${gx} ${bodyY + i * RH}H${gx + nDays * DW}" stroke="${COL.grid}" stroke-width=".6"/>`);
  shown.forEach((row, i) => {
    const y = bodyY + i * RH;
    // 本人の休み(その人の行に斜線)
    if (row.member) for (let d = 0; d < nDays; d++) if (!r.isOff(s0 + d) && r.memberOff(row.member, s0 + d)) out.push(`<rect x="${gx + d * DW + .5}" y="${y + .5}" width="${DW - 1}" height="${RH - 1}" fill="url(#hatch)"/>`);
    // 左の欄
    let cx = M;
    const cell = (w, inner) => { const c = `<rect x="${cx}" y="${y}" width="${w}" height="${RH}" fill="#fff" stroke="${COL.grid}"/>${inner}`; cx += w; return c; };
    let left = cell(nameW, T_(cx + 5, y + 17, clip(row.name, nameW - 10, FS), { fs: FS, fill: row.member ? COL.text : COL.sub }));
    const bw = Math.round((daysW - 64) * Math.min(1, row.days / maxDays) * 10) / 10;
    left += cell(daysW, `<rect x="${cx + 5}" y="${y + 7}" width="${bw}" height="${RH - 14}" fill="${COL.sub}"/>` + T_(cx + daysW - 6, y + 17, `${fmtDays(row.days)} 日`, { fs: FS, anchor: 'end' }));
    left += cell(rateW, T_(cx + rateW - 6, y + 17, row.rate === null ? '―' : `${Math.round(row.rate * 100)}%`, { fs: FS, anchor: 'end' }));
    left += cell(revW, T_(cx + revW - 6, y + 17, row.review === null ? '―' : `${row.review} 件`, { fs: FS, anchor: 'end' }));
    out.push(row.member ? `<g data-id="m${row.i}" data-start="${row.member.start}" data-end="${row.member.end}"><title>${esc(row.name)}</title>${left}</g>` : left);
    // 棒(管理番号を書き、入りきれば名前も書く)
    for (const t of row.tasks) {
      const by = y + 4, h = RH - 8;
      // 隣り合うタスクの棒が 1 本に見えないよう、塗りの棒には白い縁を付ける
      let s = barSvg(r, t, gx, DW, by, h, statusAttr(t.status) + (t.status === 'todo' ? '' : ' stroke="#fff" stroke-width="1"'));
      if (t.f > t.s) {
        const x0 = gx + t.s / 1000 * DW, w0 = (t.f - t.s) / 1000 * DW;
        const label = textW(`${t.num} ${t.name}`, 11) + 8 <= w0 ? `${t.num} ${t.name}` : textW(t.num, 11) + 8 <= w0 ? t.num : '';
        if (label) s += T_(x0 + 4, by + h / 2 + 4, label, { fs: 11, fill: t.status === 'doing' || t.status === 'blocked' ? '#fff' : COL.text });
      }
      // 遅れ: 棒の右上にえんじの丸を付ける(次のタスクの棒と重ならないよう、文字ではなく印にする)
      const late = isLate(r, t, today);
      if (late) s += `<circle cx="${gx + t.f / 1000 * DW + (t.f === t.s ? h / 2 : 0) - 1}" cy="${by + 1}" r="4" fill="${COL.accent}" stroke="#fff" stroke-width="1"/>`;
      out.push(`<g ${sel(t)}><title>${esc(barTitle(r, t, late))}</title>${s}</g>`);
    }
  });
  out.push(...markLines(r, gx, TOP, HR, nDays, DW, bodyY + n * RH, endD, today));
  const title = `担当者別ガントチャート(担当を入れた日程 ${r.sched.spanDays} 日、${fmtDate(s0)} 〜 ${fmtDate(r.sched.finishDate)})`;
  const lg = legendSvg(today, M, '。稼働率は、作成の日数 ÷ その人が作業できる日数(図の期間から全体の休みと本人の休みを除く)。見出しのクリックで並べ替え', true, true);
  const W = gx + nDays * DW + M + 30;
  return wrapSvg(Math.max(W, textW(title, 13) + 2 * M, lg.w + M), bodyY + n * RH + 30 + M, HATCH + T_(M, 24, title, { fs: 13, weight: '600' }) + lg.svg + out.join(''));
}

// ---- サマリー(仕様書 7.8 節)。計画の概要・タスクの進み具合・予定との比べ・遅れと問題発生・担当者ごと・MOP・警告を 1 枚にまとめる
// 今日までに終わる予定だったタスクの長さ(1/1000 日)。日程どおりに進んだとき、今日の始まりまでに済んでいるはずの長さ
function plannedByToday(r, today) {
  if (today === null) return null;
  const T = (today - r.sched.start) * 1000;
  return r.tasks.reduce((a, t) => a + Math.min(t.days, workUntil(r, t, T)), 0);
}
const SUM_CAT = [['検査 C1', 'C1: FBS に対応する PBS'], ['検査 C2', 'C2: PBS に対応する FBS'], ['検査 C3', 'C3: FBS の MOP'], ['検査 C4', 'C4: PBS のためのタスク'], ['検査 C5', 'C5: タスクの担当者'], ['書き方', '書き方'], ['日程', '日程']];
function renderSummary(r, opts = {}) {
  const M = 20, FS = 12, RH = 22, W0 = 760;
  const today = opts.today ? parseDate(opts.today) : null;
  const s0 = r.sched.start, out = [];
  let y = 24;
  let lastH2 = null;
  const h2 = (t) => { y += 40; lastH2 = { label: t, y }; out.push(T_(M, y, t, { fs: 14, weight: '600' })); out.push(`<path d="M${M} ${y + 6}H${M + W0}" stroke="${COL.grid}"/>`); y += 8; };
  const line = (t, o = {}) => { y += 18; out.push(T_(M + (o.ind ?? 0), y, t, { fs: o.fs ?? FS, fill: o.fill })); };
  const pct = (a, b) => (b > 0 ? `${Math.round(a / b * 100)}%` : '―');
  // 表: cols は [見出し, 幅, 右寄せ]。rows は { cells, id(選べるとき), start, end }
  const table = (cols, rows) => {
    let x = M;
    const o0 = out.length, y0 = y;
    for (const [h, w] of cols) { out.push(`<rect x="${x}" y="${y}" width="${w}" height="${RH}" fill="${COL.head}" stroke="${COL.grid}"/>` + T_(x + 5, y + 15, h, { fs: FS, weight: '600' })); x += w; }
    y += RH;
    for (const row of rows) {
      x = M;
      let g = '';
      row.cells.forEach((c, i) => {
        const [, w, right] = cols[i];
        const v = typeof c === 'object' ? c : { t: c };
        g += `<rect x="${x}" y="${y}" width="${w}" height="${RH}" fill="#fff" stroke="${COL.grid}"/>` + T_(right ? x + w - 6 : x + 5, y + 15, clip(String(v.t), w - 10, FS), { fs: FS, anchor: right ? 'end' : null, fill: v.fill, weight: v.weight });
        x += w;
      });
      out.push(row.id ? `<g data-id="${row.id}" data-start="${row.start}" data-end="${row.end}">${row.title ? `<title>${esc(row.title)}</title>` : ''}${g}</g>` : g);
      y += RH;
    }
    if (opts.collect && lastH2) {
      opts.collect.anchors.push({ kind: 'table', index: opts.collect.tables.length, label: lastH2.label, y: lastH2.y, fs: 14 });
      opts.collect.tables.push({ name: lastH2.label, header: cols.map((c) => c[0]), rows: rows.map((row) => row.cells.map((c) => String(typeof c === 'object' ? c.t : c))), frag: out.slice(o0).join(''), box: [M, y0, cols.reduce((a, c) => a + c[1], 0), y - y0] });
      lastH2 = null;
    }
  };
  // 横棒(部分の並び。[長さ, 塗りの属性])
  const bar = (parts, total, w = 420) => {
    y += 8;
    let x = M;
    out.push(`<rect x="${M}" y="${y}" width="${w}" height="16" fill="#fff" stroke="${COL.line}"/>`);
    for (const [v, fill] of parts) { if (!v || !total) continue; const bw = w * v / total; out.push(`<rect x="${x}" y="${y}" width="${bw}" height="16" ${fill}/>`); x += bw; }
    out.push(`<rect x="${M}" y="${y}" width="${w}" height="16" fill="none" stroke="${COL.line}"/>`);
    y += 16;
  };

  // 1. 計画の概要
  out.push(T_(M, y, `サマリー: ${r.sec.WBS.root.name}`, { fs: 15, weight: '600' }));
  h2('計画の概要');
  line(`期間: ${fmtDate(s0)} 〜 ${r.sec.end && r.sec.end.date !== null ? fmtDate(r.sec.end.date) : '(end: なし)'}${today !== null ? `   今日: ${fmtDate(today)}` : ''}`);
  line(summaryText(r)[0]);
  line(`タスク ${r.tasks.length} 件、担当者 ${r.members.length} 人`);

  // 2. タスクの進み具合
  h2('タスクの進み具合');
  const keys = Object.keys(STATUS);
  const cnt = Object.fromEntries(keys.map((k) => [k, r.tasks.filter((t) => t.status === k)]));
  const days = Object.fromEntries(keys.map((k) => [k, cnt[k].reduce((a, t) => a + t.days, 0)]));
  const totalDays = r.tasks.reduce((a, t) => a + t.days, 0);
  bar(['done', 'doing', 'blocked', 'todo'].map((k) => [days[k], statusAttr(k)]), totalDays);
  let lx = M + 436;
  out.push(T_(lx, y - 3, `完了 ${pct(days.done, totalDays)}(日数)、${pct(cnt.done.length, r.tasks.length)}(件数)`, { fs: FS, weight: '600' }));
  y += 6;
  table([['状態', 120], ['件数', 80, true], ['日数', 100, true]], keys.map((k) => ({ cells: [STATUS[k], `${cnt[k].length} 件`, `${fmtDays(days[k])} 日`] })).concat([{ cells: [{ t: '計', weight: '600' }, { t: `${r.tasks.length} 件`, weight: '600' }, { t: `${fmtDays(totalDays)} 日`, weight: '600' }] }]));

  // 3. 予定との比べ
  h2('予定との比べ');
  const plan = plannedByToday(r, today);
  if (plan === null) line('今日の日付がないため、比べられません。', { fill: COL.sub });
  else {
    const doneD = days.done;
    const diff = plan - doneD;
    line(`今日までに終わる予定: ${fmtDays(plan)} 日分(全体の ${pct(plan, totalDays)})`);
    line(`完了: ${fmtDays(doneD)} 日分(全体の ${pct(doneD, totalDays)})`);
    line(diff > 0 ? `予定より ${fmtDays(diff)} 日分遅れています` : diff < 0 ? `予定より ${fmtDays(-diff)} 日分進んでいます` : '予定どおりです', { fill: diff > 0 ? COL.accent : COL.text, fs: 13 });
    bar([[Math.min(doneD, totalDays), statusAttr('done')]], totalDays);
    if (totalDays > 0) { const px = M + 420 * Math.min(plan, totalDays) / totalDays; out.push(`<path d="M${px} ${y - 22}V${y + 6}" stroke="${COL.line}" stroke-width="2"/>` + T_(px, y + 18, '今日までの予定', { fs: 11, anchor: 'middle' })); y += 14; }
    out.push(T_(M + 436, y - 3 - 14, '灰色: 完了した日数', { fs: 11, fill: COL.sub }));
  }

  // 4. 遅れと問題発生
  h2('遅れと問題発生');
  const lates = r.tasks.filter((t) => isLate(r, t, today) || t.status === 'blocked');
  if (!lates.length) line(today === null ? '問題発生のタスクはありません(今日の日付がないため、遅れは調べていません)。' : '遅れと問題発生のタスクはありません。', { fill: COL.sub });
  else {
    y += 8;
    table([['管理番号', 80], ['タスク', 260], ['担当', 120], ['予定の終わり', 100], ['状態', 80], ['遅れ', 50]], lates.map((t) => {
      const late = isLate(r, t, today);
      return { id: t.id, start: t.start, end: t.end, title: r.qname(t), cells: [t.num, t.name, who(r, t.by) || '(なし)', fmtDate(s0 + t.d1), { t: STATUS[t.status], fill: t.status === 'blocked' ? COL.accent : undefined }, { t: late ? '遅れ' : '', fill: COL.accent, weight: '600' }] };
    }));
  }

  // 5. 担当者ごとの状況
  h2('担当者ごとの状況');
  y += 8;
  const prow = (name, list, m, i) => {
    const c = (k) => `${list.filter((t) => t.status === k).length}`;
    const nl = list.filter((t) => isLate(r, t, today)).length;
    return { id: m ? `m${i}` : null, start: m?.start, end: m?.end, cells: [m ? name : { t: name, fill: COL.sub }, c('todo'), c('doing'), c('done'), { t: c('blocked'), fill: c('blocked') !== '0' ? COL.accent : undefined }, { t: today === null ? '―' : `${nl}`, fill: nl ? COL.accent : undefined, weight: nl ? '600' : null }, `${fmtDays(list.reduce((a, t) => a + t.days, 0))} 日`] };
  };
  const prows = r.members.map((m, i) => prow(m.name, r.tasks.filter((t) => t.by.includes(m)), m, i));
  const none = r.tasks.filter((t) => !t.by.length);
  if (none.length) prows.push(prow('(担当なし)', none, null));
  table([['担当者', 120], ['実行前', 64, true], ['実行中', 64, true], ['完了', 64, true], ['問題発生', 72, true], ['遅れ', 56, true], ['作成の日数', 90, true]], prows);

  // 6. テスト項目(MOP)
  if (r.sec.FBS) {
    h2('テスト項目(MOP)');
    const all = r.bySec.FBS.flatMap((n) => n.mopChecked);
    const ok = all.filter(Boolean).length;
    if (!all.length) line('MOP はまだ書かれていません。', { fill: COL.sub });
    else {
      bar([[ok, `fill="${COL.blue}"`]], all.length);
      out.push(T_(M + 436, y - 3, `チェック済み ${ok} / ${all.length} 件(${pct(ok, all.length)})`, { fs: FS, weight: '600' }));
    }
  }

  // 7. 検査の警告
  h2('検査の警告');
  const ws = r.diags.filter((d) => d.level === 'warn');
  if (!ws.length) line('警告はありません。', { fill: COL.sub });
  else {
    y += 8;
    const known = SUM_CAT.map(([c, label]) => [label, ws.filter((d) => d.cat === c).length]).filter(([, n]) => n);
    const other = ws.filter((d) => !SUM_CAT.some(([c]) => c === d.cat)).length;
    if (other) known.push(['その他', other]);
    table([['項目', 220], ['件数', 80, true]], known.map(([l, n]) => ({ cells: [l, `${n} 件`] })).concat([{ cells: [{ t: '計', weight: '600' }, { t: `${ws.length} 件`, weight: '600' }] }]));
    line('警告の中身は、左下の診断の欄で見られます。', { fill: COL.sub, fs: 11 });
  }
  return wrapSvg(Math.max(W0, textW(`サマリー: ${r.sec.WBS.root.name}`, 15)) + 2 * M, y + M, out.join('')); // 題が図の幅に収まるように
}

const VIEWS = [
  { id: 'fbs', label: 'FBS', need: ['FBS'] },
  { id: 'pbs', label: 'PBS', need: ['PBS'] },
  { id: 'match', label: 'FBS と PBS の対応', need: ['FBS', 'PBS'] },
  { id: 'wbs', label: 'WBS', need: ['WBS'] },
  { id: 'aoa', label: 'アローダイアグラム', need: ['WBS'] },
  { id: 'roles', label: '役割分担', need: ['WBS', 'members'] },
  { id: 'gantt', label: 'ガントチャート', need: ['WBS', 'start'] },
  { id: 'people', label: '担当者別ガントチャート', need: ['WBS', 'start', 'members'] },
  { id: 'mop', label: 'テスト項目(MOP)', need: ['FBS'] },
  { id: 'summary', label: 'サマリー', need: ['WBS', 'start'] },
];
const GANTT_MAX_DAYS = 1096;
function render(r, view, opts = {}) {
  const v = VIEWS.find((x) => x.id === view);
  const miss = v.need.filter((k) => !r.sec[k]);
  if (miss.length) return { svg: null, message: `このビューには ${miss.map((k) => `「${k}:」`).join('と')}の節が必要です。テキストに書いていないので描けません。` };
  switch (view) {
    case 'fbs': return { svg: renderTree(r, 'FBS') };
    case 'pbs': return { svg: renderTree(r, 'PBS') };
    case 'match': return { svg: renderMatch(r) };
    case 'mop': return { svg: renderMop(r, { collect: opts.collect }) };
    case 'summary': return { svg: renderSummary(r, opts) };
    case 'wbs': return { svg: renderTree(r, 'WBS') };
    case 'aoa': return { svg: renderAOA(r, { collect: opts.collect }) };
    case 'roles': return { svg: renderRoles(r, { collect: opts.collect }) };
    case 'gantt': case 'people': {
      // 期間が長すぎると図が大きくなりすぎて固まるので、描かずに知らせる(仕様書 7.5 節)
      const { nDays } = figDays(r);
      if (nDays > GANTT_MAX_DAYS) return { svg: null, message: `ガントチャートの期間が ${nDays} 日あり、描ける長さ(${GANTT_MAX_DAYS} 日。約 3 年)を超えるので描きません。end: の日付や days: の値を確かめてください。` };
      return { svg: view === 'gantt' ? renderGantt(r, opts) : renderPeople(r, opts) };
    }
    default: return { svg: null, message: '' };
  }
}

// タスク t が、開始から時刻 T(1/1000 日)までに作業できる長さ(休みの日を除く)。ガントチャートのドラッグで使う(仕様書 11.3 節)
function workUntil(r, t, T) {
  let w = 0;
  for (let d = Math.floor(t.s / 1000); d * 1000 < T; d++) {
    const dn = r.sched.start + d;
    if (r.isOff(dn) || t.by.some((m) => r.memberOff(m, dn))) continue;
    w += Math.max(0, Math.min(T, (d + 1) * 1000) - Math.max(t.s, d * 1000));
  }
  return w;
}

// ---- 印刷のページ(仕様書 9 章)。1 ページに収めると元の大きさの半分より小さくなるビューは、ページを分ける
// 基準は A4 横(96 dpi で 1123 × 794 px)から内側の空き 10 mm ずつを引いた大きさ。サマリーは縦向きで、分けない
const PRINT_W = 1047, PRINT_H = 718, PRINT_MIN = 0.5;
const svgSize = (svg) => { const m = /width="(\d+)" height="(\d+)"/.exec(svg); return [+m[1], +m[2]]; };
// portrait: 縦向きのページ(幅と高さを入れ替える)
const printScale = (svg, portrait) => { const [w, h] = svgSize(svg); return portrait ? Math.min(1, PRINT_H / w, PRINT_W / h) : Math.min(1, PRINT_W / w, PRINT_H / h); };
// 行で区切る: draw([始め, 終わり)) が描くページを、縮み方が target 以上に収まる行数ずつに分ける
function splitRanges(n, draw, target, portrait) {
  const ranges = [];
  let a = 0;
  while (a < n) {
    let lo = 1, hi = n - a;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (printScale(draw([a, a + mid]), portrait) >= target) lo = mid; else hi = mid - 1; }
    ranges.push([a, a + lo]);
    a += lo;
  }
  return ranges;
}
const splitRows = (n, draw, target, portrait) => splitRanges(n, draw, target, portrait).map(draw);
// 表の行の目標の縮み方: 幅で決まる縮み方(高さでそれ以上は縮めない。幅のために半分より小さくなる表は、行で区切っても幅の分は縮む)
const rowTarget = (svg, portrait) => Math.min(1, (portrait ? PRINT_H : PRINT_W) / svgSize(svg)[0]);
// 縦向きで印刷するページ: サマリーと、分けたときのアローダイアグラムのタスクの表(1 ページ目の矢印の図より後)
const printPortrait = (view, i) => view === 'summary' || (view === 'aoa' && i > 0);
function printPages(r, view, opts = {}) {
  const full = render(r, view, opts);
  if (!full.svg) return [];
  if (view === 'summary' || printScale(full.svg) >= PRINT_MIN) return [full.svg];
  if (view === 'fbs' || view === 'pbs' || view === 'wbs') {
    // 木: 第 1 層の要素ごとに分ける。1 つでも半分より小さくなる要素は、その子ごとに分ける。小さいものは同じページにまとめる
    const key = view.toUpperCase(), root = r.sec[key].root;
    const sub = (n) => { const a = [n]; for (const c of n.children) a.push(...sub(c)); return a; };
    const draw = (units) => { const keep = new Set(); for (const u of units) { sub(u).forEach((x) => keep.add(x)); for (let a = u.parent; a; a = a.parent) keep.add(a); } return renderTree(r, key, { keep }); };
    let units = [...root.children];
    for (let changed = true; changed;) {
      changed = false;
      const next = [];
      for (const u of units) {
        if (u.children.some((c) => c.children.length) && printScale(draw([u])) < PRINT_MIN) { next.push(...u.children); changed = true; } else next.push(u);
      }
      units = next;
    }
    const pages = [];
    let cur = [], s0 = 1;
    for (const u of units) {
      if (cur.length && printScale(draw([...cur, u])) >= Math.min(s0, 0.75)) { cur.push(u); continue; }
      if (cur.length) pages.push(draw(cur));
      cur = [u]; s0 = printScale(draw(cur));
    }
    if (cur.length) pages.push(draw(cur));
    return pages;
  }
  if (view === 'roles') {
    const target = rowTarget(full.svg);
    const draw = (rows) => renderRoles(r, { rows, sum: false });
    const ranges = splitRanges(r.tasks.length, draw, target);
    const pages = ranges.map(draw);
    // 担当者ごとのまとめは、最後のページに入れば入れ、入らなければ次のページにする
    const withSum = renderRoles(r, { rows: ranges[ranges.length - 1] });
    if (printScale(withSum) >= target) pages[pages.length - 1] = withSum; else pages.push(renderRoles(r, { table: false }));
    return pages;
  }
  if (view === 'mop') {
    let n = 0;
    for (const x of r.bySec.FBS) n += x.mops.length + (x.parent && !x.children.length && !x.mops.length ? 1 : 0);
    return splitRows(n, (rows) => renderMop(r, { rows }), rowTarget(full.svg));
  }
  if (view === 'gantt') return splitRows(r.tasks.length, (rows) => renderGantt(r, { ...opts, rows }), rowTarget(full.svg));
  if (view === 'people') {
    const n = r.members.length + (r.tasks.some((t) => !t.by.length) ? 1 : 0);
    return splitRows(n, (rows) => renderPeople(r, { ...opts, rows }), rowTarget(full.svg));
  }
  if (view === 'aoa') {
    // アローダイアグラム: 矢印の図とタスクの表を別のページにし、表は縦向きのページで、収まらなければ行で区切る
    const tableFull = renderAOA(r, { part: 'table' });
    return [renderAOA(r, { part: 'diagram' }), ...splitRows(r.tasks.length, (rows) => renderAOA(r, { part: 'table', rows }), rowTarget(tableFull, true), true)];
  }
  return [full.svg];
}

// 選んだ要素の情報(画面の下の欄)
function describe(r, id, opts = {}) {
  if (/^m\d+$/.test(id)) { const m = r.members[+id.slice(1)]; return m ? { kind: '担当者', name: m.name, items: [m.off.length ? ['休み', offText(m.off)] : null, m.note ? ['note', m.note] : null].filter(Boolean) } : null; }
  const n = r.nodes.find((x) => x.id === id);
  if (!n) return null;
  const items = [];
  const kind = n.sec === 'WBS' ? (!n.parent ? 'WBS の根' : n.children.length ? 'WBS の要素' : 'タスク') : `${n.sec} の${n.parent ? '要素' : '根'}`;
  if (n.num) items.push(['管理番号', n.num]);
  if (n.sec === 'FBS' && n.mops.length) items.push(['MOP', n.mops.map((m, i) => `${n.mopChecked[i] ? '✓ ' : ''}${m}`).join(' / ')]);
  if (n.sec === 'PBS' && n.R.realizes?.length) items.push(['実現する機能', n.R.realizes.map((x) => x.name).join('、')]);
  if (n.sec === 'WBS') {
    if (n.for.length) items.push(['対象(for)', n.for.map((x) => x.name).join('、')]);
    if (n.by.length) items.push(['作成', n.by.map((x) => x.name).join('、')]);
    if (n.review.length) items.push(['確認', n.review.map((x) => x.name).join('、')]);
    if (n.parent && !n.children.length) {
      items.push(['日数', `${fmtDays(n.days)} 日`]);
      if (n.pred.length) items.push(['先行', n.pred.map((x) => x.name).join('、')]);
      items.push(['日程', `${fmtDate(r.sched.start + n.d0)} 〜 ${fmtDate(r.sched.start + n.d1)}`]);
      items.push(['余裕', `${fmtDays(n.TF)} 日${n.crit ? '(クリティカルパス)' : ''}`]);
      const today = opts.today ? parseDate(opts.today) : null;
      items.push(['状態', `${STATUS[n.status]}(${n.status})${isLate(r, n, today) ? '、遅れ' : ''}`]);
    }
  }
  if (n.note) items.push(['note', n.note]);
  return { kind, name: n.name, qname: r.qname(n), items };
}
function offText(list) { return list.map((o) => (o.type === 'wd' ? Object.keys(WD).find((k) => WD[k] === o.v) : o.type === 'd' ? fmtDate(o.v) : `${fmtDate(o.a)}..${fmtDate(o.b)}`)).join(', '); }

// ---- 生成 AI に渡す修正依頼の文
function toPrompt(diags, text) {
  const out = [];
  out.push('次の「プロジェクト計画」(https://plan.sapp.jp)のテキスト記法について、下の診断の内容を直したテキストを書いてください。');
  out.push('返すテキストはコードブロック(```)で囲まず、テキストだけを書いてください。見出し(#)・番号付きのリスト・太字(**)・説明の文の行は書けません(構文エラーになります)。');
  out.push('書き方の要点: 1 行目の「version: 日付」は保存した日で、アプリが書くので、そのまま残す(ほかの場所には書かない)。節は「start:」「end:」「off:」「members:」「FBS: 根の名前」「PBS: 根の名前」「WBS: 根の名前」。要素は「- 名前」の字下げで階層を作り、属性は名前の後ろに「予約語: 値」を並べる(FBS は mop: mop*:(チェック済みの MOP) note:、PBS は realizes: note:、WBS は for: days: by: review: after: status: note:)。複数の値はカンマ区切り。参照は名前で書き、同じ名前が複数あれば「親::子」と書く。メモは note: に書く。担当者の行には off:(その人の休み)と note: を書ける。// から行末までは注(行頭か空白の後の // だけ)。「* 」「+ 」で始まるリスト、** と __ は、太字のつもりでなくても書けない(__init__.py のような名前も不可)。status: はタスク(末端の要素)の状態で、todo(実行前)・doing(実行中)・done(完了)・blocked(問題発生)のどれか。書かなければ todo。');
  out.push('');
  const er = diags.filter((d) => d.level === 'error'), wr = diags.filter((d) => d.level === 'warn');
  if (er.length) { out.push('## エラー'); for (const d of er) out.push(`- ${d.line} 行: ${d.message}`); out.push(''); }
  if (wr.length) { out.push('## 警告'); for (const d of wr) out.push(`- ${d.line} 行: ${d.message}`); out.push(''); }
  out.push('## テキスト(「----- ここから -----」と「----- ここまで -----」の間)');
  out.push('----- ここから -----');
  out.push(text.replace(/^\uFEFF/, ''));
  out.push('----- ここまで -----');
  return out.join('\n');
}

// ---- 保存と読み込み(SVG に原文を埋め込む)
const META_ID = 'plan-source';
function b64enc(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
function b64dec(s) { const bin = atob(s.replace(/\s+/g, '')); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
function embedSource(svg, text) {
  const i = svg.indexOf('>', svg.indexOf('<svg'));
  const meta = `<metadata id="${META_ID}">${b64enc(new TextEncoder().encode(text))}</metadata>`;
  return '<?xml version="1.0" encoding="UTF-8"?>\n<!-- プロジェクト計画(https://plan.sapp.jp)で作った図。metadata に元のテキストを含み、このファイルをプロジェクト計画で開くと編集を続けられる -->\n'
    + svg.slice(0, i + 1) + meta + svg.slice(i + 1);
}
function extractSource(svgText) {
  const m = new RegExp(`<metadata id="${META_ID}">([A-Za-z0-9+/=\\s]*)</metadata>`).exec(svgText);
  if (!m) return { ok: false, error: 'この SVG にはテキストが埋め込まれていません(版 0.30 までに「画像…」で保存した .svg だけを開けます。図・表のボタンで保存した SVG にはテキストを入れていません)' };
  try { return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(b64dec(m[1])) }; }
  catch { return { ok: false, error: '埋め込まれたテキストが壊れています' }; }
}

// ================= 図からの編集(仕様書 11 章) =================
// テキストが正本。図での操作は、ここでテキストの書き換えに直す。どの関数も、解析し直す前の結果 r と
// 元のテキストから「新しいテキスト全体」を求めて返すだけで、図の側には状態を持たない。
// 戻り値は { text, select } か { error }。select は書き換えの後に選ぶ要素({ sec, qname } か { member })
const Edit = (() => {
  const RE_KW = /(^|[ \t])(realizes|for|days|by|review|after|status|note|mop\*?|off):/;
  const chain = (n) => { const a = []; for (let x = n; x; x = x.parent) a.unshift(x); return a; };
  const qn = (n) => chain(n).map((x) => x.name).join('::');
  const keyOf = (n) => (n.isMember ? { member: n.name } : { sec: n.sec, qname: qn(n) });
  const find = (r, id) => (/^m\d+$/.test(id) ? r.members[+id.slice(1)] : r.nodes.find((x) => x.id === id));
  const subtree = (n) => { const a = [n]; for (const c of n.children ?? []) a.push(...subtree(c)); return a; };
  const lastLineEnd = (n) => Math.max(...subtree(n).map((x) => x.lineEnd));
  const isAnc = (a, b) => { for (let x = b.parent; x; x = x.parent) if (x === a) return true; return false; };
  const fail = (error) => ({ error });

  // 書き換え(位置の並び)をテキストに当てる
  const apply = (text, edits) => {
    let t = text;
    for (const e of [...edits].sort((a, b) => b.start - a.start || b.end - a.end)) t = t.slice(0, e.start) + e.text + t.slice(e.end);
    return t;
  };
  // 元のテキストの位置が、書き換えの後のどこへ移るか。書き換えで消えた範囲の中なら null
  const mapPos = (edits, pos) => {
    let shift = 0;
    for (const e of edits) {
      if (e.end > e.start) { if (pos >= e.start && pos < e.end) return null; if (e.end <= pos) shift += e.text.length - (e.end - e.start); }
      else if (e.start <= pos) shift += e.text.length;
    }
    return pos + shift;
  };
  // 属性を前の空白ごと消す範囲
  const cutAttr = (text, at) => { let a = at.kstart; while (a > 0 && /[ \t]/.test(text[a - 1])) a--; return { start: a, end: at.end, text: '' }; };
  // 修飾名の候補(節の要素の並び list の中で、segs に当てはまるもの)
  const matches = (list, segs, noRoot) => list.filter((m) => {
    if (m.name !== segs[segs.length - 1] || (noRoot && !m.parent)) return false;
    let a = m.parent;
    for (let j = segs.length - 2; j >= 0; j--) { if (!a || a.name !== segs[j]) return false; a = a.parent; }
    return true;
  });
  // 参照に書く名前: その節で一意に決まる、いちばん短い修飾名
  function refName(list, n, noRoot) {
    const c = chain(n).map((x) => x.name);
    for (let k = 1; k <= c.length; k++) { const segs = c.slice(c.length - k); if (matches(list, segs, noRoot).length === 1) return segs.join('::'); }
    return c.join('::');
  }
  const secList = (nodes, sec) => nodes.filter((x) => x.sec === sec);

  // 名前や値に書けない文字列(書くと、同じ行の後ろの属性が注になったり、別の属性が始まったりする)
  function badText(v, what) {
    if (/(^|[ \t])\/\//.test(v)) return `${what}に「空白 + //」は書けません(そこから後ろが注になります)`;
    if (RE_KW.test(v)) return `${what}に「空白 + 予約語 + 半角コロン」は書けません(そこから別の属性と読まれます。全角のコロンを使ってください)`;
    if (/\*\*|__/.test(v)) return `${what}に ** と __ は書けません`;
    return null;
  }
  const badName = (name) => {
    if (!name.trim()) return '名前が空です';
    if (/[,]|::/.test(name)) return '名前に「,」と「::」は使えません';
    return badText(name, '名前');
  };

  // ---- 書き込む前の確認(仕様書 11.1 節)。書き換えの候補を解析し直し、次をすべて満たすときだけ書き込む
  //  1. 新しいエラーが出ない(削除だけは、消した要素への参照のエラーを認める)
  //  2. 対象でない要素は、親子関係・属性・参照先が変わらない
  //  3. 対象の要素は、意図したとおりになる(expect で確かめる)
  function commit(r, edits, o) {
    const text = apply(r.text, edits);
    const r2 = analyze(text);
    const p2 = r2.parse;
    const errs = r2.diags.filter((d) => d.level === 'error');
    if (errs.length && !(o.allowRefErrors && errs.every((d) => d.cat === '参照'))) return fail(`この書き換えをするとテキストがエラーになるので、書き換えませんでした(${errs[0].message})`);
    const at = (pos) => { const q = mapPos(edits, pos); return q === null ? null : q; };
    const byLine = new Map([...p2.nodes, ...p2.members].map((x) => [x.lineStart, x]));
    const nw = (n) => { const q = at(n.lineStart); return q === null ? null : byLine.get(q) ?? null; };
    const skip = o.skip ?? new Set(); // 対象の要素(属性の比較から外す)
    const sigA = (n, drop) => n.attrList.filter((a) => !drop.includes(a.key)).map((a) => `${a.key}:${a.refs ? '' : a.text}`).join('|');
    for (const n of [...r.nodes, ...r.members]) {
      if (o.removed?.has(n)) continue;
      const m = nw(n);
      if (!m) return fail('書き換えの位置がずれるため、書き換えませんでした(テキストの書き方を確かめてください)');
      if (!n.isMember) {
        const pOld = n.parent ? nw(n.parent) : null;
        if ((m.parent ?? null) !== pOld) return fail('字下げの幅がそろっていないため、この書き換えをすると別の要素の親子関係が変わります。テキストで字下げをそろえてから操作してください');
      }
      const drop = skip.has(n) ? (o.skipKeys ?? []) : [];
      if (!(o.renamed === n) && m.name !== n.name) return fail('書き換えで別の要素の名前が変わるため、書き換えませんでした');
      if (sigA(n, drop) !== sigA(m, drop)) return fail('書き換えで別の属性が変わるため、書き換えませんでした');
    }
    // 参照先が変わらない(対象の要素の、書き換えた属性を除く)
    if (r2.ok) {
      for (const n of [...r.nodes]) {
        if (o.removed?.has(n)) continue;
        const m = nw(n);
        for (const k of Object.keys(n.R ?? {})) {
          if (skip.has(n) && (o.skipKeys ?? []).includes(k)) continue;
          const a = n.R[k].map((x) => (x.isMember ? `m:${x.name === o.oldName && o.renamed === x ? o.newName : x.name}` : at(x.lineStart))).join(',');
          const b = (m.R?.[k] ?? []).map((x) => (x.isMember ? `m:${x.name}` : x.lineStart)).join(',');
          if (a !== b) return fail('書き換えで別の要素の参照先が変わるため、書き換えませんでした');
        }
      }
    }
    if (o.expect) { const e = o.expect(r2, nw); if (e) return fail(e); }
    return { text, select: o.select };
  }

  const isMop = (a) => a.key === 'mop' || a.key === 'mop*';
  // MOP の並び(mop: と mop*:)を書き換える(仕様書 11.2 節)。
  // 元の文と同じ文は、チェック済みかどうかを引き継ぐ(並べ替えても同じ。同じ文が 2 つ以上あれば、チェック済みを先に引き継ぐ)。
  // 同じ文の間で変わった文は、元の位置で文だけを置き換え、予約語(mop: か mop*:)はそのまま残す。
  // 元にない文は、並びの位置に mop: で足し、減った文は消す
  function setMops(r, n, list) {
    const text = r.text, olds = n.attrList.filter(isMop);
    const A = olds.map((a) => a.text), B = list;
    // 最長共通部分列で、変わらない文を決める
    const L = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
    for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const anchors = [];
    for (let i = 0, j = 0; i < A.length && j < B.length;) { if (A[i] === B[j]) { anchors.push([i, j]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++; }
    anchors.push([A.length, B.length]);
    const edits = [], ins = new Map(), want = [];
    let pi = 0, pj = 0, lastEnd = null; // lastEnd: 直前に残る(または置き換える)MOP の終わりの位置
    const insert = (v, key) => {
      if (lastEnd !== null) { ins.set(lastEnd, `${ins.get(lastEnd) ?? ''} ${key}: ${v}`); return; }
      const first = olds.find((a, i) => i >= pi && !cutSet.has(i));
      if (first) { const k = first.kstart; ins.set(k, `${ins.get(k) ?? ''}${key}: ${v} `); } else ins.set(n.end, `${ins.get(n.end) ?? ''} ${key}: ${v}`);
    };
    // 消す MOP を先に決める(足す位置を、残る MOP の前後から選ぶため)
    const cutSet = new Set();
    { let a0 = 0, b0 = 0; for (const [ai, bj] of anchors) { const og = ai - a0, ng = bj - b0; for (let k = ng; k < og; k++) cutSet.add(a0 + k); a0 = ai + 1; b0 = bj + 1; } }
    // 消す MOP のうち、同じ文が並びのどこかに残るものは、そのチェックを引き継ぐ(並べ替えたとき)
    const spare = new Map(); // 文 → 消す MOP の予約語の並び
    for (const i of cutSet) { const t = A[i]; if (!spare.has(t)) spare.set(t, []); spare.get(t).push(olds[i].key); }
    const take = (t, onlyChecked) => {
      const l = spare.get(t);
      if (!l) return null;
      const k = l.indexOf('mop*');
      if (k >= 0) { l.splice(k, 1); return 'mop*'; }
      if (onlyChecked || !l.length) return null;
      return l.shift();
    };
    for (const [ai, bj] of anchors) {
      const og = ai - pi, ng = bj - pj;
      for (let k = 0; k < Math.max(og, ng); k++) {
        if (k < og && k < ng) { const a = olds[pi + k]; edits.push({ start: a.kstart, end: a.end, text: `${a.key}: ${B[pj + k]}` }); want.push(`${a.key}\u0002${B[pj + k]}`); lastEnd = a.end; }
        else if (k < og) edits.push(cutAttr(text, olds[pi + k]));
        else { const key = take(B[pj + k], false) ?? 'mop'; insert(B[pj + k], key); want.push(`${key}\u0002${B[pj + k]}`); }
      }
      if (ai < A.length) {
        const a = olds[ai];
        // 同じ文の未チェックを残し、チェック済みを消すことになるときは、残す方をチェック済みにする
        const up = a.key === 'mop' && take(A[ai], true);
        if (up) edits.push({ start: a.kstart, end: a.kstart + a.key.length, text: 'mop*' });
        want.push(`${up ? 'mop*' : a.key}\u0002${A[ai]}`); lastEnd = a.end;
      }
      pi = ai + 1; pj = bj + 1;
    }
    for (const [pos, t] of ins) edits.push({ start: pos, end: pos, text: t });
    if (!edits.length) return { text, select: keyOf(n) };
    return commit(r, edits, {
      skip: new Set([n]), skipKeys: ['mop', 'mop*'], select: keyOf(n),
      expect: (r2, nw) => (nw(n).attrList.filter(isMop).map((a) => `${a.key}\u0002${a.text}`).join('\u0001') === want.join('\u0001') ? null : 'MOP を書いたとおりに読めないので、書き換えませんでした'),
    });
  }
  // MOP のチェックを切り替える(mop: と mop*: の予約語だけを書き換える)。index は、その行の MOP の何番目か
  function setMopChecked(r, id, index, checked) {
    const n = find(r, id);
    if (!n || n.sec !== 'FBS') return fail('FBS の要素が見つかりません');
    const olds = n.attrList.filter(isMop);
    const a = olds[index];
    if (!a) return fail('MOP が見つかりません');
    const key = checked ? 'mop*' : 'mop';
    if (a.key === key) return { text: r.text, select: keyOf(n) };
    const want = olds.map((x) => `${x === a ? key : x.key}\u0002${x.text}`).join('\u0001');
    return commit(r, [{ start: a.kstart, end: a.kstart + a.key.length, text: key }], {
      skip: new Set([n]), skipKeys: ['mop', 'mop*'], select: keyOf(n),
      expect: (r2, nw) => (nw(n).attrList.filter(isMop).map((x) => `${x.key}\u0002${x.text}`).join('\u0001') === want ? null : 'MOP のチェックを書いたとおりに読めないので、書き換えませんでした'),
    });
  }

  // 属性を書き換える。value が空なら属性を消す。mop は値の配列(setMops)
  function setAttr(r, id, key, value) {
    const n = find(r, id);
    if (!n) return fail('要素が見つかりません');
    if (key === 'mop') {
      const list = (Array.isArray(value) ? value : [value]).map((v) => String(v).trim()).filter(Boolean);
      for (const v of list) { const b = badText(v, '値'); if (b) return fail(b); }
      return setMops(r, n, list);
    }
    const text = r.text;
    const edits = [];
    const list = key === 'mop' ? (Array.isArray(value) ? value : [value]).map((v) => String(v).trim()).filter(Boolean) : [String(value).trim()].filter(Boolean);
    for (const v of list) { const b = badText(v, '値'); if (b) return fail(b); }
    if (key !== 'mop' && key !== 'note' && list[0] && /(^|[ \t])\/\//.test(list[0])) return fail('値に「空白 + //」は書けません');
    const olds = n.attrList.filter((a) => a.key === key);
    // 元の位置のまま置き換え、余れば消し、足りなければ行の終わりに足す
    olds.forEach((a, i) => edits.push(i < list.length ? { start: a.kstart, end: a.end, text: `${key}: ${list[i]}` } : cutAttr(text, a)));
    if (list.length > olds.length) edits.push({ start: n.end, end: n.end, text: list.slice(olds.length).map((v) => ` ${key}: ${v}`).join('') });
    if (!edits.length) return { text, select: keyOf(n) };
    return commit(r, edits, {
      skip: new Set([n]), skipKeys: [key], select: keyOf(n),
      expect: (r2, nw) => {
        const m = nw(n);
        const got = m.attrList.filter((a) => a.key === key).map((a) => a.text);
        return got.join('\u0001') === list.join('\u0001') ? null : `「${key}:」の値を、書いたとおりに読めないので、書き換えませんでした`;
      },
    });
  }

  // 名前を変える。その要素(と下位の要素)を指す参照も新しい名前に書き換え、曖昧になる参照は修飾名を付け直す
  function rename(r, id, newName0) {
    const n = find(r, id);
    if (!n) return fail('要素が見つかりません');
    const newName = newName0.trim();
    const bad = badName(newName);
    if (bad) return fail(bad);
    if (newName === n.name) return { text: r.text, select: keyOf(n) };
    const sibs = n.isMember ? r.members : n.parent ? n.parent.children : [];
    if (sibs.some((x) => x !== n && x.name === newName)) return fail(n.isMember ? `担当者に「${newName}」がすでにいます` : `同じ親の下に「${newName}」がすでにあります`);
    const edits = [{ start: n.nameStart, end: n.nameEnd, text: newName }];
    const refs = [];
    for (const m of [...r.nodes, ...r.members]) for (const at of m.attrList) for (const ref of at.refs ?? []) if (ref.node) refs.push(ref);
    const newText = new Map(); // 参照 → 書き換えた後の文字列
    for (const ref of refs) {
      const d = ref.node;
      if (n.isMember) { if (d === n) newText.set(ref, newName); continue; }
      if (d.isMember || !(d === n || isAnc(n, d))) continue;
      const c = chain(d);
      const k = c.indexOf(n), off = c.length - ref.segs.length;
      if (k < off) continue;
      const segs = [...ref.segs];
      segs[k - off] = newName;
      newText.set(ref, segs.join('::'));
    }
    for (const [ref, t] of newText) edits.push({ start: ref.start, end: ref.end, text: t });
    // 書き換えた後の木で、曖昧になる参照には修飾名を付け直す
    if (!n.isMember) {
      const t1 = apply(r.text, edits);
      const p1 = parse(t1);
      const byLine = new Map(p1.nodes.map((x) => [x.lineStart, x]));
      for (const ref of refs) {
        if (ref.node.isMember) continue;
        const cur = newText.get(ref) ?? ref.text;
        const list = secList(p1.nodes, ref.node.sec);
        const noRoot = !!ref.noRoot;
        if (matches(list, cur.split('::').map((s) => s.trim()), noRoot).length === 1) continue;
        const d1 = byLine.get(mapPos(edits, ref.node.lineStart));
        if (!d1) continue;
        const name = refName(list, d1, noRoot);
        const i = edits.findIndex((e) => e.start === ref.start && e.end === ref.end);
        if (i >= 0) edits[i] = { start: ref.start, end: ref.end, text: name }; else edits.push({ start: ref.start, end: ref.end, text: name });
      }
    }
    const sel = n.isMember ? { member: newName } : { sec: n.sec, qname: qn(n).split('::').slice(0, -1).concat(newName).join('::') };
    return commit(r, edits, { renamed: n, oldName: n.name, newName, select: sel, expect: (r2, nw) => (nw(n)?.name === newName ? null : '名前を書いたとおりに読めないので、書き換えませんでした') });
  }

  const uniqueName = (sibs, base) => { let name = base, i = 2; while (sibs.some((x) => x.name === name)) name = `${base}${i++}`; return name; };
  // 子を足す: 下位の要素の最後の行の後ろに、最後の子と同じ字下げで(子がなければ親の字下げに空白 2 個を足して)
  function addChild(r, id) {
    const n = find(r, id);
    if (!n || n.isMember) return fail('子を足せない要素です');
    const name = uniqueName(n.children, '新しい要素');
    const lc = n.children[n.children.length - 1];
    const lead = lc ? lc.lead : n.parent ? `${n.lead}  ` : '';
    const at = lastLineEnd(n);
    return commit(r, [{ start: at, end: at, text: `\n${lead}- ${name}` }], {
      select: { sec: n.sec, qname: `${qn(n)}::${name}` },
      expect: (r2) => (r2.parse.nodes.some((x) => x.name === name && x.parent && x.parent.lineStart === n.lineStart) ? null : '足した要素が、この要素の子として読めないので、書き換えませんでした(字下げをそろえてください)'),
    });
  }
  function addSibling(r, id) {
    const n = find(r, id);
    if (!n) return fail('要素が見つかりません');
    if (!n.isMember && !n.parent) return fail('根には兄弟を足せません');
    const sibs = n.isMember ? r.members : n.parent.children;
    const name = uniqueName(sibs, n.isMember ? '新しい担当者' : '新しい要素');
    const at = n.isMember ? n.lineEnd : lastLineEnd(n);
    const parentLine = n.isMember ? null : mapPos([], n.parent.lineStart);
    return commit(r, [{ start: at, end: at, text: `\n${n.lead}- ${name}` }], {
      select: n.isMember ? { member: name } : { sec: n.sec, qname: `${qn(n.parent)}::${name}` },
      expect: (r2) => (n.isMember ? (r2.parse.members.some((m) => m.name === name) ? null : '担当者を足せませんでした')
        : (r2.parse.nodes.some((x) => x.name === name && x.parent && x.parent.lineStart === parentLine) ? null : '足した要素が兄弟として読めないので、書き換えませんでした(字下げをそろえてください)')),
    });
  }
  // 消す(下位の要素の行も)。消す要素を指している参照の数も返す(画面で確認に使う)。消した要素への参照のエラーだけは認める
  function remove(r, id) {
    const n = find(r, id);
    if (!n) return fail('要素が見つかりません');
    if (!n.isMember && !n.parent) return fail('根は消せません(節ごと消すときはテキストで消してください)');
    const gone = new Set(n.isMember ? [n] : subtree(n));
    let refs = 0;
    for (const m of [...r.nodes, ...r.members]) if (!gone.has(m)) for (const at of m.attrList) for (const ref of at.refs ?? []) if (gone.has(ref.node)) refs++;
    const end = n.isMember ? n.lineEnd : lastLineEnd(n);
    const t = r.text;
    const range = end < t.length ? { start: n.lineStart, end: end + 1, text: '' } : { start: Math.max(0, n.lineStart - 1), end, text: '' };
    const res = commit(r, [range], { removed: gone, allowRefErrors: true, select: null });
    if (res.error) return res;
    return { ...res, refs, count: gone.size };
  }
  // 参照の並びに 1 つ足す・除く
  function addRef(r, n, key, name) {
    const at = n.attrList.find((a) => a.key === key);
    if (!at) return [{ start: n.end, end: n.end, text: ` ${key}: ${name}` }];
    return [{ start: at.start, end: at.end, text: `${r.text.slice(at.start, at.end)}, ${name}` }];
  }
  function dropRef(r, n, key, target) {
    const at = n.attrList.find((a) => a.key === key);
    if (!at) return null;
    const keep = at.refs.filter((x) => x.node !== target);
    if (keep.length === at.refs.length) return null;
    return [keep.length ? { start: at.start, end: at.end, text: keep.map((x) => x.text).join(', ') } : cutAttr(r.text, at)];
  }
  const refExpect = (n, key, want) => (r2, nw) => {
    const m = nw(n);
    const got = (m.R?.[key] ?? []).map((x) => x.lineStart).sort((a, b) => a - b).join(',');
    return got === want ? null : '参照を書いたとおりに読めないので、書き換えませんでした';
  };
  const wantRefs = (n, key, plus, minus) => (edits) => [...(n.R[key] ?? []).filter((x) => x !== minus), ...(plus ? [plus] : [])].map((x) => mapPos(edits, x.lineStart)).sort((a, b) => a - b).join(',');
  // FBS と PBS の対応を足す・除く(PBS の要素の realizes:)
  function addRealizes(r, aId, bId) {
    let p = find(r, aId), f = find(r, bId);
    if (p && f && p.sec === 'FBS' && f.sec === 'PBS') [p, f] = [f, p];
    if (!p || !f || p.sec !== 'PBS' || f.sec !== 'FBS') return fail('FBS の要素と PBS の要素を結んでください');
    if ((p.R.realizes ?? []).includes(f)) return fail('すでに対応しています');
    const edits = addRef(r, p, 'realizes', refName(r.bySec.FBS, f, false));
    return commit(r, edits, { skip: new Set([p]), skipKeys: ['realizes'], select: keyOf(p), expect: refExpect(p, 'realizes', wantRefs(p, 'realizes', f)(edits)) });
  }
  function removeRealizes(r, pbsId, fbsId) {
    const p = find(r, pbsId), f = find(r, fbsId);
    const edits = p && f ? dropRef(r, p, 'realizes', f) : null;
    if (!edits) return fail('この対応は、PBS の要素の realizes: に直接書かれていません');
    return commit(r, edits, { skip: new Set([p]), skipKeys: ['realizes'], select: keyOf(p), expect: refExpect(p, 'realizes', wantRefs(p, 'realizes', null, f)(edits)) });
  }
  // 依存を足す: タスク succ の after: にタスク pred を足す(アローダイアグラムで pred から succ へ引く)
  function addAfter(r, predId, succId) {
    const p = find(r, predId), s2 = find(r, succId);
    if (!p || !s2 || p.sec !== 'WBS' || s2.sec !== 'WBS' || p === s2) return fail('別のタスクどうしを結んでください');
    if (isAnc(p, s2) || isAnc(s2, p)) return fail('上位・下位の要素どうしは結べません');
    const anc = (t) => { const seen = new Set(); const st = [...(t.pred ?? [])]; while (st.length) { const q = st.pop(); if (!seen.has(q)) { seen.add(q); st.push(...(q.pred ?? [])); } } return seen; };
    if (anc(p).has(s2)) return fail(`「${s2.name}」は「${p.name}」より前のタスクなので、結ぶと依存関係が循環します`);
    if (anc(s2).has(p)) return fail(`「${s2.name}」はすでに「${p.name}」の後です`);
    const edits = addRef(r, s2, 'after', refName(r.bySec.WBS, p, true));
    return commit(r, edits, { skip: new Set([s2]), skipKeys: ['after'], select: keyOf(s2), expect: refExpect(s2, 'after', wantRefs(s2, 'after', p)(edits)) });
  }
  function removeAfter(r, succId, predId) {
    const s2 = find(r, succId), p = find(r, predId);
    const edits = s2 && p ? dropRef(r, s2, 'after', p) : null;
    if (!edits) return fail('この依存は、このタスクの after: に直接書かれていません');
    return commit(r, edits, { skip: new Set([s2]), skipKeys: ['after'], select: keyOf(s2), expect: refExpect(s2, 'after', wantRefs(s2, 'after', null, p)(edits)) });
  }
  function setDays(r, id, milli) {
    const n = find(r, id);
    if (!n || n.sec !== 'WBS' || n.children.length || !n.parent) return fail('日数はタスク(末端の要素)にだけ書けます');
    return setAttr(r, id, 'days', fmtDays(Math.max(0, Math.min(36500000, Math.round(milli)))));
  }
  // 状態を変える(仕様書 11.2 節)。status: が書いてあれば値だけを置き換え、書いていないタスクで todo を選んだときは何も書き足さない
  function setStatus(r, id, v) {
    const n = find(r, id);
    if (!n || n.sec !== 'WBS' || n.children.length || !n.parent) return fail('状態はタスク(末端の要素)にだけ書けます');
    if (!Object.hasOwn(STATUS, v)) return fail(`状態「${v}」は書けません`);
    if (v === 'todo' && !n.attrs.status) return { text: r.text, select: keyOf(n) };
    return setAttr(r, id, 'status', v);
  }
  // 選ぶ要素を、書き換えた後の解析結果から探す
  function locate(r, key) {
    if (!key) return null;
    if (key.member) { const i = r.members.findIndex((m) => m.name === key.member); return i >= 0 ? `m${i}` : null; }
    const n = r.nodes.find((x) => x.sec === key.sec && qn(x) === key.qname);
    return n ? n.id : null;
  }
  return { setAttr, setMopChecked, rename, addChild, addSibling, remove, addRealizes, removeRealizes, addAfter, removeAfter, setDays, setStatus, locate, keyOf, find };
})();

// ---- 図・表を 1 つずつ保存する・コピーする(仕様書 9 章)
// 保存する SVG からは、画面の操作のための印(data-*)と、要素の説明(title。メモを含む)を除く(報告書に貼るため)
const cleanSvg = (svg) => svg.replace(/<title>[\s\S]*?<\/title>/g, '').replace(/ data-[a-z-]+="[^"]*"/g, '');
const unesc = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
// 図の題: 図の最初の文字(どのビューも、左上の題を最初に描く)
function firstText(svg) {
  const m = /<text[^>]*? y="([\d.]+)"[^>]*? font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/.exec(svg);
  return m ? { y: +m[1], fs: +m[2], label: unesc(m[3]) } : null;
}
const FIG_ID = { fbs: 'fbs', pbs: 'pbs', match: 'match', wbs: 'wbs', aoa: 'aoa', gantt: 'gantt', people: 'gantt-people', summary: 'summary' };
// ビューの図と表。figs: [{ id, svg }]、tables: [{ name(ファイル名に使う題), header, rows, svg(題を入れない) }]、
// anchors: 題の位置({ kind: 'fig', id | kind: 'table', index, label(題の文字), y(題の文字の基準線), fs })。画面で題の右にボタンを置くのに使う
function pieces(r, view, opts = {}) {
  const col = { anchors: [], tables: [] };
  const o = render(r, view, { ...opts, collect: col });
  if (!o.svg || !r.tasks.length && ['aoa', 'roles', 'gantt', 'people'].includes(view)) return { figs: [], tables: [], anchors: [] };
  const figs = [];
  const id = FIG_ID[view];
  if (id) figs.push({ id, svg: cleanSvg(view === 'aoa' ? renderAOA(r, { part: 'diagram' }) : o.svg) });
  const PAD = 20;
  const tables = col.tables.map((t) => {
    const [x0, y0, w, h] = t.box;
    return { name: t.name, header: t.header, rows: t.rows, svg: cleanSvg(wrapSvg(w + 2 * PAD, h + 2 * PAD, `<g transform="translate(${PAD - x0},${PAD - y0})">${t.frag}</g>`)) };
  });
  return { figs, tables, anchors: anchorsOf(r, view, o.svg, col) };
}
// 題の位置(画面で題の右にボタンを置くため)。svg は render で描いた図、col は render に opts.collect で渡して集めたもの(描き直さずに求める)。
// 図は { kind: 'fig', id, label, y, fs }、表は { kind: 'table', name(表の題。ファイル名に使う), label(画面の題の文字), y, fs }
function anchorsOf(r, view, svg, col) {
  const out = [];
  if (!svg || !r.tasks.length && ['aoa', 'roles', 'gantt', 'people'].includes(view)) return out;
  const id = FIG_ID[view];
  const t = id && svg ? firstText(svg) : null; // アローダイアグラムの矢印の図の題は、ビューの図の最初の文字と同じ
  if (t) out.push({ kind: 'fig', id, ...t });
  for (const a of col.anchors) if (col.tables[a.index]) out.push({ kind: 'table', name: col.tables[a.index].name, label: a.label, y: a.y, fs: a.fs });
  return out;
}
// 表をタブ区切りの文字にする。1 行目は見出し。セルの中のタブ・改行は空白 1 個にする。行の区切りは LF
function tsv(t) {
  const c = (v) => String(v).replace(/[\t\r\n]+/g, ' ');
  return `${[t.header, ...t.rows].map((row) => row.map(c).join('\t')).join('\n')}\n`;
}

// ---- version:(最後にファイルとして保存した日。1 行目にだけ書ける。仕様書 3.3 節・4.1 節・9 章)
const normText = (t) => t.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
// 保存するときに、内容が変わったかを比べるためのテキスト。1 行目の version: の日付の部分(注または行末までの値。前後の空白を除く)だけを除く
function stripVersion(text0) {
  const text = normText(text0);
  const v = parse(text).sec.version;
  return v ? text.slice(0, v.vStart) + text.slice(v.vEnd) : text;
}
// 正しくない場所(1 行目の行頭以外)にある version: の行の番号。なければ null。注やメモの中の version: は数えない
function misplacedVersion(text0) {
  const d = parse(normText(text0)).diags.find((x) => x.ver);
  return d ? d.line : null;
}
// 1 行目の version: の日付を date(YYYY-MM-DD)にしたテキスト。なければ 1 行目に足す
function setVersion(text0, date) {
  const text = normText(text0);
  const v = parse(text).sec.version;
  if (!v) return `version: ${date}\n${text}`;
  const sp = v.vStart === v.vEnd && !/[ \t]/.test(text[v.vStart - 1]) ? ' ' : '';
  return text.slice(0, v.vStart) + sp + date + text.slice(v.vEnd);
}

return { parse, analyze, stripVersion, setVersion, misplacedVersion, render, pieces, anchorsOf, tsv, printPages, printPortrait, peopleLoad, plannedByToday, workUntil, describe, toPrompt, embedSource, extractSource, VIEWS, STATUS, fmtDays, fmtDate, buildAOA, Edit };
})();
if (typeof module !== 'undefined') module.exports = Plan;
/*CORE-END*/
