// ---- 画面(DOM を使うのはここだけ)
(() => {
'use strict';
/* global Projalysis, USAGE_HTML */
const D = Projalysis;
const $ = (s) => document.querySelector(s);
const listEl = $('#list'), canvasEl = $('#canvas'), viewKindEl = $('#viewKind'), selAEl = $('#selA'), selBEl = $('#selB');

let list = [];            // 一覧(仕様書 3.4 節)。各版は D.load の結果
let pair = null;          // 比べる 2 つの版 [前の版, 後の版](一覧の中の版そのもの)。なければ null
let fileName = '';        // 開いている・保存した plans のファイル名(なければ空)
let fileHandle = null;    // 上書き保存の先(Chrome・Edge のファイル操作機能。開き直すと忘れる)
let dirty = false;        // 保存していない変更があるか
let pairUser = false;     // 比べる 2 つの版を利用者が選んだか(選ぶまでは既定の最初と最後に従う。仕様書 5.2 節)
let mergeWarn = false;    // 上書き保存の前に、足した plans を書き込むことを確かめるか(仕様書 7.2 節)
let mergeNames = [];      // 確かめるときに示す、足した plans の名前
let editGen = 0;          // 一覧の世代(保存の書き込み中に変わったかを見分ける)

for (const v of D.VIEWS) viewKindEl.append(new Option(v.label, v.id));
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// ---- 比べる 2 つの版(仕様書 5.2 節): 既定は比べられる版の最初と最後
const comparable = () => list.filter((e) => e.comparable);
function fixPair() {
  const c = comparable();
  if (c.length < 2) { pair = null; pairUser = false; return; }
  // 選んだ版が外れたときは、既定に戻す
  if (pairUser && (!pair || !c.includes(pair[0]) || !c.includes(pair[1]) || pair[0] === pair[1])) pairUser = false;
  if (!pairUser) pair = [c[0], c[c.length - 1]];
  if (list.indexOf(pair[0]) > list.indexOf(pair[1])) pair = [pair[1], pair[0]];
}

// ---- 一覧と描画
function refresh() {
  fixPair();
  renderList();
  renderPairSel();
  draw();
  showName();
  persist();
}
function renderList() {
  listEl.textContent = '';
  const lab = D.labels(list);
  if (!list.length) { listEl.append(el('div', 'small', '読み込んだ版はありません。')); return; }
  list.forEach((e, i) => {
    const li = el('div', 'item');
    const head = el('div', 'ihead');
    head.append(el('span', 'lab', lab.get(e)), el('span', 'iname', e.name));
    const btns = el('span', 'ibtns');
    const b = (t, title, dis, fn) => { const x = el('button', null, t); x.title = title; x.disabled = dis; x.addEventListener('click', fn); btns.append(x); };
    b('▲', '同じ日付の版の中で 1 つ前へ', !D.canMove(list, i, -1), () => { list = D.moveEntry(list, i, -1); changed(); });
    b('▼', '同じ日付の版の中で 1 つ後ろへ', !D.canMove(list, i, 1), () => { list = D.moveEntry(list, i, 1); changed(); });
    b('外す', '一覧から外す', false, () => { list = list.filter((x) => x !== e); changed(); });
    head.append(btns);
    li.append(head);
    if (e.nErr) li.append(el('div', 'err', `エラー ${e.nErr} 件(${e.firstErr.line} 行: ${e.firstErr.message})。比較から除外`));
    else if (e.date === null) li.append(el('div', 'err', 'version: がないため比較から除外'));
    else li.append(el('div', e.nWarn ? 'warn' : 'ok', e.nWarn ? `警告 ${e.nWarn} 件` : 'エラーと警告はありません'));
    listEl.append(li);
  });
}
function renderPairSel() {
  const lab = D.labels(list), c = comparable();
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
  pair = [a, b];
  pairUser = true;
  refresh();
}
// 帯のプリセットのボタン(仕様書 6 章)。初版・最新版は、比べられる版の一覧の最初と最後
// 「初版 → 最新版」は既定の組に戻す(版を足すと最新版に合わせて変わる)。「前の版 → 最新版」は選択欄で選んだのと同じ扱い
$('#btnFirstLast').addEventListener('click', () => { pairUser = false; refresh(); });
$('#btnPrevLast').addEventListener('click', () => {
  const c = comparable();
  if (c.length < 2) return;
  pair = [c[c.length - 2], c[c.length - 1]]; pairUser = true;
  refresh();
});
selAEl.addEventListener('change', pickPair);
selBEl.addEventListener('change', pickPair);
viewKindEl.addEventListener('change', () => { draw(); persist(); });
// 推移の図から比べる 2 つの版を選ぶ(仕様書 5.12 節)。版を押すと、その版と一つ前の版。版の組を押すと、その組。表示中のビューは変えない
canvasEl.addEventListener('click', (e) => {
  const c = comparable();
  const v = e.target.closest('[data-ver]'), pr = e.target.closest('[data-pair]');
  let np = null;
  if (pr && canvasEl.contains(pr)) { const j = +pr.getAttribute('data-pair'); if (c[j] && c[j + 1]) np = [c[j], c[j + 1]]; }
  else if (v && canvasEl.contains(v)) { const i = +v.getAttribute('data-ver'); if (c.length >= 2 && c[i]) np = i > 0 ? [c[i - 1], c[i]] : [c[0], c[1]]; }
  if (!np) return;
  pair = np; pairUser = true;
  refresh();
  const lab = D.labels(list);
  setStat(`比較: ${lab.get(pair[0])} → ${lab.get(pair[1])}`);
});

function draw() {
  // 比較する版の帯は、2 つの版を比較するビューの上にだけ出す(仕様書 6 章)
  // 比べられる版が 2 つ未満のときも出さない(選べる組がないため)
  $('#pairbar').hidden = list.filter((e) => e.comparable).length < 2 || !!D.VIEWS.find((v) => v.id === viewKindEl.value)?.all;
  canvasEl.textContent = '';
  if (!list.length) { canvasEl.append(el('div', 'empty', '.plan を置くか「開く」で読み込むと、ここに表と図が出ます。')); return; }
  let o;
  try { o = D.render(list, viewKindEl.value, pair); } catch (e) { canvasEl.append(el('div', 'empty err', `内部エラー(描画): ${e.message}`)); return; }
  canvasEl.innerHTML = o.svg;
  // 表と図の題の右にボタンを置く(仕様書 6.2 節・7.3 節)。図の上に重ねるだけで、SVG には含めない(保存した画像や印刷には出ない)
  for (const a of o.anchors) {
    const box = el('span', 'tbtns');
    box.style.left = `${a.x}px`; box.style.top = `${a.y}px`;
    if (a.kind === 'table') {
      const t = o.tables[a.index];
      const b = el('button', null, 'コピー');
      b.dataset.copy = t.title;
      b.title = `「${t.title}」の表をタブ区切りでコピーする(表計算ソフトにそのまま貼れる)`;
      b.addEventListener('click', () => copyText(D.tsv(t), b));
      box.append(b);
      for (const k of ['svg', 'png', 'pdf']) {
        const bi = el('button', null, k.toUpperCase());
        bi.dataset.tbl = `${t.title}|${k}`;
        bi.title = k === 'pdf' ? `「${t.title}」の表だけを、表と同じ大きさの紙で印刷する(印刷の画面で「PDF に保存」を選ぶと PDF になる。題は入れない)` : `「${t.title}」の表を${k === 'svg' ? ' SVG(ベクター形式)' : ' PNG(ラスター形式)'}で保存する(題は入れない)`;
        bi.addEventListener('click', () => saveImage(o.tableSvgs[a.index], `${imgBase()}_${viewKindEl.value}_${safeName(t.title)}`, k));
        box.append(bi);
      }
    } else {
      const f = o.figures.find((x) => x.id === a.id);
      for (const k of ['svg', 'png', 'pdf']) {
        const b = el('button', null, k.toUpperCase());
        b.dataset.fig = `${f.id}|${k}`;
        b.title = k === 'pdf' ? 'この図だけを、図と同じ大きさの紙で印刷する(印刷の画面で「PDF に保存」を選ぶと PDF になる)' : k === 'svg' ? 'この図を SVG(ベクター形式)で保存する' : 'この図を PNG(ラスター形式)で保存する';
        b.addEventListener('click', () => saveImage(f.svg, `${imgBase()}_${viewKindEl.value}_${f.id}`, k));
        box.append(b);
      }
    }
    canvasEl.append(box);
    placeBox(box, a);
  }
}
// ボタンを題の文字に合わせる。文字の枠(フォントが決める上下の余白)の中心はフォントによって上下にずれるので使わない。
// 題とボタンの文字の基準線(ベースライン)から見た目の中心を求め(和文の字面の中心は、基準線から文字の大きさの約 0.38 倍上)、中心どうしをそろえる
const GLYPH_MID = 0.38;
function placeBox(box, a) {
  const svg = canvasEl.querySelector('svg');
  const texts = svg ? [...svg.querySelectorAll('text')].filter((t) => t.textContent === a.label) : [];
  if (!texts.length) return; // 見つからなければ、計算した位置のまま
  const near = texts.reduce((p, q) => (Math.abs(+q.getAttribute('y') - a.y) < Math.abs(+p.getAttribute('y') - a.y) ? q : p));
  const c = canvasEl.getBoundingClientRect(), sv = svg.getBoundingClientRect(), r = near.getBoundingClientRect();
  const fsT = +near.getAttribute('font-size');
  const titleMid = sv.top - c.top + +near.getAttribute('y') - GLYPH_MID * fsT;
  // ボタンの文字の基準線: ボタンの中に置いた大きさ 0 の印の下端
  const btn = box.querySelector('button');
  const mark = document.createElement('span');
  mark.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  btn.append(mark);
  const bb = mark.getBoundingClientRect().bottom - box.getBoundingClientRect().top;
  mark.remove();
  const fsB = parseFloat(getComputedStyle(btn).fontSize);
  box.style.left = `${r.right - c.left + 6}px`;
  box.style.top = `${titleMid + GLYPH_MID * fsB - bb}px`;
}
async function copyText(text, btn) {
  let ok = true;
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  // 元の文はボタンに覚えておく(続けて押したときに「コピーしました」を元の文と取り違えないため)。表示は 2 秒で戻す
  if (btn.dataset.label === undefined) btn.dataset.label = btn.textContent;
  clearTimeout(btn._copyTimer);
  btn.textContent = ok ? 'コピーしました' : 'コピーできませんでした';
  btn._copyTimer = setTimeout(() => { btn.textContent = btn.dataset.label; }, 2000);
}
function changed() { editGen++; dirty = true; refresh(); }

// ---- 上の帯の表示
let statT = null;
function setStat(t, ms = 4000) { const e = $('#stat'); e.textContent = t; clearTimeout(statT); if (t) statT = setTimeout(() => { e.textContent = ''; }, ms); }
function showName() { const e = $('#fileName'); e.textContent = `${fileName || '(名前なし)'}${dirty ? ' *' : ''}`; e.title = dirty ? '保存していない変更があります' : ''; }
const stamp = () => { const d = new Date(); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
const baseOf = (name) => name.replace(/\.[^.]*$/, '') || 'projalysis';

// ---- ブラウザへの自動保持(このブラウザの localStorage だけに書く。どこにも送信しない。仕様書 7.6 節)
const KEY_DOC = 'projalysis.sapp.jp:doc';
const warnEl = $('#warn');
const WARN = { save: '', tab: '' };
const setWarn = (kind, t) => { WARN[kind] = t; warnEl.textContent = [WARN.save, WARN.tab].filter(Boolean).join(' / '); };
function persist() {
  let ok = true;
  const p = pair ? [list.indexOf(pair[0]), list.indexOf(pair[1])] : null;
  try { localStorage.setItem(KEY_DOC, JSON.stringify({ files: list.map((e) => ({ name: e.name, text: e.text })), name: fileName, dirty, pair: p, pairUser, view: viewKindEl.value, mergeWarn, mergeNames })); } catch { ok = false; }
  // 一覧が空のときは、保持できなくても失うものがないので知らせない
  setWarn('save', ok || !list.length ? '' : 'ブラウザへの自動保持に失敗しました。「上書き保存」か「別名で保存」でファイルに残してください');
}
function restore() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(KEY_DOC) ?? 'null'); } catch { d = null; }
  if (!d || !Array.isArray(d.files)) return;
  // 保持した並びで戻し、日付の順に並べ直す(同じ日付の中は保持した順のまま。手で並べ替えた順を保つ。仕様書 3.4 節)
  const raw = d.files.filter((f) => f && typeof f.name === 'string' && typeof f.text === 'string').map((f) => D.load(f.name, f.text));
  list = D.sortList(raw);
  fileName = typeof d.name === 'string' ? d.name : '';
  dirty = !!d.dirty;
  // 警告を出すかどうかも戻す(ファイル操作機能のないブラウザでは、ファイル名が上書きの先として残るため)
  mergeWarn = !!d.mergeWarn;
  mergeNames = Array.isArray(d.mergeNames) ? d.mergeNames.filter((x) => typeof x === 'string') : [];
  if (D.VIEWS.some((v) => v.id === d.view)) viewKindEl.value = d.view;
  if (d.pairUser && Array.isArray(d.pair) && raw[d.pair[0]] && raw[d.pair[1]] && raw[d.pair[0]] !== raw[d.pair[1]]) {
    pair = [raw[d.pair[0]], raw[d.pair[1]]];
    if (list.indexOf(pair[0]) > list.indexOf(pair[1])) pair.reverse(); // 変更前が一覧で前になるように
    pairUser = true;
  }
}
// 別のタブで同じ一覧が変わったら知らせる(後から書いた方が残るため)
window.addEventListener('storage', (e) => { if (e.key === KEY_DOC && e.newValue !== null) setWarn('tab', '別のタブで一覧が変わりました。このタブで続けると、そちらの内容は上書きされます'); });

// ---- 読み込む(仕様書 3 章): 開く・置くは、いつも一覧に足す
const FS_OK = typeof window.showOpenFilePicker === 'function' && typeof window.showSaveFilePicker === 'function';
const PICK_OPEN = { multiple: true, types: [{ description: 'プロジェクト計画のテキスト・plans・SVG', accept: { 'text/plain': ['.plan'], 'application/json': ['.plans'], 'image/svg+xml': ['.svg'] } }] };
const PICK_SAVE = { types: [{ description: 'プロジェクト分析の plans', accept: { 'application/json': ['.plans'] } }] };
const kindOf = (name) => (/\.plan$/i.test(name) ? 'plan' : /\.plans$/i.test(name) ? 'plans' : /\.svg$/i.test(name) ? 'svg' : null);
const readText = (file) => new Promise((ok, ng) => {
  const r = new FileReader();
  r.onload = () => { try { ok(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(r.result))); } catch { ng(new Error('UTF-8 として読めません')); } };
  r.onerror = () => ng(new Error('読めませんでした'));
  r.readAsArrayBuffer(file);
});
// items: [{ file, handle(ファイル操作機能の扱い。なければ null)か handleP(後から受け取る) }]
async function addFiles(items) {
  const wasEmpty = list.length === 0;
  const errors = [], entries = [];
  const plansNames = [];
  for (const { file } of items) {
    const k = kindOf(file.name);
    if (!k) { errors.push(`${file.name} は開けません。開けるのは .plan・.plans と、プロジェクト計画の版 0.30 までに保存した .svg です`); continue; }
    let text;
    try { text = await readText(file); } catch (e) { errors.push(`${file.name}: ${e.message}`); continue; }
    if (k === 'plan') { entries.push(D.load(file.name, text)); continue; }
    const x = k === 'plans' ? D.fromPlans(text) : D.extract(text, file.name);
    if (!x.ok) { errors.push(`${file.name}: ${x.error}`); continue; }
    if (k === 'plans') plansNames.push(file.name);
    for (const f of x.files) entries.push(D.load(f.name, f.text));
  }
  if (errors.length) alert(errors.join('\n'));
  const res = D.addEntries(list, entries);
  list = res.list;
  if (res.skipped.length) setStat(`同じ内容のため追加しませんでした: ${res.skipped.map((s) => `${s.name}(${s.dup} と同じ)`).join('、')}`, 10000);
  // 上書きの先は、空の一覧に最初に開いた .plans 1 つだけ(仕様書 7.2 節)
  const single = items.length === 1 && kindOf(items[0].file.name) === 'plans' && !errors.length;
  if (wasEmpty && single) {
    fileName = items[0].file.name; fileHandle = items[0].handle ?? null; dirty = false; mergeWarn = false; mergeNames = [];
    const g = editGen;
    if (items[0].handleP) items[0].handleP.then((h) => { if (h?.kind === 'file' && editGen === g) fileHandle = h; }).catch(() => {});
  } else if (res.added.length) {
    if (!wasEmpty && plansNames.length && hasTarget()) { mergeWarn = true; for (const n of plansNames) if (!mergeNames.includes(n)) mergeNames.push(n); }
    editGen++; dirty = true;
  }
  refresh();
}
const hasTarget = () => (FS_OK ? !!fileHandle : !!fileName);
$('#btnOpen').addEventListener('click', async () => {
  if (!FS_OK) { $('#fileOpen').click(); return; }
  let hs;
  try { hs = await window.showOpenFilePicker(PICK_OPEN); } catch (e) { if (e?.name !== 'AbortError') $('#fileOpen').click(); return; }
  const items = [];
  for (const h of hs) items.push({ file: await h.getFile(), handle: h });
  addFiles(items);
});
$('#fileOpen').addEventListener('change', (e) => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) addFiles(fs.map((file) => ({ file, handle: null }))); });
['dragenter', 'dragover'].forEach((ev) => window.addEventListener(ev, (e) => { e.preventDefault(); $('#drop').classList.add('on'); }));
['dragleave', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || e.relatedTarget === null) $('#drop').classList.remove('on'); }));
window.addEventListener('drop', (e) => {
  const fs = [...e.dataTransfer.files];
  if (!fs.length) return;
  // 上書きの先にするため、ファイルの扱いを受け取る(Chrome・Edge。ドロップの処理の中で呼ぶ必要がある)
  const its = [...(e.dataTransfer.items ?? [])];
  const hp = its.length === 1 && typeof its[0].getAsFileSystemHandle === 'function' ? its[0].getAsFileSystemHandle() : null;
  addFiles(fs.map((file, i) => ({ file, handle: null, handleP: i === 0 ? hp : null })));
});

// ---- 保存(仕様書 7.2 節): plans を上書き保存・別名で保存
function download(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
async function writeTo(h, text) { const w = await h.createWritable(); await w.write(text); await w.close(); }
let saving = false;
function setSaving(v) { saving = v; $('#btnSave').disabled = v; $('#btnSaveAs').disabled = v; }
function afterWrite(gen, msg) { if (editGen === gen) { dirty = false; mergeWarn = false; mergeNames = []; } /* 書き込み中に plans を足したときは、確かめる表示を残す(7.2 節) */ showName(); persist(); setStat(editGen === gen ? msg : `${msg}。保存中に変わった内容はまだ保存されていません`); }
const suggested = () => fileName || `${list.length ? baseOf(list[0].name) : 'projalysis'}.plans`;
// 足した plans も書き込むことを確かめる。'save'・'saveAs'・'cancel'
function askMerge() {
  return new Promise((ok) => {
    const d = $('#dlgMerge');
    d.querySelector('p').textContent = `足した plans(${mergeNames.join('、')})の版も、${fileName} に書き込みます。`;
    const done = (v) => { d.close(); ok(v); };
    d.querySelector('[data-a="save"]').onclick = () => done('save');
    d.querySelector('[data-a="saveAs"]').onclick = () => done('saveAs');
    d.querySelector('[data-a="cancel"]').onclick = () => done('cancel');
    d.onclose = () => ok('cancel');
    d.showModal();
  });
}
async function saveAs() {
  if (saving) return;
  if (FS_OK) {
    let h;
    try { h = await window.showSaveFilePicker({ suggestedName: suggested(), ...PICK_SAVE }); } catch (e) { if (e?.name === 'AbortError') return; h = null; }
    if (h) {
      const gen = editGen, text = D.toPlans(list);
      setSaving(true);
      try { await writeTo(h, text); fileHandle = h; fileName = h.name; afterWrite(gen, `${h.name} に保存しました(${stamp()})`); return; }
      catch { /* ダウンロードで保存する */ }
      finally { setSaving(false); }
    }
  }
  let name = prompt('ファイル名', suggested());
  if (name === null) return;
  name = name.trim() || suggested();
  if (!/\.plans$/i.test(name)) name += '.plans';
  download(name, new Blob([D.toPlans(list)], { type: 'application/json' }));
  fileName = name; fileHandle = null;
  afterWrite(editGen, '');
}
async function save() {
  if (saving) return;
  if (!hasTarget()) { saveAs(); return; }
  if (mergeWarn) {
    const a = await askMerge();
    if (a === 'cancel') return;
    if (a === 'saveAs') { saveAs(); return; }
  }
  const gen = editGen, text = D.toPlans(list);
  if (FS_OK) {
    const h = fileHandle;
    setSaving(true);
    try { await writeTo(h, text); afterWrite(gen, `${h.name} に上書き保存しました(${stamp()})`); }
    catch (e) { setStat(e?.name === 'AbortError' ? '上書き保存を取りやめました' : '上書きできませんでした。「別名で保存」を使ってください'); }
    finally { setSaving(false); }
    return;
  }
  // ファイル操作機能がないブラウザ: 同じ名前でダウンロードする
  download(fileName, new Blob([text], { type: 'application/json' }));
  afterWrite(gen, '');
}
$('#btnSave').addEventListener('click', save);
$('#btnSaveAs').addEventListener('click', saveAs);
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (e.repeat || document.querySelector('dialog[open]')) return;
    save();
  }
});

// ---- 画像(仕様書 7.3 節・7.4 節)
// ファイル名に使えない文字と空白を「_」にする
const safeName = (s) => s.replace(/[\\/:*?"<>|\s]+/g, '_');
// 画像のファイル名の元の名前(今のファイル名、なければ最初の版のファイル名。拡張子を除き、使えない文字を置き換える)
const imgBase = () => safeName(fileName ? baseOf(fileName) : list.length ? baseOf(list[0].name) : 'projalysis');
// 図または表を 1 つだけ、同じ大きさの紙で印刷する(ブラウザの「PDF に保存」で、余白のない PDF になる)
// 印刷の領域に入れる図は、id と url(#…) に印を付ける(画面の図と id が重なると、印刷では見えない画面の側の模様を指してしまうため)
// 書き換えるのは属性だけ(id="…" と ="url(#…)")。タスクの名前などの文の中に書いた url(#…) は変えない(文の中の " は &quot; になっている)
const printIds = (svg, tag) => svg.replace(/(\s)id="([^"]+)"/g, `$1id="$2-${tag}"`).replace(/="url\(#([^)"]+)\)"/g, `="url(#$1-${tag})"`);
function printOne(svg, base) {
  const [, w, h] = /width="([\d.]+)" height="([\d.]+)"/.exec(svg).map(Number);
  const area = $('#printArea');
  area.textContent = ''; area.classList.add('one');
  const p = el('div', 'page'); p.style.width = `${w}px`; p.style.height = `${h}px`; p.innerHTML = printIds(svg, 'p0'); area.append(p);
  let st = $('#pageOne');
  if (!st) { st = document.createElement('style'); st.id = 'pageOne'; document.head.append(st); }
  st.textContent = `@media print{@page{size:${w}px ${h}px;margin:0}}`;
  const title = document.title; document.title = base; // 「PDF に保存」のファイル名の候補になる
  try { window.print(); } finally { document.title = title; }
}
// SVG に紙の大きさの指定を入れる(保存した SVG をブラウザで開いて印刷したときにも、同じ大きさの紙になるように)
const withPage = (svg) => { const [, w, h] = /width="([\d.]+)" height="([\d.]+)"/.exec(svg); const i = svg.indexOf('>', svg.indexOf('<svg')); return `${svg.slice(0, i + 1)}<style>@page{size:${w}px ${h}px;margin:0}</style>${svg.slice(i + 1)}`; };
// 画像を保存する(SVG には何も埋め込まない。PNG は 2 倍の解像度)
function saveImage(svg, base, kind) {
  if (kind === 'pdf') { printOne(svg, base); return; }
  if (kind === 'svg') { download(`${base}.svg`, new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + withPage(svg)], { type: 'image/svg+xml' })); return; }
  const scale = 2;
  const m = /width="(\d+)" height="(\d+)"/.exec(svg);
  const w = +m[1], h = +m[2];
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  img.onload = () => {
    URL.revokeObjectURL(url);
    const c = document.createElement('canvas'); c.width = w * scale; c.height = h * scale;
    const g = c.getContext('2d');
    if (!g) { alert('画像が大きすぎて PNG にできませんでした。SVG で保存してください'); return; }
    g.scale(scale, scale); g.drawImage(img, 0, 0);
    c.toBlob((b) => { if (b) download(`${base}.png`, b); else alert('画像が大きすぎて PNG にできませんでした。SVG で保存してください'); }, 'image/png');
  };
  img.onerror = () => { URL.revokeObjectURL(url); alert('PNG の作成に失敗しました'); };
  img.src = url;
}

// ---- 印刷 / PDF(仕様書 7.5 節): ビューをすべて、6.1 節の順に。比べられる版が 2 つ未満なら概要だけ
function buildPrint() {
  const area = $('#printArea');
  area.textContent = '';
  // 図・表 1 つだけの印刷(PDF)の指定が残っていれば戻す(afterprint が来なかったときのため)
  area.classList.remove('one');
  const st = $('#pageOne'); if (st) st.textContent = '';
  const ids = pair ? D.VIEWS.map((v) => v.id) : ['overview'];
  let n = 0;
  for (const id of ids) {
    let pages;
    try { pages = D.printPages(list, id, pair); } catch { continue; }
    for (const svg of pages) { const p = el('div', 'page'); p.dataset.view = id; p.innerHTML = printIds(svg, `p${n}`); area.append(p); n++; }
  }
  return n;
}
$('#btnPrint').addEventListener('click', () => {
  if (!list.length) { alert('印刷できる表がありません(.plan を読み込んでください)'); return; }
  if (!buildPrint()) { alert('印刷できる表がありません'); return; }
  window.print();
});
window.addEventListener('afterprint', () => { $('#printArea').textContent = ''; $('#printArea').classList.remove('one'); const st = $('#pageOne'); if (st) st.textContent = ''; });

// ---- 上の帯のボタン
$('#btnNew').addEventListener('click', () => {
  if (dirty && list.length && !confirm('保存していない変更があります。一覧を空にしてよいですか?')) return;
  list = []; pair = null; pairUser = false; fileName = ''; fileHandle = null; dirty = false; mergeWarn = false; mergeNames = []; editGen++;
  refresh();
});
$('#btnHelp').addEventListener('click', () => { const d = $('#dlgHelp'); d.innerHTML = USAGE_HTML; d.showModal(); });
$('#dlgHelp').addEventListener('click', (e) => { const d = e.currentTarget, r = d.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close(); });

// ---- 分割バー
(() => {
  const sp = $('#splitter'), left = $('#left');
  let drag = false;
  sp.addEventListener('mousedown', () => { drag = true; document.body.style.userSelect = 'none'; });
  window.addEventListener('mouseup', () => { drag = false; document.body.style.userSelect = ''; });
  window.addEventListener('mousemove', (e) => { if (drag) left.style.width = `${Math.max(220, Math.min(window.innerWidth - 220, e.clientX))}px`; });
})();

// 開いたときは、前の一覧の続きを開く(なければ空)。上書きの先は覚えていないので、次の上書き保存では保存先を尋ねる
restore();
refresh();
})();
