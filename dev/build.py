# index.html を組み立てる(開発用。アプリ本体には含めない)。リポジトリのルートで実行する
#   python3 dev/build.py         dev/ の core.js・diff.js・ui.js・usage.html から、ルートの index.html を作る
#   python3 dev/build.py sync    プロジェクト計画のリポジトリ(隣の ../plan)の dev/core.js から dev/core.js に写し直す
#   python3 dev/build.py check   写しの dev/core.js が、プロジェクト計画の core.js と 1 バイトも違わないかを調べる
import json, pathlib, shutil, sys
d = pathlib.Path(__file__).resolve().parent   # dev/
root = d.parent                               # リポジトリのルート
PLAN_CORE = root.parent / 'plan' / 'dev' / 'core.js'  # プロジェクト計画も版 0.31 から dev/ の構成

def check():
    if not PLAN_CORE.exists():
        print(f'{PLAN_CORE} がないので調べませんでした')
        return True
    same = PLAN_CORE.read_bytes() == (d / 'core.js').read_bytes()
    print('core.js はプロジェクト計画のものと同じです' if same else f'core.js がプロジェクト計画のもの({PLAN_CORE})と違います。python3 dev/build.py sync で写し直してください')
    return same

cmd = sys.argv[1] if len(sys.argv) > 1 else 'build'
if cmd not in ('build', 'sync', 'check'):
    print(f'知らない命令です: {cmd}\n使い方: python3 dev/build.py [sync|check](何も付けなければ index.html を組み立てる)')
    sys.exit(2)
if cmd == 'sync':
    if not PLAN_CORE.exists():
        print(f'写し元の {PLAN_CORE} がありません。隣にプロジェクト計画のリポジトリ(../plan)を置いてください')
        sys.exit(1)
    shutil.copyfile(PLAN_CORE, d / 'core.js')
    print(f'{PLAN_CORE} を core.js に写しました')
    sys.exit(0)
if cmd == 'check':
    sys.exit(0 if check() else 1)

core = (d / 'core.js').read_text()
diff = (d / 'diff.js').read_text()
ui = (d / 'ui.js').read_text()
usage = (d / 'usage.html').read_text()
head = '''<!DOCTYPE html>
<!--
  プロジェクト分析 — プロジェクト計画(https://plan.sapp.jp)の .plan を複数読み込み、変更箇所と変更履歴を表と図にする単一 HTML ツール
  https://projalysis.sapp.jp

  MIT License
  Copyright (c) 2026 Kouta Sekine

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.

  このファイルは外部ライブラリを使わず、データをどこにも送信しません。ネットワークなしで動きます。
  計算部(CORE-BEGIN 〜 CORE-END)は、プロジェクト計画の core.js をそのまま写したものです。
-->
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>プロジェクト分析</title>
<style>
/* 配色・字体・ボタンの形・ダイアログ・ドラッグ・アンド・ドロップの表示・フッターは、プロジェクト計画(plan.sapp.jp)と同じ */
:root{
  --bg:#f4f4f2; --panel:#fff; --line:#d8d8d4; --text:#222; --accent:#8b1a2b; --err:#b00020; --sel:#fff3c4; --warn:#8a5a00;
}
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{font-family:"Segoe UI","Hiragino Sans","Noto Sans JP","Yu Gothic UI",sans-serif;font-size:14px;color:var(--text);background:var(--bg);display:flex;flex-direction:column;overflow:hidden}
header{display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--panel);border-bottom:1px solid var(--line);flex-wrap:wrap}
header h1{font-size:16px;margin:0 10px 0 0;font-weight:600}
header .sp{flex:1}
button,select,label.btn{font:inherit;padding:4px 10px;border:1px solid #bbb;border-radius:4px;background:#fafafa;cursor:pointer;color:var(--text)}
button:hover,label.btn:hover{background:#f0f0ee}
select{max-width:28em}
main{flex:1;display:flex;min-height:0}
#left{width:22%;min-width:220px;display:flex;flex-direction:column;border-right:1px solid var(--line);background:var(--panel)}
#splitter{width:6px;cursor:col-resize;background:var(--line)}
#right{flex:1;display:flex;flex-direction:column;min-width:0}
#list{flex:1;overflow:auto;padding:8px 10px}
#list .item{border:1px solid var(--line);border-radius:4px;padding:5px 8px;margin-bottom:6px;font-size:13px}
#list .ihead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
#list .lab{font-weight:600}
#list .iname{color:#444;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:6em}
#list .ibtns{display:flex;gap:4px}
#list .ibtns button{font-size:12px;padding:1px 7px}
#list .err{color:var(--err);font-size:12px;margin-top:2px}
#list .warn{color:var(--warn);font-size:12px;margin-top:2px}
#list .ok{color:#2a6b2a;font-size:12px;margin-top:2px}
/* 比較する版の帯: 2 つの版を比較するビューの上にだけ出す */
#pairbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 10px;border-bottom:1px solid var(--line);background:var(--panel);font-size:13px}
#pairbar[hidden]{display:none}
#pairbar label{display:flex;gap:6px;align-items:center}
#pairbar .ttl{font-weight:600}
#pairbar .quick{display:flex;gap:6px;align-items:center;margin-left:8px}
#pairbar .qlab{color:#666}
#canvas{position:relative;width:max-content;min-width:100%}
/* 表と図の題の右のボタン(コピー・SVG・PNG)。図の上に重ねるだけで、図には含めない */
#canvas .tbtns{position:absolute;display:flex;gap:4px;white-space:nowrap;width:max-content}
#canvas .tbtns button{white-space:nowrap;flex:none;font-size:11px;line-height:1.2;padding:1px 7px;border-radius:3px}
#view{flex:1;overflow:auto;background:#fff;position:relative}
#view svg{display:block}
#view .empty{padding:16px;color:#666}
#view [data-ver],#view [data-pair]{cursor:pointer}
dialog{border:1px solid #999;border-radius:6px;padding:16px 20px;max-width:760px;font-size:14px}
dialog h2{font-size:16px;margin:12px 0 8px}
dialog h2:first-child{margin-top:0}
dialog table{border-collapse:collapse;font-size:13px}
dialog td,dialog th{border:1px solid #ccc;padding:3px 8px;text-align:left;vertical-align:top}
dialog th,dialog td:first-child{white-space:nowrap}
dialog code{background:#f6f6f2;padding:0 3px}
#dlgMerge .btns{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
#drop{position:absolute;inset:0;background:rgba(139,26,43,.08);border:3px dashed var(--accent);display:none;align-items:center;justify-content:center;font-size:20px;color:var(--accent);pointer-events:none}
#drop.on{display:flex}
.small{font-size:12px;color:#666}
.err{color:var(--err)}
#warn{color:var(--err);font-size:12px}
.fname{font-size:13px;color:#444;max-width:18em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.stat{font-size:12px;color:#2a6b2a}
button:disabled{opacity:.5;cursor:default}
footer{font-size:11px;color:#777;padding:3px 10px;border-top:1px solid var(--line);background:var(--panel)}
footer a{color:#777}
/* 印刷 / PDF: ビューをすべて横向きで。ページの余白は 0 にし(ブラウザが日時・題名・アドレス・ページ番号を書く場所をなくすため)、表の周りの空きはページの内側に取る */
#printArea{display:none}
@media print{
  @page{size:landscape;margin:0}
  html,body{height:auto;overflow:visible;display:block;background:#fff}
  body>*:not(#printArea){display:none!important}
  #printArea{display:block}
  #printArea .page{break-after:page;page-break-after:always;display:flex;align-items:flex-start;justify-content:center;box-sizing:border-box;height:calc(100vh - 1px);padding:10mm;overflow:hidden}
  #printArea .page:last-child{break-after:auto;page-break-after:auto}
  #printArea svg{max-width:100%;max-height:100%;width:auto;height:auto}
  /* 図・表を 1 つだけ印刷するとき: 紙は図と同じ大きさ(@page は ui.js が足す)。余白も内側の空きもなし */
  #printArea.one .page{padding:0;display:block;break-after:auto;page-break-after:auto}
  #printArea.one svg{display:block;max-width:none;max-height:none}
}
</style>
</head>
<body>
<header>
  <h1>プロジェクト分析</h1>
  <button id="btnNew" title="一覧を空にする">新規</button>
  <button id="btnOpen" title=".plan・.plans、プロジェクト計画の版 0.30 までに保存した SVG を一覧に足す(複数を選べる)">開く</button><input type="file" id="fileOpen" accept=".plan,.plans,.svg" multiple style="display:none">
  <button id="btnSave" title="開いている .plans に上書き保存(Ctrl+S。まだファイルがないときは保存先を選ぶ)">上書き保存</button>
  <button id="btnSaveAs" title="保存先とファイル名を選んで、一覧を .plans に保存">別名で保存</button>
  <button id="btnPrint" title="ビューをすべて印刷する(印刷の画面で「PDF に保存」を選ぶと PDF になる)">印刷 / PDF</button>
  <span id="fileName" class="fname"></span>
  <span id="stat" class="stat" role="status"></span>
  <label>ビュー <select id="viewKind"></select></label>
  <span id="warn" role="status"></span>
  <span class="sp"></span>
  <button id="btnHelp">使い方</button>
</header>
<main>
  <div id="left">
    <div id="list"></div>
  </div>
  <div id="splitter"></div>
  <div id="right">
    <div id="pairbar" hidden><span class="ttl">比較</span><label>変更前 <select id="selA"></select></label><span>→</span><label>変更後 <select id="selB"></select></label><span class="quick"><span class="qlab">プリセット</span><button id="btnFirstLast" title="比べられる版の最初(初版)と最後(最新版)を比較する(既定の組。版を足すと最新版に合わせて変わる)">初版 → 最新版</button><button id="btnPrevLast" title="最新版と、その一つ前の比べられる版を比較する">前の版 → 最新版</button></span></div>
    <div id="view"><div id="canvas"></div><div id="drop">ファイルを置くと一覧に足します(.plan / .plans / .svg)</div></div>
  </div>
</main>
<footer>プロジェクト分析 — データはどこにも送信されません。MIT License, Copyright (c) 2026 Kouta Sekine. <a href="https://sapp.jp" target="_blank" rel="noopener">S Apps</a></footer>

<dialog id="dlgHelp"></dialog>
<dialog id="dlgMerge"><p></p><div class="btns"><button data-a="save">上書き保存</button><button data-a="saveAs">別名で保存</button><button data-a="cancel">やめる</button></div></dialog>
<div id="printArea"></div>
<script>
'''
js_consts = 'const USAGE_HTML = ' + json.dumps(usage, ensure_ascii=False) + ';\n'
body = core + '\n' + diff + '\n' + js_consts + ui
assert '</script' not in body.replace('<\\/script', '')
out = head + body + '</script>\n</body>\n</html>\n'
(root / 'index.html').write_text(out)
print('index.html', len(out.encode()), 'bytes')
check()
