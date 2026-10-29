# index.html を組み立てる(開発用。アプリ本体には含めない)
#   python3 dev/build.py         dev/ の core.js・logcore.js・diff.js・team.js・ui.js・usage.html から、ルートの index.html を作る
#   python3 dev/build.py sync    プロジェクト計画(隣の ../plan)の dev/core.js と、マイログ(隣の ../mylog)の dev/logcore.js から写し直す
#   python3 dev/build.py check   写しの dev/core.js・dev/logcore.js が、写し元と 1 バイトも違わないかを調べる
import json, pathlib, sys
d = pathlib.Path(__file__).parent      # dev/
root = d.parent                        # リポジトリのトップ(index.html を書く)
SRC = {'core.js': root.parent / 'plan' / 'dev' / 'core.js', 'logcore.js': root.parent / 'mylog' / 'dev' / 'logcore.js'}

if len(sys.argv) > 1:
    cmd = sys.argv[1]
    if cmd not in ('sync', 'check'):
        print(f'知らない命令です: {cmd}\n使い方: python3 dev/build.py [sync|check](何も付けなければ index.html を組み立てる)')
        sys.exit(2)
    bad = 0
    for name, src in SRC.items():
        if not src.exists():
            print(f'{src} がありません(~/projects に plan と mylog のリポジトリを置いてください)')
            bad += 1
            continue
        if cmd == 'sync':
            (d / name).write_bytes(src.read_bytes())
            print(f'dev/{name} を写し直しました')
        else:
            same = src.read_bytes() == (d / name).read_bytes()
            print(f'dev/{name}: ' + ('同じです' if same else '違います(python3 dev/build.py sync で写し直してください)'))
            bad += 0 if same else 1
    sys.exit(1 if bad else 0)

core = (d / 'core.js').read_text()
logcore = (d / 'logcore.js').read_text()
diff = (d / 'diff.js').read_text()
team = (d / 'team.js').read_text()
ui = (d / 'ui.js').read_text()
usage_html = (d / 'usage.html').read_text()
t = root / 'test'
sample_plans = [{'name': n, 'text': (t / n).read_text()} for n in ('sample_old.plan', 'sample.plan')]
sample_logs = [{'name': f'{who}.mylog', 'text': (t / f'sample_{key}.mylog').read_text()} for key, who in (('aoki', '青木'), ('inoue', '井上'), ('ueda', '上田'))]
head = '''<!DOCTYPE html>
<!--
  プロジェクト分析 — プロジェクト計画の計画書(.plan)の版どうしの変更と、チーム全員のマイログ(.mylog)による作業の集計・問題の兆候を、表と図で出す単一 HTML ツール
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
  計算部(CORE-BEGIN 〜 CORE-END)はプロジェクト計画の core.js を、LOG-BEGIN 〜 LOG-END はマイログの logcore.js を、そのまま写したものです。
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
header{display:flex;align-items:center;gap:5px;padding:6px 10px;background:var(--panel);border-bottom:1px solid var(--line);flex-wrap:wrap}
header h1{font-size:16px;margin:0 6px 0 0;font-weight:600}
header .sp{flex:1}
header button{padding:4px 8px}
button,select,label.btn{font:inherit;padding:4px 10px;border:1px solid #bbb;border-radius:4px;background:#fafafa;cursor:pointer;color:var(--text)}
button:hover,label.btn:hover{background:#f0f0ee}
select{max-width:28em}
main{flex:1;display:flex;min-height:0}
#left{width:22%;min-width:220px;display:flex;flex-direction:column;border-right:1px solid var(--line);background:var(--panel)}
#splitter{width:6px;cursor:col-resize;background:var(--line)}
#right{flex:1;display:flex;flex-direction:column;min-width:0}
#logs,#plans{font-size:13px;background:#fcfcfa;overflow:auto}
#plans{max-height:50%}
#logs{flex:1;min-height:0;border-top:1px solid var(--line)}
#logs .head,#plans .head{display:flex;align-items:baseline;flex-wrap:wrap;gap:2px 8px;padding:6px 10px;cursor:pointer;font-weight:600;user-select:none}
#logs .head>span:first-child,#plans .head>span:first-child{white-space:nowrap}
#logs .head .small,#plans .head .small{font-weight:400}
/* 一覧の項目: 版の 0.32 までのプロジェクト分析と同じ形(枠の中に、1 行目は名前とボタン、2 行目は状態) */
#logs ul,#plans ul{list-style:none;margin:0;padding:0 10px 6px}
#logs li,#plans li{border:1px solid var(--line);border-radius:4px;padding:5px 8px;margin-bottom:6px;background:#fff}
#logs .ihead,#plans .ihead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
#logs .lab,#plans .lab{font-weight:600;white-space:nowrap}
#logs .iname,#plans .iname{color:#444;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:6em}
#logs .ibtns,#plans .ibtns{display:flex;gap:4px;margin-left:auto}
#logs .ibtns button,#plans .ibtns button{font-size:12px;padding:1px 7px}
#logs .sub,#plans .sub{font-size:12px;margin-top:2px;color:#666}
#logs .err,#plans .err{color:var(--err)}
#logs .warn,#plans .warn{color:var(--warn)}
#logs .ok,#plans .ok{color:#2a6b2a}
#logs .note,#plans .note{padding:0 10px 6px;color:#666}
#logs.closed ul,#logs.closed .note,#plans.closed ul,#plans.closed .note{display:none}
#view{flex:1;overflow:auto;background:#fff;position:relative}
#canvas{position:relative}
#canvas .tbtns{position:absolute;display:flex;gap:4px;z-index:2;white-space:nowrap;width:max-content}
#canvas .tbtns button{font-size:11px;line-height:1.2;padding:1px 7px;border-radius:3px;white-space:nowrap;flex:none}
#view svg{display:block}
#view.stale svg{opacity:.45}
#view [data-id],#view [data-file],#view [data-ver],#view [data-pair]{cursor:pointer}
#view .selected rect{stroke:var(--accent);stroke-width:2}
#view .empty{padding:16px;color:#666}
dialog{border:1px solid #999;border-radius:6px;padding:16px 20px;max-width:760px;font-size:14px}
dialog h2{font-size:16px;margin:12px 0 8px}
dialog h2:first-child{margin-top:0}
dialog pre{background:#f6f6f2;padding:8px;overflow:auto;font-size:12px;margin:0}
dialog table{border-collapse:collapse;font-size:13px}
dialog td,dialog th{border:1px solid #ccc;padding:3px 8px;text-align:left;vertical-align:top}
dialog th,dialog td:nth-child(-n+2){white-space:nowrap}
dialog code{background:#f6f6f2;padding:0 3px}
#dlgSet input{width:5em;font:inherit;padding:2px 4px}
#dlgSet td:nth-child(2){white-space:normal}
#drop{position:absolute;inset:0;background:rgba(139,26,43,.08);border:3px dashed var(--accent);display:none;align-items:center;justify-content:center;font-size:20px;color:var(--accent);pointer-events:none;text-align:center}
#drop.on{display:flex}
.small{font-size:12px;color:#666}
#warn{color:var(--err);font-size:12px}
.fname{font-size:13px;color:#444;max-width:18em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.stat{font-size:12px;color:#2a6b2a}
button:disabled{opacity:.5;cursor:default}
footer{font-size:11px;color:#777;padding:3px 10px;border-top:1px solid var(--line);background:var(--panel)}
footer a{color:#777}
/* 印刷 / PDF: 作業分析は縦向き、サマリーと計画書分析は横向きのページに(A4)。ページの余白は 0(ブラウザが日時・題名などを書く場所をなくすため)。図の周りの空きはページの内側に取る */
#printArea{display:none}
@media print{
  @page{size:A4 portrait;margin:0}
  @page land{size:A4 landscape;margin:0}
  html,body{height:auto;overflow:visible;display:block;background:#fff}
  body>*:not(#printArea){display:none!important}
  #printArea{display:block}
  #printArea .page{break-after:page;page-break-after:always;display:flex;align-items:flex-start;justify-content:center;box-sizing:border-box;height:calc(297mm - 1px);padding:10mm;overflow:hidden}
  #printArea .page.land{page:land;height:calc(210mm - 1px)}
  #printArea .page:last-child{break-after:auto;page-break-after:auto}
  #printArea svg{max-width:100%;max-height:100%;width:auto;height:auto}
  #printArea.one .page{padding:0;display:block;break-after:auto;page-break-after:auto;height:auto}
  #printArea.one svg{display:block;max-width:none;max-height:none}
}
#pairbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 12px;border-bottom:1px solid #ddd;background:#fafaf8;font-size:13px}
#pairbar[hidden],#bar[hidden]{display:none}
#pairbar label{display:flex;gap:6px;align-items:center}
#pairbar .ttl{font-weight:600}
#pairbar .quick{display:flex;gap:6px;align-items:center;margin-left:8px}
#pairbar .qlab{color:#666}
#bar{display:flex;gap:6px 14px;align-items:center;flex-wrap:wrap;padding:6px 12px;border-bottom:1px solid #ddd;background:#fafaf8;font-size:13px}
#bar input[type=date]{font:inherit;padding:2px 4px}
#bar label[hidden]{display:none}
#info{border-top:1px solid var(--line);background:var(--panel);padding:8px 10px;display:none;max-height:30%;overflow:auto}
#info.on{display:block}
#info .row{display:flex;gap:6px 14px;flex-wrap:wrap;align-items:center;margin-bottom:6px}
#info .kind{font-weight:600}
#info pre.line{margin:0;padding:6px 8px;background:#f6f6f2;font:13px/1.5 Consolas,"Courier New",monospace;white-space:pre-wrap}
#dlgAsk .btns,#dlgDiag .btns{display:flex;gap:8px;margin-top:8px}
#dlgDiag ul{padding-left:1.4em;max-height:60vh;overflow:auto}
#dlgDiag .err{color:var(--err)}#dlgDiag .warn{color:var(--warn)}
</style>
</head>
<body>
<header>
  <h1>プロジェクト分析</h1>
  <button id="btnNew">新規</button>
  <button id="btnOpen" title="plans(.plans)を開いて、計画書とマイログの一覧を入れ替える。計画書(.plan)・マイログ(.mylog)を選んだときは、それぞれの一覧に足す">開く</button><input type="file" id="fileOpen" accept=".plans,.plan,.txt,.mylog,.svg" multiple style="display:none">
  <button id="btnSave" title="開いている plans に上書き保存(Ctrl+S。まだファイルがないときは保存先を選ぶ)">上書き保存</button>
  <button id="btnSaveAs" title="保存先とファイル名を選んで、計画書とマイログの一覧を plans(.plans)に保存">別名で保存</button>
  <button id="btnPrint" title="ビューをすべて印刷する(印刷の画面で「PDF に保存」を選ぶと PDF になる)">印刷 / PDF</button>
  <span id="fileName" class="fname"></span>
  <span id="stat" class="stat" role="status"></span>
  <label>ビュー <select id="viewKind"></select></label>
  <span id="warn" role="status"></span>
  <span class="sp"></span>
  <button id="btnAddFiles" title="計画書(.plan)・マイログ(.mylog)を一覧に追加する。読むだけで、書き換えない">ファイルを追加</button><input type="file" id="fileAdd" accept=".plans,.plan,.txt,.mylog,.svg" multiple style="display:none">
  <button id="btnSet" title="要確認の規則の値(日数など)を変える">設定</button>
  <button id="btnSample">例を読み込む</button>
  <button id="btnUse">使い方</button>
</header>
<main>
  <div id="left">
    <div id="plans"></div>
    <div id="logs"></div>
  </div>
  <div id="splitter"></div>
  <div id="right">
    <div id="pairbar" hidden><span class="ttl">比較</span><label>変更前 <select id="selA"></select></label><span>→</span><label>変更後 <select id="selB"></select></label><span class="quick"><span class="qlab">プリセット</span><button id="btnFirstLast" title="比べられる版の最初(初版)と最後(最新版)を比較する(既定の組。版を足すと最新版に合わせて変わる)">初版 → 最新版</button><button id="btnPrevLast" title="最新版と、その一つ前の比べられる版を比較する">前の版 → 最新版</button></span></div>
    <div id="bar" hidden><label>基準日 <input type="date" id="baseDate"></label><button id="btnToday" title="基準日を今日にする">今日</button><label id="weekLab" hidden>週のまとめで見る週 <select id="weekSel"></select></label></div>
    <div id="view"><div id="canvas"></div><div id="drop">ファイルを置くと読みます<br>(.plans は開き、.plan・.mylog は一覧に足します)</div></div>
    <div id="info"></div>
  </div>
</main>
<footer>プロジェクト分析 — データはどこにも送信されません。MIT License, Copyright (c) 2026 Kouta Sekine. <a href="https://sapp.jp" target="_blank" rel="noopener">S Apps</a></footer>

<dialog id="dlgUse"></dialog>
<dialog id="dlgSet"></dialog>
<dialog id="dlgAsk"></dialog>
<dialog id="dlgDiag"></dialog>
<div id="printArea"></div>
<script>
'''
js_consts = ('const SAMPLE_PLANS = ' + json.dumps(sample_plans, ensure_ascii=False) + ';\nconst SAMPLE_LOGS = ' + json.dumps(sample_logs, ensure_ascii=False)
             + ';\nconst USAGE_HTML = ' + json.dumps(usage_html, ensure_ascii=False) + ';\n')
body = core + '\n' + logcore + '\n' + diff + '\n' + team + '\n' + js_consts + ui
assert '</script' not in body.replace('<\\/script', '')
out = head + body + '</script>\n</body>\n</html>\n'
(root / 'index.html').write_text(out)
print('index.html', len(out.encode()), 'bytes')
