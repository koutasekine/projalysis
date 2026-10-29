// ---- 画面(DOM を使うのはここだけ)
(() => {
'use strict';
/* global Log, Team, Projalysis, SAMPLE_LOGS, SAMPLE_PLANS, USAGE_HTML */
const D = Projalysis;
const $ = (s) => document.querySelector(s);
const viewEl = $('#view'), canvasEl = $('#canvas'), viewKindEl = $('#viewKind'), logsEl = $('#logs'), plansEl = $('#plans'), infoEl = $('#info');
const baseEl = $('#baseDate'), weekSelEl = $('#weekSel'), weekLabEl = $('#weekLab'), selAEl = $('#selA'), selBEl = $('#selB');
let plans = [];           // 計画書の一覧(Team.loadPlan の並び。読むだけ。仕様書 3.3 節〜3.6 節)
let list = [];            // マイログの一覧(Team.loadLog の並び。読むだけ。仕様書 3.7 節)
let M = null;             // 作業分析の集計のもと(Team.model)
let th = { ...Log.TH_DEFAULT }; // 要確認の規則の値(仕様書 6.3 節)
let plansOpen = true, logsOpen = true;
let planNote = '', logNote = '';
let fileName = '';        // 開いている・保存した plans の名前
let fileHandle = null;    // 上書きの先(開いた .plans。Chrome・Edge のファイル操作機能。開き直すと忘れる)
let dirty = false;
let editGen = 0;          // 内容の世代(保存の書き込み中に変わったかを見分ける)
let docGen = 0;           // 文書の世代(保存の書き込み中に、別の plans を開いた・新規・例で入れ替えたかを見分ける)
let saving = false;       // 保存の書き込み中(二度押しで 2 回書き込まない)
let weekPick = null;      // 週のまとめで見る週(週の始まりの日。null は基準日の週)
let sel = null;           // 表の行で選んだ記録 { file, line }
let pair = null;          // 計画書分析で比べる 2 つの版 [前の版, 後の版](一覧の中の版そのもの)。なければ null
let pairUser = false;     // 比べる 2 つの版を利用者が選んだか(選ぶまでは既定の最初と最後に従う。仕様書 5.2 節)

// ---- ビュー(仕様書 8.1 節): サマリーをいちばん上に、その下に作業分析と計画書分析のまとまり
const PLAN_VIEWS = D.VIEWS.filter((v) => v.id !== 'overview');
const isWork = (id) => Team.VIEWS.some((v) => v.id === id);
let viewsHasWork = null;
// マイログの一覧が空のときは、作業分析のまとまりを出さない。作業分析のビューを表示中に空になったら、サマリーに移る
function fillViews() {
  const has = list.length > 0;
  if (viewsHasWork === has) return;
  viewsHasWork = has;
  const cur = viewKindEl.value;
  viewKindEl.textContent = '';
  viewKindEl.append(new Option('サマリー', 'overview'));
  const group = (label, vs) => { const g = document.createElement('optgroup'); g.label = label; for (const v of vs) g.append(new Option(v.label, v.id)); viewKindEl.append(g); };
  if (has) group('作業分析', Team.VIEWS);
  group('計画書分析', PLAN_VIEWS);
  viewKindEl.value = [...viewKindEl.options].some((o) => o.value === cur) ? cur : 'overview';
}

const todayStr = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
// 基準日(仕様書 6.2 節): 既定は今日。開き直すと今日に戻る(保持しない)。今日のままなら、日付が変わったら描き直す
let followToday = true;
baseEl.value = todayStr();
const baseNum = () => Log.parseDate(baseEl.value) ?? Log.parseDate(todayStr());
// マイログの解析(診断)の「今日」は、基準日ではなく本当の今日(基準日は集計だけに使う)
const todayNum = () => Log.parseDate(todayStr());
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

// ---- 比べる 2 つの版(仕様書 5.2 節): 既定は比べられる版の最初と最後
const comparable = () => plans.filter((e) => e.comparable);
function fixPair() {
  const c = comparable();
  if (c.length < 2) { pair = null; pairUser = false; return; }
  // 選んだ版が外れたときは、既定に戻す
  if (pairUser && (!pair || !c.includes(pair[0]) || !c.includes(pair[1]) || pair[0] === pair[1])) pairUser = false;
  if (!pairUser) pair = [c[0], c[c.length - 1]];
  if (plans.indexOf(pair[0]) > plans.indexOf(pair[1])) pair = [pair[1], pair[0]];
}
function renderPairSel() {
  const lab = Log.labels(plans), c = comparable();
  for (const [s, k] of [[selAEl, 0], [selBEl, 1]]) {
    s.textContent = '';
    c.forEach((e, i) => s.append(new Option(`${lab.get(e)}(${e.name})`, String(i))));
    s.disabled = !pair;
    if (pair) s.value = String(c.indexOf(pair[k]));
  }
}
function pickPair() {
  const c = comparable();
  const a = c[+selAEl.value], b = c[+selBEl.value];
  if (!a || !b || a === b) { renderPairSel(); return; }
  pair = plans.indexOf(a) < plans.indexOf(b) ? [a, b] : [b, a];
  pairUser = true;
  renderPairSel(); draw(); persist();
}
selAEl.addEventListener('change', pickPair);
selBEl.addEventListener('change', pickPair);
// 帯のプリセット。「初版 → 最新版」は既定の組に戻す(版を足すと最新版に合わせて変わる)。「前の版 → 最新版」は選択欄で選んだのと同じ扱い
$('#btnFirstLast').addEventListener('click', () => { pairUser = false; fixPair(); renderPairSel(); draw(); persist(); });
$('#btnPrevLast').addEventListener('click', () => {
  const c = comparable();
  if (c.length < 2) return;
  pair = [c[c.length - 2], c[c.length - 1]]; pairUser = true;
  renderPairSel(); draw(); persist();
});

// ---- 集計して描く
function recompute() {
  const today = baseNum();
  list = list.map((x) => Team.loadLog(x.name, x.text, plans, todayNum()));
  M = Team.model(plans, list, { today, th });
  fixPair();
  fillViews();
  renderPlans(); renderLogs(); renderPairSel(); draw();
}
function fillWeeks() {
  // 選んだ週は、ほかのビューにいる間も、選べる週になくなったら基準日の週に戻す(マイログがなくなったときも)
  const has = !!(M && M.logs.length);
  const cur = has ? Log.weekOf(M.today, M.ws) : null, opts = has ? Team.weekOptions(M) : [];
  if (weekPick !== null && (!opts.includes(weekPick) || weekPick === cur)) weekPick = null;
  const isW = viewKindEl.value === 'week' && has;
  weekLabEl.hidden = !isW;
  if (!isW) return;
  weekSelEl.textContent = '';
  for (const w of opts) weekSelEl.append(new Option(`${Log.fmtDate(w).slice(5)}〜${w === cur ? '(基準日の週)' : ''}`, w === cur ? '' : String(w)));
  weekSelEl.value = weekPick === null ? '' : String(weekPick);
}
const ctxNow = () => ({ week: weekPick });
// 概要に置く作業の概要(仕様書 7.2 節)。マイログの一覧が空なら置かない
const overviewOpt = () => (list.length && M ? { work: Team.workSummary(M) } : {});
function draw() {
  const view = viewKindEl.value;
  canvasEl.textContent = '';
  fillWeeks();
  // 帯(仕様書 8 章): 比較する版の帯は 2 つの版を比較するビューで、基準日の欄は作業分析のビューとマイログがあるときのサマリーで
  const pv = D.VIEWS.find((v) => v.id === view);
  $('#pairbar').hidden = !pv || !!pv.all || comparable().length < 2;
  $('#bar').hidden = !(isWork(view) || (view === 'overview' && list.length));
  if (!plans.length && !list.length) { canvasEl.append(el('div', 'empty', '計画書(.plan)とマイログ(.mylog)を置くか、plans(.plans)を開いてください。「例を読み込む」で例を、「使い方」で使い方を見られます。')); closeInfo(); return; }
  if (isWork(view)) {
    let o;
    try { o = Team.render(M, view, ctxNow()); }
    catch (e) { canvasEl.append(el('div', 'empty', `内部エラー(描画): ${e.message}`)); return; }
    canvasEl.innerHTML = o.svg;
    addPieceButtons(o.anchors);
    markSel();
    return;
  }
  let o;
  try { o = D.render(plans, view, pair, view === 'overview' ? overviewOpt() : {}); }
  catch (e) { canvasEl.append(el('div', 'empty', `内部エラー(描画): ${e.message}`)); return; }
  canvasEl.innerHTML = o.svg;
  addPlanButtons(o);
}

// ---- 計画書の一覧(仕様書 3.4 節〜3.6 節)
function renderPlans() {
  plansEl.textContent = '';
  plansEl.classList.toggle('closed', !plansOpen);
  const head = el('div', 'head');
  head.append(el('span', null, `${plansOpen ? '▾' : '▸'} 計画書(${plans.length})`), el('span', 'small', plans.length ? '版の日付の順。同じ日付の中は ▲▼ で並べ替えられます' : '「ファイルを追加」で .plan を読みます'));
  head.addEventListener('click', () => { plansOpen = !plansOpen; renderPlans(); persist(); });
  plansEl.append(head);
  const lab = Log.labels(plans);
  const ul = el('ul');
  plans.forEach((e, i) => {
    const li = el('li');
    const head = el('div', 'ihead');
    const nm = el('span', 'iname', e.name); nm.title = e.name;
    const btns = el('span', 'ibtns');
    const mv = (dir, label, tip) => { const b = el('button', null, label); b.title = tip; b.disabled = !Log.moveEntry(plans, i, dir); b.addEventListener('click', () => { const x = Log.moveEntry(plans, i, dir); if (x) { plans = x; changed(); } }); btns.append(b); };
    mv(-1, '▲', '同じ日付の版の中で 1 つ前へ');
    mv(1, '▼', '同じ日付の版の中で 1 つ後ろへ');
    const rm = el('button', null, '外す'); rm.title = '計画書の一覧から外す(ファイルは消さない)';
    rm.addEventListener('click', () => { plans = plans.filter((x) => x !== e); changed(); });
    btns.append(rm);
    head.append(el('span', 'lab', lab.get(e)), nm, btns);
    li.append(head);
    if (e.nErr) li.append(el('div', 'sub err', `エラー ${e.nErr} 件(${e.firstErr.line} 行: ${e.firstErr.message})。比較と照合から除外`));
    else if (e.date === null) li.append(el('div', 'sub err', 'version: がないため比較と照合から除外'));
    else li.append(el('div', `sub ${e.nWarn ? 'warn' : 'ok'}`, e.nWarn ? `警告 ${e.nWarn} 件` : 'エラーと警告はありません'));
    ul.append(li);
  });
  plansEl.append(ul);
  if (planNote) plansEl.append(el('div', 'note', planNote));
}
// ---- マイログの一覧(仕様書 3.7 節)
function renderLogs() {
  logsEl.textContent = '';
  logsEl.classList.toggle('closed', !logsOpen);
  const head = el('div', 'head');
  head.append(el('span', null, `${logsOpen ? '▾' : '▸'} マイログ(${list.length})`), el('span', 'small', list.length ? '作業分析に使うマイログ(読むだけ)' : '「ファイルを追加」で .mylog を読むと、作業分析が出ます'));
  head.addEventListener('click', () => { logsOpen = !logsOpen; renderLogs(); persist(); });
  logsEl.append(head);
  const ul = el('ul');
  list.forEach((x, i) => {
    const li = el('li');
    const head = el('div', 'ihead');
    const nm = el('span', 'iname', x.name); nm.title = `${x.name}${x.version ? `(version: ${x.version})` : ''}`;
    const btns = el('span', 'ibtns');
    const mv = (dir, label, tip) => { const b = el('button', null, label); b.title = tip; b.disabled = !Team.moveLog(list, i, dir); b.addEventListener('click', () => { const y = Team.moveLog(list, i, dir); if (y) { list = y; changed(); } }); btns.append(b); };
    mv(-1, '▲', '前へ');
    mv(1, '▼', '後ろへ');
    const rm = el('button', null, '外す'); rm.title = 'マイログの一覧から外す(ファイルは消さない)';
    rm.addEventListener('click', () => { list = list.filter((y) => y !== x); changed(); });
    btns.append(rm);
    head.append(el('span', 'lab', x.by ?? '(by: なし)'), nm, btns);
    li.append(head);
    const sub = el('div', 'sub');
    sub.append(`${x.version ? `version: ${x.version}` : 'version: なし'}・最後の日付 ${x.lastDate === null ? '―' : Log.fmtDate(x.lastDate)}`);
    if (x.nErr) { const s2 = el('div', 'err', `エラー ${x.nErr} 件(${x.firstErr.line} 行: ${x.firstErr.message})。集計から除外`); s2.title = '押すと診断の一覧を見られます'; s2.style.cursor = 'pointer'; s2.addEventListener('click', () => showDiags(x)); sub.append(s2); }
    else if (x.nWarn) { const s2 = el('div', 'warn', `警告 ${x.nWarn} 件`); s2.title = '押すと診断の一覧を見られます'; s2.style.cursor = 'pointer'; s2.addEventListener('click', () => showDiags(x)); sub.append(s2); }
    else sub.append(el('div', 'ok', 'エラーと警告はありません'));
    li.append(sub);
    ul.append(li);
  });
  logsEl.append(ul);
  if (logNote) logsEl.append(el('div', 'note', logNote));
}
function showDiags(x) {
  const d = $('#dlgDiag'); d.textContent = '';
  d.append(el('h2', null, `${x.name} の診断`));
  const ul = el('ul');
  for (const g of x.diags) ul.append(el('li', g.level === 'error' ? 'err' : 'warn', `${g.line} 行: ${g.level === 'error' ? 'エラー' : '警告'} ${g.message}`));
  d.append(ul);
  const b = el('button', null, '閉じる'); b.addEventListener('click', () => d.close()); d.append(b);
  d.showModal();
}
// 足す・外す・置き換える・並べ替えは、保存していない変更(仕様書 9.2 節)
function changed() { closeInfo(); setDirty(true); recompute(); persist(); }

// ---- 作業分析の表の行を押す(仕様書 8.1 節): 記録のあるマイログのファイル名と行を示す(読むだけ)
viewEl.addEventListener('click', (e) => {
  const g = e.target.closest('[data-file]');
  if (!g || !canvasEl.contains(g)) { closeInfo(); return; }
  sel = { file: +g.getAttribute('data-file'), line: +g.getAttribute('data-line') };
  markSel(); showInfo();
});
// 計画書分析: 図と改訂履歴の行から、比べる 2 つの版を選ぶ(仕様書 5.12 節・5.13 節)。版を押すと、その版と一つ前の版。版の組を押すと、その組。表示中のビューは変えない
canvasEl.addEventListener('click', (e) => {
  if (isWork(viewKindEl.value)) return;
  const c = comparable();
  const v = e.target.closest('[data-ver]'), pr = e.target.closest('[data-pair]');
  let np = null;
  if (pr && canvasEl.contains(pr)) { const j = +pr.getAttribute('data-pair'); if (c[j] && c[j + 1]) np = [c[j], c[j + 1]]; }
  else if (v && canvasEl.contains(v)) { const i = +v.getAttribute('data-ver'); if (c.length >= 2 && c[i]) np = i > 0 ? [c[i - 1], c[i]] : [c[0], c[1]]; }
  if (!np) return;
  pair = np; pairUser = true;
  renderPairSel(); draw(); persist();
  const lab = Log.labels(plans);
  setStat(`比較: ${lab.get(pair[0])} → ${lab.get(pair[1])}`);
});
$('#bar').addEventListener('click', (e) => { if (!e.target.closest('input, select, button, label')) closeInfo(); });
function markSel() {
  canvasEl.querySelectorAll('.selected').forEach((x) => { x.classList.remove('selected'); if (!x.getAttribute('class')) x.removeAttribute('class'); });
  if (sel) canvasEl.querySelectorAll(`[data-file="${sel.file}"][data-line="${sel.line}"]`).forEach((g) => g.classList.add('selected'));
}
function showInfo() {
  const x = sel ? list[sel.file] : null;
  if (!x) { closeInfo(); return; }
  infoEl.textContent = '';
  const head = el('div', 'row');
  head.append(el('span', 'kind', `${x.name} の ${sel.line} 行`), el('span', 'small', `${x.by ? `${x.by}のマイログ` : 'マイログ'}(読むだけ。直すときは、本人がマイログで直します)`));
  const close = el('button', null, '閉じる'); close.addEventListener('click', closeInfo); head.append(close);
  infoEl.append(head, el('pre', 'line', x.text.split('\n')[sel.line - 1] ?? ''));
  infoEl.classList.add('on');
}
function closeInfo() { sel = null; infoEl.textContent = ''; infoEl.classList.remove('on'); markSel(); }

// ---- 図・表を 1 つずつ保存する・コピーする(仕様書 8.2 節・9.3 節・9.4 節)
const PIECE_TIP = {
  copy: (n) => `「${n}」の表をタブ区切りの文字でコピーする(表計算ソフトや Word の表にそのまま貼れる)`,
  svg: (n, t) => (t ? `「${n}」の表を SVG(ベクター形式)で保存する(題は入れない)` : 'この図を SVG(ベクター形式)で保存する'),
  png: (n, t) => (t ? `「${n}」の表を PNG(2 倍の解像度)で保存する(題は入れない)` : 'この図を PNG(2 倍の解像度)で保存する'),
  pdf: (n, t) => `${t ? `「${n}」の表` : 'この図'}だけを、同じ大きさの紙で印刷する(印刷の画面で「PDF に保存」を選ぶと、余白のない PDF になる。Chrome・Edge で使う)`,
};
const stopBubble = (box) => { for (const ev of ['pointerdown', 'mousedown', 'click', 'dblclick']) box.addEventListener(ev, (e) => e.stopPropagation()); };
// 作業分析の表と図
function addPieceButtons(anchors) {
  for (const a of anchors) {
    const isT = a.kind === 'table';
    const name = isT ? a.name : a.id;
    const box = el('span', 'tbtns');
    for (const k of isT ? ['copy', 'svg', 'png', 'pdf'] : ['svg', 'png', 'pdf']) {
      const b = el('button', null, k === 'copy' ? 'コピー' : k.toUpperCase());
      b.dataset.piece = `${isT ? 'table' : 'fig'}:${name}|${k}`;
      b.title = PIECE_TIP[k](name, isT);
      b.addEventListener('click', () => pieceAction(isT ? 'table' : 'fig', name, k, b, a.label));
      box.append(b);
    }
    stopBubble(box);
    canvasEl.append(box);
    placeBox(box, a);
  }
}
// サマリーと計画書分析の表と図
function addPlanButtons(o) {
  const viewName = safeName(viewKindEl.value); // ビューの識別子(ファイル名の形は 3 つのアプリで同じ。仕様書 9.3 節)
  for (const a of o.anchors) {
    const box = el('span', 'tbtns');
    if (a.kind === 'table') {
      const t = o.tables[a.index];
      const b = el('button', null, 'コピー');
      b.dataset.piece = `table:${t.title}|copy`;
      b.title = PIECE_TIP.copy(t.title);
      b.addEventListener('click', () => copyText(D.tsv(t), b));
      box.append(b);
      for (const k of ['svg', 'png', 'pdf']) {
        const bi = el('button', null, k.toUpperCase());
        bi.dataset.piece = `table:${t.title}|${k}`;
        bi.title = PIECE_TIP[k](t.title, true);
        bi.addEventListener('click', () => saveImage(o.tableSvgs[a.index], `${imgBase()}_${viewName}_${safeName(t.title)}`, k));
        box.append(bi);
      }
    } else {
      const f = o.figures.find((x) => x.id === a.id);
      for (const k of ['svg', 'png', 'pdf']) {
        const b = el('button', null, k.toUpperCase());
        b.dataset.piece = `fig:${f.id}|${k}`;
        b.title = PIECE_TIP[k](f.id, false);
        b.addEventListener('click', () => saveImage(f.svg, `${imgBase()}_${viewName}_${f.id}`, k));
        box.append(b);
      }
    }
    stopBubble(box);
    canvasEl.append(box);
    placeBox(box, a);
  }
}
const safeName = (s) => s.replace(/[\\/:*?"<>|\s]+/g, '_');
const baseOf = (name) => name.replace(/\.[^.]*$/, '');
// 画像のファイル名の元の名前(仕様書 9.3 節): 今のファイル名、なければ計画書の一覧の最初の版のファイル名、それもなければ projalysis
const imgBase = () => safeName(fileName ? baseOf(fileName) : plans.length ? baseOf(plans[0].name) : 'projalysis') || 'projalysis';
function pieceAction(kind, ref, k, btn, title) {
  if (!M) return;
  const view = viewKindEl.value;
  const viewName = safeName(view); // ビューの識別子(ファイル名の形は 3 つのアプリで同じ。仕様書 9.3 節)
  let p;
  try { p = Team.pieces(M, view, ctxNow()); } catch (e) { alert(`内部エラー(描画): ${e.message}`); return; }
  if (kind === 'table') {
    const t = p.tables.find((x) => x.name === ref);
    if (!t) { alert(`「${ref}」の表は、今はありません`); return; }
    if (k === 'copy') { copyText(Log.tsv(t), btn); return; }
    saveImage(t.svg, `${imgBase()}_${viewName}_${safeName(t.name)}`, k);
    return;
  }
  const f = p.figs.find((x) => x.id === ref);
  if (f) saveImage(f.svg, `${imgBase()}_${viewName}_${safeName(f.id)}`, k);
}
// ボタンを題の文字に合わせる(和文の字面の中心は、基準線から文字の大きさの約 0.38 倍上)
const GLYPH_MID = 0.38;
function placeBox(box, a) {
  const svg = canvasEl.querySelector('svg');
  const texts = svg ? [...svg.querySelectorAll('text')].filter((t) => t.textContent === a.label) : [];
  if (!texts.length) { box.remove(); return; }
  const near = texts.reduce((q, t) => (Math.abs(+t.getAttribute('y') - a.y) < Math.abs(+q.getAttribute('y') - a.y) ? t : q));
  const c = canvasEl.getBoundingClientRect(), sv = svg.getBoundingClientRect(), tr = near.getBoundingClientRect();
  const titleMid = sv.top - c.top + +near.getAttribute('y') - GLYPH_MID * +near.getAttribute('font-size');
  const btn = box.querySelector('button');
  const mark = document.createElement('span');
  mark.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  btn.append(mark);
  const bb = mark.getBoundingClientRect().bottom - box.getBoundingClientRect().top;
  mark.remove();
  box.style.left = `${tr.right - c.left + 6}px`;
  box.style.top = `${titleMid + GLYPH_MID * parseFloat(getComputedStyle(btn).fontSize) - bb}px`;
}
async function copyText(text, btn) {
  let ok = true;
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  if (btn.dataset.label === undefined) btn.dataset.label = btn.textContent;
  clearTimeout(btn._copyTimer);
  btn.textContent = ok ? 'コピーしました' : 'コピーできませんでした';
  btn._copyTimer = setTimeout(() => { btn.textContent = btn.dataset.label; }, 2000);
}
const withPage = (svg) => { const [, w, h] = /width="([\d.]+)" height="([\d.]+)"/.exec(svg); const i = svg.indexOf('>', svg.indexOf('<svg')); return `${svg.slice(0, i + 1)}<style>@page{size:${w}px ${h}px;margin:0}</style>${svg.slice(i + 1)}`; };
// 印刷の領域に入れる図は、id と url(#…) に印を付ける(画面の図と id が重なると、印刷では見えない画面の側の模様を指してしまうため)
const printIds = (svg, tag) => svg.replace(/(\s)id="([^"]+)"/g, `$1id="$2-${tag}"`).replace(/="url\(#([^)"]+)\)"/g, `="url(#$1-${tag})"`);
function printOne(svg, base) {
  const [, w, h] = /width="([\d.]+)" height="([\d.]+)"/.exec(svg).map(Number);
  const area = $('#printArea');
  area.textContent = ''; area.classList.add('one');
  const pg = el('div', 'page'); pg.style.width = `${w}px`; pg.style.height = `${h}px`; pg.innerHTML = printIds(svg, 'p0'); area.append(pg);
  let st = $('#pageOne');
  if (!st) { st = document.createElement('style'); st.id = 'pageOne'; document.head.append(st); }
  st.textContent = `@media print{@page{size:${w}px ${h}px;margin:0}}`;
  const title = document.title; document.title = base;
  try { window.print(); } finally { document.title = title; }
}
function saveImage(svg, base, kind) {
  if (kind === 'pdf') { printOne(svg, base); return; }
  if (kind === 'svg') { download(`${base}.svg`, new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${withPage(svg)}`], { type: 'image/svg+xml' })); return; }
  const scale = 2;
  const m = /width="(\d+)" height="(\d+)"/.exec(svg);
  const w = +m[1], h = +m[2];
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const big = () => alert('画像が大きすぎて PNG にできませんでした。SVG で保存してください');
  img.onload = () => {
    URL.revokeObjectURL(url);
    const c = document.createElement('canvas'); c.width = w * scale; c.height = h * scale;
    const g = c.getContext('2d');
    if (!g) { big(); return; }
    g.scale(scale, scale); g.drawImage(img, 0, 0);
    c.toBlob((b) => { if (b) download(`${base}.png`, b); else big(); }, 'image/png');
  };
  img.onerror = () => { URL.revokeObjectURL(url); alert('PNG の作成に失敗しました'); };
  img.src = url;
}
function download(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }

// ---- 印刷 / PDF(仕様書 9.5 節): ビューをすべて、8.1 節の順に。サマリーと計画書分析は横向き、作業分析は縦向き(週のまとめは基準日の週)
function buildPrint() {
  const area = $('#printArea');
  area.textContent = ''; area.classList.remove('one');
  const st = $('#pageOne'); if (st) st.textContent = '';
  const pages = [];
  for (const svg of D.printPages(plans, 'overview', pair, overviewOpt())) pages.push([svg, true]);
  // 作業分析は縦向き。列で分けられない幅の広い図(縦の紙で半分より小さく縮むもの)だけは横向き
  if (list.length) for (const svg of Team.printAll(M, {})) pages.push([svg, +(/width="(\d+)"/.exec(svg) || [0, 0])[1] > 1280]);
  // 2 つの版を比べるビューは比べる 2 つの版があるときだけ。すべての版を示すビュー(推移・改訂履歴)は、比べられる版が 1 つでも印刷する
  for (const v of PLAN_VIEWS) { if (!pair && !v.all) continue; if (!plans.some((e) => e.comparable)) continue; let ps; try { ps = D.printPages(plans, v.id, pair); } catch { continue; } for (const svg of ps) pages.push([svg, true]); }
  pages.forEach(([svg, land], i) => { const pg = el('div', land ? 'page land' : 'page'); pg.innerHTML = printIds(svg, `p${i}`); area.append(pg); });
  return pages.length;
}
$('#btnPrint').addEventListener('click', () => {
  if (!M || (!plans.length && !list.length)) { alert('印刷するものがありません'); return; }
  try { if (!buildPrint()) { alert('印刷するものがありません'); return; } } catch (e) { alert(`内部エラー(印刷): ${e.message}`); return; }
  window.print();
});
window.addEventListener('afterprint', () => { const a = $('#printArea'); a.textContent = ''; a.classList.remove('one'); const st = $('#pageOne'); if (st) st.textContent = ''; });

// ---- 読み込み(仕様書 3.1 節): .plans は 2 つの一覧を入れ替え、.plan・.mylog は足す。.svg はプロジェクト計画の版 0.30 までの SVG
const kindOf = (name) => (/\.plans$/i.test(name) ? 'plans' : /\.mylog$/i.test(name) ? 'mylog' : /\.(plan|txt)$/i.test(name) ? 'plan' : /\.svg$/i.test(name) ? 'svg' : /\.zip$/i.test(name) ? 'zip' : null);
const readText = (file) => new Promise((ok, ng) => {
  const r = new FileReader();
  r.onload = () => { try { ok(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(r.result))); } catch { ng(new Error('UTF-8 として読めません')); } };
  r.onerror = () => ng(new Error('読めませんでした'));
  r.readAsArrayBuffer(file);
});
// 同じ by: のマイログを足したときに尋ねる(置き換える・両方残す・やめる)
function askConflict(cur, name) {
  return new Promise((res) => {
    const d = $('#dlgAsk'); d.textContent = '';
    d.append(el('p', null, `${cur.by}のマイログがすでにあります(${cur.name}、version: ${cur.version ?? 'なし'})。`), el('p', 'small', `足そうとしているファイル: ${name}`));
    const row = el('div', 'btns');
    for (const [k, t] of [['replace', '置き換える'], ['both', '両方残す'], ['cancel', 'やめる']]) { const b = el('button', null, t); b.dataset.k = k; b.addEventListener('click', () => { d.close(k); }); row.append(b); }
    d.append(row);
    d.addEventListener('close', () => res(d.returnValue || 'cancel'), { once: true });
    d.returnValue = '';
    d.showModal();
  });
}
// 開いたときのビュー(仕様書 8.3 節)
function chooseView() { fillViews(); viewKindEl.value = Team.openingView(M); }
// items: [{ file, handle }]。開く処理は 1 つずつ行う(同じ人のマイログを尋ねるダイアログの間に置いたファイルは、答えの後に開く)
let openQ = Promise.resolve();
function openItems(items) { openQ = openQ.then(() => openItemsNow(items)).catch((e) => alert(`内部エラー: ${e.message}`)); return openQ; }
async function openItemsNow(items) {
  const errors = [];
  const wasEmpty = !plans.length && !list.length;
  const bundles = items.filter((x) => kindOf(x.file.name) === 'plans');
  const ps = items.filter((x) => ['plan', 'svg'].includes(kindOf(x.file.name)));
  const ls = items.filter((x) => kindOf(x.file.name) === 'mylog');
  for (const x of items) if (!kindOf(x.file.name)) errors.push(`${x.file.name} は開けません。開けるのは、plans(.plans)・計画書(.plan・.txt)・マイログ(.mylog)と、プロジェクト計画の版 0.30 までに保存した .svg です`);
  let touched = false, replaced = false;
  if (bundles.length > 1) errors.push('plans は 1 つずつ開いてください');
  else if (bundles.length === 1) {
    const b = bundles[0];
    // 先に読めるかを確かめ、読めるときだけ破棄の確認を出す。入れ替えを取りやめたら、一緒に置いたファイルも足さない
    let x = null;
    try { x = Team.fromPlans(await readText(b.file)); } catch (e) { errors.push(`${b.file.name}: ${e.message}`); }
    if (x && !x.ok) { errors.push(`${b.file.name}: ${x.error}`); setWarn('load', `${b.file.name} を読めませんでした(${x.error})`); x = null; }
    if (x && !okToDiscard()) { if (errors.length) alert(errors.join('\n')); return; }
    if (x) {
      try {
        plans = Log.sortList(x.plans.map((f) => Team.loadPlan(f.name, f.text)));
        list = x.logs.map((f) => Team.loadLog(f.name, f.text, plans, todayNum()));
        fileName = b.file.name; fileHandle = b.handle ?? null; planNote = ''; logNote = ''; setWarn('load', '');
        pair = null; pairUser = false; weekPick = null; closeInfo();
        newDoc(); setDirty(false); touched = true; replaced = true;
      } catch (e) { errors.push(`${b.file.name}: ${e.message}`); }
    }
  }
  if (ps.length) {
    const entries = [];
    for (const x of ps) {
      let text;
      try { text = await readText(x.file); } catch (e) { errors.push(`${x.file.name}: ${e.message}`); continue; }
      if (kindOf(x.file.name) === 'plan') { entries.push(Team.loadPlan(x.file.name, text)); continue; }
      const r = D.extract(text, x.file.name);
      if (!r.ok) { errors.push(`${x.file.name}: ${r.error}`); continue; }
      for (const f of r.files) entries.push(Team.loadPlan(f.name, f.text));
    }
    const res = Log.addEntries(plans, entries);
    plans = res.list;
    planNote = res.skipped.length ? `同じ内容のため追加しませんでした: ${res.skipped.map((s) => `${s.name}(${s.dup} と同じ)`).join('、')}` : '';
    if (res.added.length) { plansOpen = true; setDirty(true); }
    touched = true;
  }
  if (ls.length) {
    const skipped = [];
    for (const x of ls) {
      let text;
      try { text = await readText(x.file); } catch (e) { errors.push(`${x.file.name}: ${e.message}`); continue; }
      const c = Team.classifyLog(list, x.file.name, text);
      if (c.kind === 'dup') { skipped.push(`${x.file.name}(${c.with} と同じ)`); continue; }
      const entry = Team.loadLog(x.file.name, text, plans, todayNum());
      if (c.kind === 'conflict') {
        const ans = await askConflict(list[c.index], x.file.name);
        if (ans === 'replace') { list = list.map((y, i) => (i === c.index ? entry : y)); setDirty(true); }
        else if (ans === 'both') { list = [...list, entry]; setDirty(true); }
        continue;
      }
      list = [...list, entry]; setDirty(true);
    }
    logNote = skipped.length ? `同じ内容のため追加しませんでした: ${skipped.join('、')}` : '';
    logsOpen = true; touched = true;
  }
  if (touched) {
    closeInfo();
    recompute();
    // plans を開いて入れ替えたとき、空の一覧から読み込んだときは、ビューを選び直す(仕様書 8.3 節)
    if (replaced || (wasEmpty && (plans.length || list.length))) { chooseView(); draw(); }
    persist();
  }
  if (errors.length) alert(errors.join('\n'));
}
const FS_OK = typeof window.showOpenFilePicker === 'function' && typeof window.showSaveFilePicker === 'function';
const PICK_OPEN = { multiple: true, types: [{ description: 'plans・計画書・マイログ', accept: { 'application/json': ['.plans'], 'text/plain': ['.plan', '.txt', '.mylog'], 'image/svg+xml': ['.svg'] } }] };
const PICK_SAVE = { types: [{ description: 'プロジェクト分析の plans', accept: { 'application/json': ['.plans'] } }] };
async function pick(inputSel) {
  if (!FS_OK) { $(inputSel).click(); return; }
  let hs;
  try { hs = await window.showOpenFilePicker(PICK_OPEN); } catch (e) { if (e?.name !== 'AbortError') $(inputSel).click(); return; }
  const items = [];
  for (const h of hs) items.push({ file: await h.getFile(), handle: h });
  openItems(items);
}
$('#btnOpen').addEventListener('click', () => pick('#fileOpen'));
$('#btnAddFiles').addEventListener('click', () => pick('#fileAdd'));
for (const id of ['#fileOpen', '#fileAdd']) $(id).addEventListener('change', (e) => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) openItems(fs.map((file) => ({ file, handle: null }))); });
['dragenter', 'dragover'].forEach((ev) => window.addEventListener(ev, (e) => { e.preventDefault(); $('#drop').classList.add('on'); }));
['dragleave', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || e.relatedTarget === null) $('#drop').classList.remove('on'); }));
window.addEventListener('drop', (e) => {
  const fs = [...e.dataTransfer.files].filter((f) => kindOf(f.name) !== 'zip'); // .zip は読まず、知らせもしない(仕様書 3.1 節)
  if (!fs.length) return;
  const its = [...(e.dataTransfer.items ?? [])];
  const items = fs.map((file) => ({ file, handle: null }));
  // 上書きの先にするため、.plans のファイルの扱いを受け取る(Chrome・Edge。ドロップの処理の中で呼ぶ必要がある)
  const all = [...e.dataTransfer.files];
  const hp = all.map((f, i) => (kindOf(f.name) === 'plans' && its[i] && typeof its[i].getAsFileSystemHandle === 'function' ? its[i].getAsFileSystemHandle() : null));
  Promise.all(hp.map((p) => (p ? p.catch(() => null) : null))).then((hs) => {
    for (const it of items) { const k = all.indexOf(it.file); const h = hs[k]; if (h && h.kind === 'file') it.handle = h; }
    openItems(items);
  });
});

// ---- 保存(仕様書 9.2 節)
let statT = null;
function setStat(t) { const e = $('#stat'); e.textContent = t; clearTimeout(statT); if (t) statT = setTimeout(() => { e.textContent = ''; }, 4000); }
function showName() { const e = $('#fileName'); e.textContent = `${fileName || '(名前なし)'}${dirty ? ' *' : ''}`; e.title = dirty ? '保存していない変更があります' : ''; }
function setDirty(v) { if (v) editGen++; dirty = v; showName(); }
function newDoc() { docGen++; editGen++; }
function setSaving(v) { saving = v; $('#btnSave').disabled = v; $('#btnSaveAs').disabled = v; }
// 書き込みの後: 書き込み中に別の文書に入れ替えたときは、名前と上書きの先を変えない。内容が変わったときは「 *」を残す
function afterWrite(gen, dgen, msg, h) {
  if (docGen !== dgen) { setStat(`${msg}。保存中に別の文書を開いたので、今の文書は保存されていません`); return; }
  if (h) { fileHandle = h; fileName = h.name; }
  if (editGen === gen) setDirty(false); else showName();
  persist();
  setStat(editGen === gen ? msg : `${msg}。保存中に変わった内容はまだ保存されていません`);
}
const okToDiscard = () => !dirty || (!plans.length && !list.length) || confirm('保存していない変更があります。破棄して続けますか?');
const stamp = () => { const d = new Date(); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
// 名前の候補: 今のファイル名、なければ計画書の一覧の最初の版のファイル名から拡張子を除いたもの .plans、計画書もなければ projalysis.plans
const suggested = () => fileName || (plans.length ? `${baseOf(plans[0].name)}.plans` : 'projalysis.plans');
const content = () => Team.toPlans(plans, list);
async function writeTo(h, text) { const w = await h.createWritable(); await w.write(text); await w.close(); }
async function saveAs() {
  if (saving) return;
  if (FS_OK) {
    let h = null;
    setSaving(true);
    try { h = await window.showSaveFilePicker({ suggestedName: suggested(), ...PICK_SAVE }); } catch (e) { if (e?.name === 'AbortError') { setSaving(false); return; } }
    if (h) {
      const gen = editGen, dgen = docGen, text = content();
      try { await writeTo(h, text); afterWrite(gen, dgen, `${h.name} に保存しました(${stamp()})`, h); setSaving(false); return; }
      catch { setStat('保存先に書き込めなかったので、ダウンロードで保存します'); }
    }
    setSaving(false);
  }
  const text = content();
  let name = prompt('ファイル名', suggested());
  if (name === null) return;
  name = name.trim() || suggested();
  if (!/\.plans$/i.test(name)) name += '.plans';
  download(name, new Blob([text], { type: 'application/json' }));
  fileName = name; fileHandle = null; setDirty(false); persist();
  setStat(`${name} をダウンロードしました(${stamp()})`);
}
// 上書き保存(プロジェクト計画の仕様書 9 章と同じ): 上書きの先があればそこへ。ファイル操作機能がなくファイル名があれば、同じ名前でダウンロード。
// 上書きに失敗したら知らせるだけにする(別名で保存へは進まない)
async function save() {
  if (saving) return;
  if (FS_OK && fileHandle) {
    const h = fileHandle, gen = editGen, dgen = docGen;
    setSaving(true);
    try { await writeTo(h, content()); afterWrite(gen, dgen, `${h.name} に上書き保存しました(${stamp()})`); }
    catch (e) { setStat(e?.name === 'AbortError' ? '上書き保存を取りやめました' : '上書きできませんでした。「別名で保存」を使ってください'); }
    finally { setSaving(false); }
    return;
  }
  if (FS_OK || !fileName) { await saveAs(); return; }
  download(fileName, new Blob([content()], { type: 'application/json' }));
  afterWrite(editGen, docGen, `${fileName} をダウンロードしました(${stamp()})`);
}
$('#btnSave').addEventListener('click', save);
$('#btnSaveAs').addEventListener('click', saveAs);
window.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); if (e.repeat || document.querySelector('dialog[open]')) return; save(); } });
$('#btnNew').addEventListener('click', () => { if (!okToDiscard()) return; newDoc(); plans = []; list = []; fileName = ''; fileHandle = null; planNote = ''; logNote = ''; pair = null; pairUser = false; setWarn('load', ''); closeInfo(); setDirty(false); recompute(); persist(); });

// ---- 自動保持(仕様書 9.6 節): このブラウザの localStorage だけに書く。どこにも送信しない。基準日と、週のまとめで選んだ週は保持しない
const KEY_DOC = 'projalysis.sapp.jp:doc';
const WARN = { save: '', tab: '', load: '' };
const setWarn = (kind, t) => { WARN[kind] = t; $('#warn').textContent = [WARN.load, WARN.save, WARN.tab].filter(Boolean).join(' / '); };
function persist() {
  let ok = true;
  const p = pair ? [plans.indexOf(pair[0]), plans.indexOf(pair[1])] : null;
  try { localStorage.setItem(KEY_DOC, JSON.stringify({ name: fileName, dirty, files: plans.map((e) => ({ name: e.name, text: e.text })), logs: list.map((x) => ({ name: x.name, text: x.text })), pair: p, pairUser, th, view: viewKindEl.value, plansOpen, logsOpen })); } catch { ok = false; }
  // 一覧が空のときは、保持できなくても失うものがないので知らせない
  setWarn('save', ok || (!plans.length && !list.length) ? '' : 'このブラウザに保持できませんでした(残したいときは、ファイルに保存してください)');
}
window.addEventListener('storage', (e) => { if (e.key === KEY_DOC && e.newValue !== null) setWarn('tab', '別のタブで一覧が変わりました。このタブで続けると、そちらの内容は上書きされます'); });

// ---- 上の帯・右の帯
viewKindEl.addEventListener('change', () => { closeInfo(); persist(); draw(); });
weekSelEl.addEventListener('change', () => { weekPick = weekSelEl.value ? +weekSelEl.value : null; closeInfo(); draw(); });
baseEl.addEventListener('change', () => { if (Log.parseDate(baseEl.value) === null) baseEl.value = todayStr(); followToday = baseEl.value === todayStr(); closeInfo(); recompute(); });
$('#btnToday').addEventListener('click', () => { baseEl.value = todayStr(); followToday = true; closeInfo(); recompute(); });
setInterval(() => { if (followToday && baseEl.value !== todayStr()) { baseEl.value = todayStr(); recompute(); } }, 60000);
$('#btnSample').addEventListener('click', () => {
  if ((plans.length || list.length) && !confirm('計画書の一覧とマイログの一覧を、例に入れ替えます(ファイルは消えません)。よろしいですか?')) return;
  // 例の日付をずらし、読み込んだ日が 2026-04-30 に当たるようにする(仕様書 8.4 節)
  const d = Log.parseDate(todayStr()) - Log.parseDate(Team.EXAMPLE_TODAY);
  baseEl.value = todayStr(); followToday = true;
  plans = Log.sortList(SAMPLE_PLANS.map((f) => Team.loadPlan(f.name, Log.shiftExample(f.text, d))));
  list = SAMPLE_LOGS.map((f) => Team.loadLog(f.name, Log.shiftExample(f.text, d), plans, todayNum()));
  fileName = 'sample.plans'; fileHandle = null; planNote = ''; logNote = ''; plansOpen = true; logsOpen = true; weekPick = null; pair = null; pairUser = false; setWarn('load', ''); closeInfo();
  newDoc(); setDirty(false); recompute(); chooseView(); draw(); persist();
});
$('#btnUse').addEventListener('click', () => { const d = $('#dlgUse'); d.innerHTML = USAGE_HTML; d.showModal(); });
$('#btnSet').addEventListener('click', () => {
  const d = $('#dlgSet'); d.textContent = '';
  d.append(el('h2', null, '要確認の規則の値'));
  const tb = el('table');
  const tr0 = el('tr'); for (const h of ['番号', '兆候', '値']) tr0.append(el('th', null, h)); tb.append(tr0);
  const unit = { S7: '%' };
  for (const k of Object.keys(Log.TH_DEFAULT)) {
    const tr = el('tr'); tr.append(el('td', null, k), el('td', null, Log.SIG_NAME[k]));
    const td = el('td'); const inp = document.createElement('input'); inp.type = 'number'; inp.min = '0'; inp.value = th[k]; inp.dataset.k = k;
    inp.addEventListener('change', () => { const v = Number(inp.value); if (Number.isFinite(v) && v >= 0) { th[k] = v; persist(); recompute(); } else inp.value = th[k]; });
    td.append(inp, ` ${unit[k] ?? '日'}`); tr.append(td); tb.append(tr);
  }
  d.append(tb, el('p', 'small', '値はこのブラウザに残し、plans には書きません。'));
  const rb = el('button', null, '既定の値に戻す');
  rb.addEventListener('click', () => { th = { ...Log.TH_DEFAULT }; persist(); recompute(); d.close(); });
  d.append(rb);
  d.showModal();
});
document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (d.id === 'dlgAsk') return; const r = d.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close(); }));

// ---- 分割バー
(() => {
  const sp = $('#splitter'), left = $('#left');
  let drag = false;
  sp.addEventListener('mousedown', () => { drag = true; document.body.style.userSelect = 'none'; });
  window.addEventListener('mouseup', () => { drag = false; document.body.style.userSelect = ''; });
  window.addEventListener('mousemove', (e) => { if (drag) left.style.width = `${Math.max(220, Math.min(window.innerWidth - 220, e.clientX))}px`; });
})();

// ---- 開いたときは、保持してある内容を続ける(なければ空)。上書きの先は覚えていないので、次の上書き保存では保存先を尋ねる
{
  let d = null;
  try { d = JSON.parse(localStorage.getItem(KEY_DOC) ?? 'null'); } catch { d = null; }
  let view = null;
  if (d && typeof d === 'object') {
    const okList = (a) => (Array.isArray(a) ? a.filter((f) => f && typeof f.name === 'string' && typeof f.text === 'string') : []);
    // 保持した並びで戻し、日付の順に並べ直す(同じ日付の中は保持した順のまま)
    const raw = okList(d.files).map((f) => Team.loadPlan(f.name, f.text));
    plans = Log.sortList(raw);
    list = okList(d.logs).map((f) => Team.loadLog(f.name, f.text, plans, todayNum()));
    if (typeof d.name === 'string') fileName = d.name;
    dirty = !!d.dirty;
    if (d.th && typeof d.th === 'object') for (const k of Object.keys(Log.TH_DEFAULT)) if (Number.isFinite(d.th[k]) && d.th[k] >= 0) th[k] = d.th[k];
    if (d.pairUser && Array.isArray(d.pair) && raw[d.pair[0]] && raw[d.pair[1]] && raw[d.pair[0]] !== raw[d.pair[1]]) { pair = [raw[d.pair[0]], raw[d.pair[1]]]; pairUser = true; }
    view = d.view;
    if (typeof d.plansOpen === 'boolean') plansOpen = d.plansOpen;
    if (typeof d.logsOpen === 'boolean') logsOpen = d.logsOpen;
  }
  showName();
  fillViews();
  if ([...viewKindEl.options].some((o) => o.value === view)) viewKindEl.value = view;
  recompute();
}
})();
