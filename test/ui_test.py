# 画面の検査。Python の playwright と Chromium で動かす(python3 test/ui_test.py)
# 前半: 計画書分析(計画書の一覧・比べる 2 つの版・ビュー・表のコピーと表・図の画像の保存・plans・自動保持)
# 後半: 作業分析(例・マイログの一覧・基準日・週のまとめ・開いたときのビュー・plans の logs)
import json, pathlib, sys, tempfile
from playwright.sync_api import sync_playwright

d = pathlib.Path(__file__).resolve().parent
# ローカルの HTTP サーバーで開く(公開時と同じく http(s) で開くため。file:// で開くと、ヘッドレスの Chromium では
# 開き直した直後に localStorage が見えないことがあり、自動保持の検査が安定しない)
import functools, http.server, threading
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(d.parent)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/index.html'
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(tempfile.mkdtemp())
fail = 0
def ok(c, msg):
    global fail
    if not c:
        fail += 1
        print('NG:', msg)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1400, 'height': 900}, accept_downloads=True)
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('dialog', lambda dl: dl.accept())
    pg.goto(url)
    ok(pg.locator('#plans li').count() == 0, '最初の一覧が空でない')
    files = [str(d / f) for f in ['v3.plan', 'v1.plan', 'v2.plan', 'err.plan', 'nover.plan']]
    pg.set_input_files('#fileOpen', files)
    pg.wait_for_function('document.querySelectorAll("#plans li").length === 5')
    labs = pg.locator('#plans .lab').all_inner_texts()
    names = pg.locator('#plans .iname').all_inner_texts()
    ok(labs == ['2026-04-20 版', '2026-05-01 版', '2026-05-01 版 (2)', '2026-05-03 版', 'version: なし'], f'版の名前: {labs}')
    ok(names == ['v1.plan', 'v3.plan', 'v2.plan', 'err.plan', 'nover.plan'], f'並び: {names}')
    ok('*' in pg.inner_text('#fileName'), '足した後に * が付かない')
    # 比べる 2 つの版の既定は、比べられる版の最初と最後
    a = pg.eval_on_selector('#selA', 'e => e.options[e.selectedIndex].text')
    bb = pg.eval_on_selector('#selB', 'e => e.options[e.selectedIndex].text')
    ok(a.startswith('2026-04-20 版') and bb.startswith('2026-05-01 版 (2)'), f'既定の 2 つ: {a} / {bb}')
    # 同じ日付の中の並べ替え: v3 を後ろへ
    pg.locator('#plans li').nth(1).locator('button', has_text='▼').click()
    names = pg.locator('#plans .iname').all_inner_texts()
    ok(names[1:3] == ['v2.plan', 'v3.plan'], f'並べ替え: {names}')
    ok(pg.locator('#plans li').nth(0).locator('button', has_text='▼').is_disabled(), '日付をまたいで並べ替えられる')
    # 同じテキストは足さない
    pg.set_input_files('#fileOpen', [str(d / 'v1.plan')])
    pg.wait_for_timeout(200)
    ok(pg.locator('#plans li').count() == 5, '同じ版が足された')
    ok('同じ内容のため追加しませんでした' in pg.inner_text('#plans'), '同じ版の知らせがない')
    # ビュー
    for v in ['overview', 'history', 'trend', 'tasks', 'sched', 'fbs', 'people', 'gantt']:
        pg.select_option('#viewKind', v)
        ok(pg.locator('#canvas svg').count() == 1, f'{v} が描けない')
        pg.screenshot(path=str(out / f'view_{v}.png'), full_page=True)
    # 改訂履歴の行を押すと、その版と一つ前の版を比べる(仕様書 5.13 節)
    pg.select_option('#viewKind', 'history')
    ok('エラーのため除外: err.plan' in pg.inner_text('#canvas') or 'エラーのため除外: err.plan' in pg.inner_html('#canvas'), '改訂履歴の警告がない')
    pg.locator('#canvas [data-ver="2"]').last.click(force=True)
    ok('v2.plan' in pg.eval_on_selector('#selA', 'e => e.options[e.selectedIndex].text') and 'v3.plan' in pg.eval_on_selector('#selB', 'e => e.options[e.selectedIndex].text'), '改訂履歴の行を押したときの 2 つの版')
    ok(pg.input_value('#viewKind') == 'history', '改訂履歴の行を押したらビューが変わった')
    # 推移の図から比べる 2 つの版を選ぶ(仕様書 5.12 節): 版を押すとその版と一つ前の版。表示中のビューは変えない
    pg.select_option('#viewKind', 'trend')
    pg.locator('#canvas [data-ver="1"]').first.click()
    ok(pg.input_value('#viewKind') == 'trend', '図から選んだらビューが変わった')
    ok('v1.plan' in pg.eval_on_selector('#selA', 'e => e.options[e.selectedIndex].text') and 'v2.plan' in pg.eval_on_selector('#selB', 'e => e.options[e.selectedIndex].text'), '版を押したときの 2 つの版')
    pg.locator('#canvas [data-pair="1"]').first.click()
    ok('v2.plan' in pg.eval_on_selector('#selA', 'e => e.options[e.selectedIndex].text') and 'v3.plan' in pg.eval_on_selector('#selB', 'e => e.options[e.selectedIndex].text'), '版の組を押したときの 2 つの版')
    pg.locator('#canvas [data-ver="0"]').first.click()
    ok('v1.plan' in pg.eval_on_selector('#selA', 'e => e.options[e.selectedIndex].text') and 'v2.plan' in pg.eval_on_selector('#selB', 'e => e.options[e.selectedIndex].text'), '最初の版を押したときの 2 つの版')
    # 表と図の題の右のボタン(仕様書 6.2 節・7.3 節): 表は「コピー」、図は SVG・PNG。上の帯はない
    ok(pg.locator('#copybar').count() == 0 and pg.locator('#figSave').count() == 0, '上の帯が残っている')
    copies = pg.eval_on_selector_all('#canvas [data-piece$="|copy"]', 'es => es.map((e) => e.dataset.piece.slice(6, -5))')
    ok(copies == ['タスクの進捗が初めて変わった版'], f'推移のビューでコピーできる表: {copies}')
    figs = pg.eval_on_selector_all('#canvas [data-piece^="fig:"]', 'es => es.map((e) => e.dataset.piece.slice(4))')
    ok(figs == [f'{i}|{k}' for i in ['end', 'burnup', 'status', 'changes', 'effort'] for k in ['svg', 'png', 'pdf']], f'図の保存のボタン: {figs}')
    # ボタンは題の右にあり、文字の見た目の高さがそろう。画面写真の濃い画素から、題とボタンの文字の上下の範囲を測って比べる
    def glyph_rows(box):
        import io
        from PIL import Image
        img = Image.open(io.BytesIO(pg.screenshot(clip=box))).convert('L')
        w, h = img.size
        rows = [y for y in range(h) if any(img.getpixel((x, y)) < 110 for x in range(w))]
        return (rows[0] + rows[-1]) / 2 if rows else None
    def check_align(btn_sel, title_start, name):
        info = pg.evaluate('''([sel, st]) => { document.querySelector(sel).scrollIntoView({ block: 'center', inline: 'center' }); const b = document.querySelector(sel).getBoundingClientRect(); const t = [...document.querySelectorAll('#canvas svg text')].find((x) => x.textContent.startsWith(st)).getBoundingClientRect(); return { b: [b.left, b.top, b.width, b.height], t: [t.left, t.top, t.width, t.height] }; }''', [btn_sel, title_start])
        bx, by, bw, bh = info['b']; tx, ty, tw, th = info['t']
        top = min(by, ty) - 4; height = max(by + bh, ty + th) + 4 - top
        # 題の文字だけの範囲と、ボタンの枠の内側(枠の線を除く)の範囲を、同じ上下の範囲で切り出す
        tmid = glyph_rows({'x': tx, 'y': top, 'width': tw, 'height': height})
        bmid = glyph_rows({'x': bx + 3, 'y': by + 2, 'width': bw - 6, 'height': bh - 4})
        bmid = bmid + (by + 2 - top) if bmid is not None else None
        gap = bx - (tx + tw)
        ok(tmid is not None and bmid is not None and abs(tmid - bmid) <= 1.5 and 3 <= gap <= 9, f'{name}: 文字の見た目の中心のずれ {None if tmid is None or bmid is None else round(bmid - tmid, 1)}px、横のすき間 {gap:.1f}px')
    check_align('#canvas [data-piece="fig:status|svg"]', 'タスク数と進捗の推移', '推移の図 D のボタン')
    check_align('#canvas [data-piece$="|copy"]', 'タスクの進捗が初めて変わった版', '表のコピーのボタン')
    with pg.expect_download() as dl:
        pg.click('#canvas [data-piece="fig:status|svg"]')
    ok(dl.value.suggested_filename.endswith('_trend_status.svg'), f'図の SVG の名前: {dl.value.suggested_filename}')
    fsvg = pathlib.Path(dl.value.path()).read_text()
    ok('<metadata' not in fsvg and 'タスク数と進捗の推移' in fsvg and '終了日の推移' not in fsvg and 'コピー' not in fsvg, '図の SVG が図 1 つでない、埋め込みがない、またはボタンが入っている')
    with pg.expect_download() as dl:
        pg.click('#canvas [data-piece="fig:changes|png"]')
    ok(dl.value.suggested_filename.endswith('_trend_changes.png') and pathlib.Path(dl.value.path()).read_bytes()[:4] == b'\x89PNG', f'図の PNG: {dl.value.suggested_filename}')
    pg.select_option('#viewKind', 'gantt')
    check_align('#canvas [data-piece="fig:gantt|svg"]', 'ガントチャートの比較', 'ガントチャート F のボタン(15 px の題)')
    check_align('#canvas [data-piece$="|copy"]', '対応した要素', '対応した要素のコピーのボタン')
    pg.select_option('#viewKind', 'tasks')
    ok(pg.locator('#canvas [data-piece^="fig:"]').count() == 0, '図のないビューに図の保存のボタンがある')
    # 表のコピー
    pg.click('#canvas [data-piece="table:追加したタスク|copy"]')
    clip = pg.evaluate('navigator.clipboard.readText()')
    ok(clip.split('\n')[0] == 'タスク\t日数\t作成者\t確認者', f'コピーの見出し: {clip[:60]!r}')
    # 表の画像(仕様書 6.2 節): コピー・SVG・PNG が並び、SVG は題を入れない表 1 つだけで、何も埋め込まない
    ok(pg.locator('#canvas [data-piece$="|copy"]').count() == pg.locator('#canvas [data-piece^="table:"][data-piece$="|svg"]').count() == pg.locator('#canvas [data-piece^="table:"][data-piece$="|png"]').count() > 0, '表ごとにコピー・SVG・PNG が並ばない')
    tops = pg.evaluate("""() => ['[data-piece="table:追加したタスク|copy"]', '[data-piece="table:追加したタスク|svg"]', '[data-piece="table:追加したタスク|png"]'].map((s) => { const r = document.querySelector('#canvas ' + s).getBoundingClientRect(); return [r.top, r.left]; })""")
    ok(abs(tops[0][0] - tops[1][0]) < 0.5 and abs(tops[0][0] - tops[2][0]) < 0.5 and tops[0][1] < tops[1][1] < tops[2][1], f'表の SVG・PNG のボタンがコピーの右に並ばない: {tops}')
    with pg.expect_download() as dl:
        pg.click('#canvas [data-piece="table:追加したタスク|svg"]')
    ok(dl.value.suggested_filename.endswith('_tasks_追加したタスク.svg'), f'表の SVG の名前: {dl.value.suggested_filename}')
    tsvg = pathlib.Path(dl.value.path()).read_text()
    ok(tsvg.count('>タスク</text>') == 1 and '追加したタスク' not in tsvg and '削除したタスク' not in tsvg and '<metadata' not in tsvg and 'コピー' not in tsvg, '表の SVG が題のない表 1 つでない、または埋め込みがある')
    with pg.expect_download() as dl:
        pg.click('#canvas [data-piece="table:追加したタスク|png"]')
    ok(dl.value.suggested_filename.endswith('_tasks_追加したタスク.png') and pathlib.Path(dl.value.path()).read_bytes()[:4] == b'\x89PNG', f'表の PNG: {dl.value.suggested_filename}')
    # ビュー全体の画像の保存はない。保存した SVG を開いても一覧は変わらない(仕様書 3.1 節・7.3 節)
    ok(pg.locator('#exportImg').count() == 0, '「画像…」の選択欄がある')
    svgp = out / 'table.svg'
    svgp.write_text(tsvg)
    n0 = pg.locator('#plans li').count()
    msgs = []
    pg.once('dialog', lambda dl: msgs.append(dl.message))
    pg.set_input_files('#fileOpen', [str(svgp)])
    pg.wait_for_timeout(300)
    ok(pg.locator('#plans li').count() == n0 and any('埋め込まれていません' in m for m in msgs), f'保存した SVG を開いたら一覧が変わった、または知らせがない: {msgs}')
    # plans を書いて読む: 空の一覧に .plans を 1 つ開くと、ファイル名が付き、* は付かない
    pp = out / 'all.plans'
    pp.write_text(pg.evaluate('Team.toPlans(JSON.parse(localStorage.getItem("projalysis.sapp.jp:doc")).files, [])'))
    pg.click('#btnNew')
    pg.set_input_files('#fileOpen', [str(pp)])
    pg.wait_for_function('document.querySelectorAll("#plans li").length === 5')
    ok(pg.inner_text('#fileName') == 'all.plans', f'plans のファイル名: {pg.inner_text("#fileName")!r}')
    # 自動保持: 開き直すと続きが開く
    pg.select_option('#viewKind', 'people')
    pg.reload()
    pg.wait_for_function('document.querySelectorAll("#plans li").length === 5')
    ok(pg.input_value('#viewKind') == 'people', 'ビューが自動保持で戻らない')
    # 印刷のページ
    n = pg.evaluate('(() => { let n = 0; for (const v of Projalysis.VIEWS) n += Projalysis.printPages(Projalysis.sortList(JSON.parse(localStorage.getItem("projalysis.sapp.jp:doc")).files.map((f) => Team.loadPlan(f.name, f.text))), v.id, null).length; return n; })()')
    ok(n >= 5, f'印刷のページ数: {n}')
    # 印刷: ビューをすべてページにする(window.print は呼ぶだけにする)
    pg.evaluate('window.print = () => { window.__printed = document.querySelectorAll("#printArea .page").length; }')
    pg.click('#btnPrint')
    ok(pg.evaluate('window.__printed') >= 5, f'印刷のページ: {pg.evaluate("window.__printed")}')
    ok(not errs, f'ページのエラー: {errs}')

    # 保存: ファイル操作機能のないブラウザの流れ(ダウンロード)。plans を開くと 2 つの一覧を入れ替え、上書きの先にする(仕様書 3.1 節・9.2 節)
    pg2 = ctx.new_page()
    pg2.add_init_script('delete window.showOpenFilePicker; delete window.showSaveFilePicker; if (!sessionStorage.getItem("cleared")) { localStorage.clear(); sessionStorage.setItem("cleared", "1"); }')
    pg2.on('pageerror', lambda e: errs.append(str(e)))
    dmsgs = []
    pg2.on('dialog', lambda dl: (dmsgs.append(dl.message), dl.accept()))
    pg2.goto(url)
    pa = out / 'a.plans'; pb = out / 'b.plans'
    tx = lambda n: json.dumps((d / n).read_text())
    pa.write_text(pg2.evaluate(f'Team.toPlans([{{ name: "v1.plan", text: {tx("v1.plan")} }}], [])'))
    pb.write_text(pg2.evaluate(f'Team.toPlans([{{ name: "v1.plan", text: {tx("v1.plan")} }}, {{ name: "v2.plan", text: {tx("v2.plan")} }}], [{{ name: "a.mylog", text: "by: 甲\\n" }}])'))
    pg2.set_input_files('#fileOpen', [str(pa)])
    pg2.wait_for_function('document.querySelectorAll("#plans li").length === 1')
    ok(pg2.inner_text('#fileName') == 'a.plans', '開いた .plans が上書きの先にならない')
    pg2.set_input_files('#fileOpen', [str(d / 'v3.plan')])
    pg2.wait_for_function('document.querySelectorAll("#plans li").length === 2')
    ok('*' in pg2.inner_text('#fileName'), '.plan を足しても * が付かない')
    with pg2.expect_download() as dl:
        pg2.click('#btnSave')
    ok(dl.value.suggested_filename == 'a.plans', f'上書き保存の名前: {dl.value.suggested_filename}')
    saved = json.loads(pathlib.Path(dl.value.path()).read_text())
    ok([f['name'] for f in saved['files']] == ['v1.plan', 'v3.plan'] and 'logs' not in saved, f'保存した plans: {list(saved)} {[f["name"] for f in saved["files"]]}')
    # 別の plans を開くと、2 つの一覧を入れ替える(マイログも入る)
    pg2.set_input_files('#fileOpen', [str(pb)])
    pg2.wait_for_function('document.querySelectorAll("#plans li").length === 2 && document.querySelectorAll("#logs li").length === 1')
    nm2 = pg2.locator('#plans .iname').all_inner_texts()
    ok(nm2 == ['v1.plan', 'v2.plan'] and pg2.inner_text('#fileName') == 'b.plans', f'plans を開くと 2 つの一覧が入れ替わらない: {nm2} {pg2.inner_text("#fileName")!r}')
    ok(pg2.locator('#dlgMerge').count() == 0, '足した plans の警告のダイアログが残っている')
    # plans を 2 つ同時に開くと、開かずに知らせる
    dmsgs.clear()
    pg2.set_input_files('#fileOpen', [str(pa), str(pb)])
    pg2.wait_for_timeout(300)
    ok(any('plans は 1 つずつ開いてください' in m for m in dmsgs) and pg2.inner_text('#fileName') == 'b.plans', f'plans を 2 つ開いたときの知らせ: {dmsgs}')
    ok(not errs, f'ページのエラー(保存): {errs}')

    # 比べる 2 つの版: 選ぶまでは、版を足すと既定(最初と最後)に従う。選んだ後は残す(仕様書 5.2 節)
    pg3 = ctx.new_page()
    pg3.add_init_script('if (!sessionStorage.getItem("cleared")) { localStorage.clear(); sessionStorage.setItem("cleared", "1"); }')
    pg3.goto(url)
    sel = lambda q: pg3.eval_on_selector(q, 'e => e.options[e.selectedIndex].text')
    pg3.set_input_files('#fileOpen', [str(d / 'v1.plan'), str(d / 'v2.plan')])
    pg3.wait_for_function('document.querySelectorAll("#plans li").length === 2')
    # 比較する版の帯は、2 つの版を比較するビューの上にだけ出る(左下の選択欄はない)
    ok(pg3.locator('#pairsel').count() == 0, '左下の比較する版の選択欄が残っている')
    for v, shown in [('overview', False), ('history', False), ('trend', False), ('tasks', True), ('sched', True), ('fbs', True), ('people', True), ('gantt', True)]:
        pg3.select_option('#viewKind', v)
        ok(pg3.locator('#pairbar').is_visible() == shown, f'{v} のビューで比較する版の帯の出方が違う')
    pg3.select_option('#viewKind', 'tasks')
    pg3.set_input_files('#fileOpen', [str(d / 'v3.plan')])
    pg3.wait_for_function('document.querySelectorAll("#plans li").length === 3')
    ok(sel('#selB').startswith('2026-05-01 版 (2)(v3.plan)'), f'版を足した後の既定の後の版: {sel("#selB")}')
    pg3.select_option('#selB', label=[o for o in pg3.eval_on_selector('#selB', 'e => [...e.options].map((o) => o.text)') if 'v2.plan' in o][0])
    v4 = out / 'v4.plan'
    v4.write_text((d / 'v3.plan').read_text().replace('version: 2026-05-01', 'version: 2026-05-09'))
    pg3.set_input_files('#fileOpen', [str(v4)])
    pg3.wait_for_function('document.querySelectorAll("#plans li").length === 4')
    ok('v2.plan' in sel('#selB'), f'選んだ版が、版を足した後に変わった: {sel("#selB")}')
    pg3.reload()
    pg3.wait_for_function('document.querySelectorAll("#plans li").length === 4')
    ok('v2.plan' in sel('#selB'), f'選んだ版が、開き直した後に変わった: {sel("#selB")}')
    pg3.locator('#plans li', has_text='v2.plan').locator('button', has_text='外す').click()
    ok('v4.plan' in sel('#selB'), f'選んだ版を外した後に既定に戻らない: {sel("#selB")}')
    ok(not errs, f'ページのエラー(2 つの版): {errs}')
    # ---- レビューの指摘を直した所(v0.25)
    pg3.on('dialog', lambda dl: dl.accept())  # 「新規」で空にしてよいかの確認に答える
    # 1-2 「コピー」を続けて押しても、2 秒後に元の文に戻る
    pg3.select_option('#viewKind', 'history')
    cb = pg3.locator('#canvas [data-piece$="|copy"]').first
    cb.click(); pg3.wait_for_timeout(300); cb.click()
    pg3.wait_for_timeout(2400)
    ok(cb.inner_text() == 'コピー', f'続けて押した後にコピーの文が戻らない: {cb.inner_text()!r}')
    # 1-15 比べられる版が 2 つ未満のときは、比較する版の帯を出さない
    pg3.click('#btnNew')
    pg3.set_input_files('#fileOpen', [str(d / 'v1.plan'), str(d / 'err.plan')])
    pg3.wait_for_function('document.querySelectorAll("#plans li").length === 2')
    pg3.select_option('#viewKind', 'tasks')
    ok(not pg3.locator('#pairbar').is_visible(), '比べられる版が 1 つなのに比較する版の帯が出る')
    # 1-9 画像のファイル名の元の名前も、使えない文字と空白を「_」にする
    odd = out / 'チーム A;版.plan'
    odd.write_text((d / 'v1.plan').read_text())
    pg3.click('#btnNew')
    pg3.set_input_files('#fileOpen', [str(odd), str(d / 'v3.plan')])
    pg3.wait_for_function('document.querySelectorAll("#plans li").length === 2')
    pg3.select_option('#viewKind', 'tasks')
    with pg3.expect_download() as dl:
        pg3.click('#canvas [data-piece="table:追加したタスク|svg"]')
    ok(dl.value.suggested_filename == 'チーム_A;版_tasks_追加したタスク.svg', f'元の名前の置き換え: {dl.value.suggested_filename}')
    # 1-8 自動保持から戻した一覧は日付の順に並べ直す(同じ日付の中は保持した順)。選んだ組は変更前が前になる
    docs = {'files': [{'name': n, 'text': (d / n).read_text()} for n in ['v3.plan', 'v2.plan', 'v1.plan']], 'name': '', 'dirty': True, 'pair': [2, 0], 'pairUser': True, 'view': 'tasks', 'mergeWarn': False, 'mergeNames': []}
    pg3.evaluate('(t) => localStorage.setItem("projalysis.sapp.jp:doc", t)', json.dumps(docs, ensure_ascii=False))
    pg3.reload()
    pg3.wait_for_function('document.querySelectorAll("#plans li").length === 3')
    nm3 = pg3.locator('#plans .iname').all_inner_texts()
    ok(nm3 == ['v1.plan', 'v3.plan', 'v2.plan'], f'戻した一覧の並び: {nm3}')
    ok('v1.plan' in sel('#selA') and 'v3.plan' in sel('#selB'), f'戻した組: {sel("#selA")} / {sel("#selB")}')
    # 1-15 localStorage が使えないブラウザでも、一覧が空なら警告を出さない
    pg5 = ctx.new_page()
    pg5.add_init_script('Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } });')
    pg5.goto(url)
    pg5.wait_for_timeout(300)
    ok(pg5.inner_text('#warn') == '', f'空の一覧で保持の警告が出る: {pg5.inner_text("#warn")!r}')
    pg5.set_input_files('#fileOpen', [str(d / 'v1.plan')])
    pg5.wait_for_function('document.querySelectorAll("#plans li").length === 1')
    ok('保持できませんでした' in pg5.inner_text('#warn'), '一覧があるのに保持の警告が出ない')
    ok(not errs, f'ページのエラー(指摘の修正): {errs}')
    # ---- 帯のプリセットのボタン「初版 → 最新版」「前の版 → 最新版」(仕様書 6 章)
    pg3.click('#btnNew')
    pg3.set_input_files('#fileOpen', [str(d / 'v1.plan'), str(d / 'v2.plan'), str(d / 'v3.plan'), str(d / 'err.plan')])
    pg3.wait_for_function('document.querySelectorAll("#plans li").length === 4')
    pg3.select_option('#viewKind', 'tasks')
    ok(pg3.locator('#pairbar #btnFirstLast').inner_text() == '初版 → 最新版' and pg3.locator('#pairbar #btnPrevLast').inner_text() == '前の版 → 最新版', 'ボタンの名前')
    pg3.click('#btnPrevLast')
    ok('v2.plan' in sel('#selA') and 'v3.plan' in sel('#selB'), f'前の版 → 最新版(エラーの版は数えない): {sel("#selA")} / {sel("#selB")}')
    v5 = out / 'v5.plan'
    v5.write_text((d / 'v3.plan').read_text().replace('version: 2026-05-01', 'version: 2026-05-10'))
    pg3.set_input_files('#fileOpen', [str(v5)])
    pg3.wait_for_function('document.querySelectorAll("#plans li").length === 5')
    ok('v2.plan' in sel('#selA') and 'v3.plan' in sel('#selB'), f'前の版 → 最新版は、版を足しても変わらない: {sel("#selA")} / {sel("#selB")}')
    pg3.click('#btnFirstLast')
    ok('v1.plan' in sel('#selA') and 'v5.plan' in sel('#selB'), f'初版 → 最新版: {sel("#selA")} / {sel("#selB")}')
    v6 = out / 'v6.plan'
    v6.write_text((d / 'v3.plan').read_text().replace('version: 2026-05-01', 'version: 2026-05-11'))
    pg3.set_input_files('#fileOpen', [str(v6)])
    pg3.wait_for_function('document.querySelectorAll("#plans li").length === 6')
    ok('v1.plan' in sel('#selA') and 'v6.plan' in sel('#selB'), f'初版 → 最新版は、版を足すと最新版に合わせて変わる: {sel("#selA")} / {sel("#selB")}')
    ok(not errs, f'ページのエラー(帯のボタン): {errs}')
    # ---- 図・表の「PDF」: その 1 つだけを、同じ大きさの紙で印刷する(仕様書 7.4 節)
    import re, subprocess
    pg3.evaluate('window.print = () => { window.__t = document.title; }')
    pg3.select_option('#viewKind', 'gantt')
    for sel, name in [('[data-piece="fig:gantt|pdf"]', 'gantt'), ('[data-piece="fig:gantt-people|pdf"]', 'gantt-people')]:
        pg3.click('#canvas ' + sel)
        w, h = pg3.evaluate('(() => { const s = document.querySelector("#printArea svg"); return [+s.getAttribute("width"), +s.getAttribute("height")]; })()')
        ok(pg3.locator('#printArea .page').count() == 1 and pg3.evaluate('window.__t').endswith(f'_gantt_{name}'), f'PDF の印刷の領域かファイル名の候補が違う: {pg3.evaluate("window.__t")}')
        pg3.emulate_media(media='print')
        pf = out / f'one_{name}.pdf'
        pg3.pdf(path=str(pf), prefer_css_page_size=True, print_background=True)
        pg3.emulate_media(media='screen')
        info = subprocess.run(['pdfinfo', str(pf)], capture_output=True, text=True).stdout
        pages = int(re.search(r'Pages:\s+(\d+)', info).group(1)); pw, ph = map(float, re.search(r'Page size:\s+([\d.]+) x ([\d.]+)', info).groups())
        ok(pages == 1 and abs(pw - w * 0.75) < 1 and abs(ph - h * 0.75) < 1, f'{name} の PDF: {pages} ページ {pw}x{ph} pt(期待 {w * 0.75}x{h * 0.75})')
        pg3.evaluate('window.dispatchEvent(new Event("afterprint"))')
    ok(pg3.evaluate('document.getElementById("pageOne").textContent') == '' and not pg3.evaluate('document.getElementById("printArea").classList.contains("one")'), '印刷の後に紙の大きさの指定が残る')
    # 保存した SVG には紙の大きさの指定が入り、ブラウザで開いて印刷しても同じ大きさになる
    with pg3.expect_download() as dl:
        pg3.click('#canvas [data-piece="fig:gantt|svg"]')
    sp = out / 'gantt_page.svg'; dl.value.save_as(sp)
    st = re.search(r'<style>@page\{size:([\d.]+)px ([\d.]+)px;margin:0\}</style>', sp.read_text())
    ok(st is not None, '保存した SVG に紙の大きさの指定がない')
    p6 = ctx.new_page(); p6.goto(sp.as_uri()); p6.pdf(path=str(out / 'svgfile.pdf'), prefer_css_page_size=True); p6.close()
    info = subprocess.run(['pdfinfo', str(out / 'svgfile.pdf')], capture_output=True, text=True).stdout
    ok(st and re.search(r'Pages:\s+1\b', info) and abs(float(re.search(r'Page size:\s+([\d.]+)', info).group(1)) - float(st.group(1)) * 0.75) < 1, f'保存した SVG を開いて印刷した PDF: {info[-200:]}')
    ok(not errs, f'ページのエラー(PDF): {errs}')
    # ---- v0.31: 印刷の領域の id、全体の印刷の前の後始末、ボタンの折り返し
    hh = lambda v, off: f'version: {v}\nstart: 2026-05-01\noff: {off}\nmembers:\n- 甲\nWBS: 計画\n- 設計\n  - 画面 days: 4 by: 甲\n'
    (out / 'h1.plan').write_text(hh('2026-05-01', '2026-05-04')); (out / 'h2.plan').write_text(hh('2026-05-02', '2026-05-05'))
    pg3.click('#btnNew')
    pg3.set_input_files('#fileOpen', [str(out / 'h1.plan'), str(out / 'h2.plan')])
    pg3.wait_for_function('document.querySelectorAll("#plans li").length === 2')
    pg3.select_option('#viewKind', 'gantt')
    chk = '''() => { const ids = (sel) => [...document.querySelectorAll(sel + ' [id]')].map((e) => e.id);
      const c = new Set(ids('#canvas')), p = ids('#printArea');
      const refs = [...document.querySelector('#printArea').innerHTML.matchAll(/="url\\(#([^)"]+)\\)"/g)].map((m) => m[1]);  // 属性の参照だけを数える(文の中の url(#…) は数えない)
      return { n: p.length, clash: p.filter((x) => c.has(x)).length, refs: refs.length, bad: refs.filter((x) => !p.includes(x)).length }; }'''
    pg3.click('#canvas [data-piece="fig:gantt|pdf"]')
    r = pg3.evaluate(chk)
    ok(r['n'] > 0 and r['refs'] > 0 and r['clash'] == 0 and r['bad'] == 0, f'PDF の印刷の領域の id が画面の図と重なる、または参照先が印刷の領域にない: {r}')
    # afterprint が来ないまま全体の印刷をしても、1 つだけの印刷の指定が残らない
    pg3.evaluate('window.print = () => {}')
    pg3.click('#btnPrint')
    r2 = pg3.evaluate(chk)
    ok(not pg3.evaluate('document.getElementById("printArea").classList.contains("one")') and pg3.evaluate('document.getElementById("pageOne").textContent') == '' and r2['clash'] == 0 and r2['bad'] == 0, f'全体の印刷の前に後始末がされない、または id が重なる: {r2}')
    ws = pg3.evaluate('getComputedStyle(document.querySelector("#canvas .tbtns")).whiteSpace + "/" + getComputedStyle(document.querySelector("#canvas .tbtns button")).flexShrink')
    ok(ws == 'nowrap/0', f'ボタンの折り返しの禁止がない: {ws}')
    ok(not errs, f'ページのエラー(v0.31): {errs}')
    # ---- v0.32: 印刷の領域で、文の中に書いた url(#…) は書き換えない
    hu = lambda v, off: f'version: {v}\nstart: 2026-05-01\noff: {off}\nmembers:\n- 甲\nWBS: 計画\n- 設計\n  - url(#offA)画面 days: 4 by: 甲\n'
    (out / 'u1.plan').write_text(hu('2026-05-01', '2026-05-04')); (out / 'u2.plan').write_text(hu('2026-05-02', '2026-05-05'))
    pg3.click('#btnNew')
    pg3.set_input_files('#fileOpen', [str(out / 'u1.plan'), str(out / 'u2.plan')])
    pg3.wait_for_function('document.querySelectorAll("#plans li").length === 2')
    pg3.select_option('#viewKind', 'gantt')
    pg3.evaluate('window.print = () => {}')
    pg3.click('#canvas [data-piece="fig:gantt|pdf"]')
    txt = pg3.evaluate('document.getElementById("printArea").textContent')
    r = pg3.evaluate(chk)
    ok('url(#offA)画面' in txt and 'url(#offA-' not in txt and r['clash'] == 0 and r['bad'] == 0, f'印刷の領域で文の中の url(#…) が書き換わる、または参照が壊れた: {r} {txt[:80]!r}')
    pg3.click('#btnPrint')
    txt = pg3.evaluate('document.getElementById("printArea").textContent')
    r = pg3.evaluate(chk)
    ok('url(#offA)画面' in txt and 'url(#offA-' not in txt and r['clash'] == 0 and r['bad'] == 0, f'全体の印刷で文の中の url(#…) が書き換わる、または参照が壊れた: {r}')
    ok(not errs, f'ページのエラー(v0.32): {errs}')
    # ================= 後半: 作業分析(旧チームログの画面の検査) =================
    import datetime
    today = datetime.date.today().isoformat()
    tmpw = pathlib.Path(tempfile.mkdtemp())
    def put(name, text):
        f = tmpw / name; f.write_text(text, encoding='utf-8'); return str(f)
    pw = ctx.new_page()
    pw.set_viewport_size({'width': 1400, 'height': 900})
    pw.add_init_script('window.showSaveFilePicker = undefined; window.showOpenFilePicker = undefined; if (!sessionStorage.getItem("cleared")) { localStorage.clear(); sessionStorage.setItem("cleared", "1"); }')
    pw.on('pageerror', lambda e: errs.append(str(e)))
    msgs = []
    pw.on('dialog', lambda dl: (msgs.append(dl.message), dl.accept()))
    pw.goto(url); pw.wait_for_timeout(300)
    ok('計画書(.plan)とマイログ(.mylog)を置くか、plans(.plans)を開いてください' in pw.inner_text('#canvas'), '一覧が空のときは、置くファイルを示す')
    ok(pw.input_value('#baseDate') == today, '基準日の既定は今日')
    groups = pw.eval_on_selector('#viewKind', 'e => [...e.children].map((c) => c.tagName === "OPTGROUP" ? c.label : c.textContent)')
    ok(groups == ['サマリー', '計画書分析'], f'マイログがないときは作業分析のまとまりを出さない: {groups}')
    # 例を読み込む: 計画書 2 版とマイログ 3 つ。反映候補があるので、反映候補で開く(仕様書 8.3 節)
    pw.click('#btnSample'); pw.wait_for_timeout(500)
    ok(pw.locator('#logs li').count() == 3 and pw.locator('#plans li').count() == 2, '例: マイログ 3 つと計画書 2 版')
    groups = pw.eval_on_selector('#viewKind', 'e => [...e.children].map((c) => c.tagName === "OPTGROUP" ? `${c.label}:${c.children.length}` : c.textContent)')
    ok(groups == ['サマリー', '作業分析:12', '計画書分析:7'], f'選択欄: サマリー、作業分析、計画書分析の順: {groups}')
    ok(pw.input_value('#viewKind') == 'reflect', f'例を読み込むと反映候補で開く: {pw.input_value("#viewKind")}')
    ok(pw.inner_text('#fileName') == 'sample.plans', '例のファイル名は sample.plans')
    for v in [o.get_attribute('value') for o in pw.locator('#viewKind option').all()]:
        pw.select_option('#viewKind', v); pw.wait_for_timeout(120)
        t = pw.inner_text('#canvas')
        ok(pw.locator('#canvas svg').count() == 1 and 'NaN' not in t and 'undefined' not in t, f'ビュー {v} が描ける')
        work = v in ['reflect', 'alerts', 'week', 'requests', 'load', 'progress', 'impact', 'hoursPeople', 'hoursTasks', 'trl', 'tests', 'mop']
        ok(pw.locator('#bar').is_visible() == (work or v == 'overview'), f'{v}: 基準日の欄は作業分析とサマリーだけ')
        ok(pw.locator('#pairbar').is_visible() == (v in ['tasks', 'sched', 'fbs', 'people', 'gantt']), f'{v}: 比較する版の帯は 2 つの版を比べるビューだけ')
    pw.select_option('#viewKind', 'overview'); pw.wait_for_timeout(150)
    t = pw.inner_text('#canvas')
    ok('作業の概要' in t and '計画への反映候補' in t and '5 件(進捗の変更 4、MOP のチェック 1)' in t and f'基準日 {today}' in t, 'サマリーに作業の概要が出る')
    pw.select_option('#viewKind', 'alerts'); pw.wait_for_timeout(150)
    t = pw.inner_text('#canvas')
    ok(f'基準日 {today}' in t and 'S3 返事待ち' in t and 'S4 日数の超過' in t, '例: 要確認に S3・S4 が出る')
    # 表の行を押すと、マイログのファイル名と行を出す。何もないところで閉じる
    pw.locator('#canvas [data-file]').first.click(); pw.wait_for_timeout(100)
    info = pw.inner_text('#info')
    ok(pw.locator('#info.on').count() == 1 and '.mylog の ' in info and 'review: 井上' in info, f'表の行を押すと、マイログのファイル名・行・行の文を出す({info[:40]!r})')
    box = pw.locator('#canvas svg').bounding_box()
    pw.mouse.click(box['x'] + 600, box['y'] + 5); pw.wait_for_timeout(100)
    ok(pw.locator('#info.on').count() == 0, '何もないところを押すと閉じる')
    # 週のまとめ
    ok(not pw.locator('#weekLab').is_visible(), '週の欄は週のまとめのときだけ')
    pw.select_option('#viewKind', 'week'); pw.wait_for_timeout(150)
    opts = pw.locator('#weekSel option').all_inner_texts()
    ok(pw.locator('#weekLab').is_visible() and len(opts) == 2 and '(基準日の週)' in opts[0], f'週の選択肢({opts})')
    pw.select_option('#weekSel', index=1); pw.wait_for_timeout(150)
    ok('この週に完了したタスク' in pw.inner_text('#canvas') and 'カレンダデザイン' in pw.inner_text('#canvas'), '前の週を選ぶと、その週に完了したタスクが出る')
    # 基準日を変える
    d0 = (datetime.date.today() - datetime.timedelta(days=3)).isoformat()
    pw.fill('#baseDate', d0); pw.dispatch_event('#baseDate', 'change'); pw.wait_for_timeout(200)
    pw.select_option('#viewKind', 'hoursPeople'); pw.wait_for_timeout(150)
    ok(f'基準日 {d0}' in pw.inner_text('#canvas') and f'({d0} まで)' in pw.inner_text('#canvas'), '基準日を変えると、その日までで集計する')
    pw.click('#btnToday'); pw.wait_for_timeout(150)
    ok(pw.input_value('#baseDate') == today, '「今日」で基準日を今日に戻す')
    # 表の画像の名前(元の名前_ビューの識別子_表の題。3 つのアプリで同じ)
    with pw.expect_download() as dl:
        pw.locator('#canvas .tbtns button', has_text='SVG').first.click()
    ok(dl.value.suggested_filename.startswith('sample_hoursPeople_作業時間(人×週)'), f'表の画像の名前({dl.value.suggested_filename})')
    # 別名で保存(ダウンロード)→ 新規 → 開く で、2 つの一覧が戻り、反映候補で開く
    pw.evaluate("window.prompt = (m, v) => v")
    with pw.expect_download() as dl:
        pw.click('#btnSaveAs')
    saved = open(dl.value.path(), encoding='utf-8').read()
    dj = json.loads(saved)
    ok(dl.value.suggested_filename == 'sample.plans' and dj['format'] == 'projalysis-plans' and list(dj) == ['format', 'files', 'logs'] and len(dj['files']) == 2 and len(dj['logs']) == 3 and saved.endswith('}\n'), '別名で保存: plans(files と logs)')
    ok(pw.inner_text('#fileName') == 'sample.plans', '保存すると * が消える')
    pw.click('#btnNew'); pw.wait_for_timeout(200)
    ok(pw.locator('#logs li').count() == 0 and pw.locator('#plans li').count() == 0 and pw.input_value('#viewKind') == 'overview', '新規で 2 つの一覧を空にし、作業分析のビューから概要に移る')
    pw.set_input_files('#fileOpen', put('x.plans', saved)); pw.wait_for_timeout(500)
    ok(pw.locator('#logs li').count() == 3 and pw.locator('#plans li').count() == 2 and pw.inner_text('#fileName') == 'x.plans' and pw.input_value('#viewKind') == 'reflect', 'plans を開くと、2 つの一覧が戻り、反映候補で開く')
    # ファイルを足しても、ビューは変えない
    pw.select_option('#viewKind', 'load'); pw.wait_for_timeout(100)
    # 同じ by: のマイログを足す: 置き換える・両方残す
    aoki = dj['logs'][0]['text']
    pw.set_input_files('#fileAdd', put('青木2.mylog', aoki + '\n- ' + today + '\n  - 通知用APIの実装 note: 追記\n')); pw.wait_for_timeout(300)
    ok(pw.locator('#dlgAsk[open]').count() == 1 and '青木のマイログがすでにあります' in pw.inner_text('#dlgAsk'), '同じ by: のマイログを足すと尋ねる')
    pw.click('#dlgAsk button[data-k="replace"]'); pw.wait_for_timeout(300)
    ok(pw.locator('#logs li').count() == 3 and '青木2.mylog' in pw.inner_text('#logs') and pw.inner_text('#fileName') == 'x.plans *', '置き換えると、同じ位置で入れ替わり、保存していない変更になる')
    ok(pw.input_value('#viewKind') == 'load', 'マイログを足しても、表示中のビューのまま')
    pw.set_input_files('#fileAdd', put('青木3.mylog', aoki)); pw.wait_for_timeout(300)
    pw.click('#dlgAsk button[data-k="both"]'); pw.wait_for_timeout(300)
    pw.select_option('#viewKind', 'alerts'); pw.wait_for_timeout(150)
    ok(pw.locator('#logs li').count() == 4 and '同じ人(青木)のマイログが 2 つあります' in pw.inner_text('#canvas'), '両方残すと、要確認の先頭に知らせる')
    pw.set_input_files('#fileAdd', put('青木4.mylog', aoki)); pw.wait_for_timeout(300)
    ok('同じ内容のため追加しませんでした: 青木4.mylog(青木3.mylog と同じ)' in pw.inner_text('#logs'), '同じテキストは足さない')
    pw.click('#logs .head'); pw.wait_for_timeout(100)
    ok(not pw.locator('#logs .note').is_visible() and not pw.locator('#logs ul').is_visible(), 'マイログの一覧を畳むと、項目と知らせを隠す')
    pw.click('#logs .head'); pw.wait_for_timeout(100)
    ok(pw.locator('#logs li .lab').first.inner_text() == '青木', 'マイログの項目の 1 行目は by: の名前')
    pw.set_input_files('#fileAdd', put('err.mylog', 'by: 誰か\n# 見出し\n')); pw.wait_for_timeout(300)
    ok('エラー 1 件' in pw.inner_text('#logs') and 'エラーのため集計から除外: err.mylog' in pw.inner_text('#canvas'), 'エラーのあるマイログは一覧に並べ、集計から外して知らせる')
    pw.locator('#logs li', has_text='err.mylog').locator('.err').click(); pw.wait_for_timeout(100)
    ok(pw.locator('#dlgDiag[open]').count() == 1 and '見出し' in pw.inner_text('#dlgDiag'), 'エラーを押すと診断の一覧を出す')
    pw.keyboard.press('Escape')
    # 開けないファイル・読めない plans
    msgs.clear()
    pw.set_input_files('#fileAdd', [put('y.doc', 'x')]); pw.wait_for_timeout(300)
    ok(msgs and 'y.doc は開けません' in msgs[-1], f'開けないファイルを置いたら知らせる({msgs[-1:]})')
    pw.set_input_files('#fileAdd', put('bad.plans', '{"format":"x"}')); pw.wait_for_timeout(300)
    ok('bad.plans を読めませんでした' in pw.inner_text('#warn') and pw.locator('#logs li').count() == 5, '読めない plans は上の帯に知らせ、一覧は変えない')
    # 自動保持: 開き直すと続き(基準日は今日に戻る)
    pw.fill('#baseDate', d0); pw.dispatch_event('#baseDate', 'change'); pw.wait_for_timeout(100)
    pw.reload(); pw.wait_for_timeout(500)
    ok(pw.locator('#logs li').count() == 5 and pw.input_value('#baseDate') == today and pw.input_value('#viewKind') == 'alerts', '開き直すと一覧とビューが戻り、基準日は今日に戻る')
    # 印刷: 概要と計画書分析は横向き、作業分析は縦向き
    n = pw.evaluate("(() => { window.print = () => {}; document.querySelector('#btnPrint').click(); return [document.querySelectorAll('#printArea .page').length, document.querySelectorAll('#printArea .page.land').length]; })()")
    ok(n[0] >= 20 and 0 < n[1] < n[0], f'印刷のページ(全体・横向き): {n}')
    # 一覧を変えたら、行の情報と選んだ印を閉じる。新規で読み込みの知らせを消す
    pw.select_option('#viewKind', 'alerts'); pw.wait_for_timeout(150)
    pw.locator('#canvas [data-file]').first.click(); pw.wait_for_timeout(100)
    ok(pw.locator('#info.on').count() == 1, '行を押すと情報を出す(一覧を変える前)')
    pw.locator('#logs li').first.locator('button', has_text='外す').click(); pw.wait_for_timeout(300)
    ok(pw.locator('#info.on').count() == 0 and pw.locator('#canvas .selected').count() == 0, '一覧を変えたら、行の情報と選んだ印を閉じる')
    pw.set_input_files('#fileAdd', put('bad2.plans', '{"format":"x"}')); pw.wait_for_timeout(300)
    pw.click('#btnNew'); pw.wait_for_timeout(200)
    ok(pw.inner_text('#warn').strip() == '', '新規で、読み込みの知らせを消す')
    pw.set_input_files('#fileAdd', put('bad3.plans', '{"format":"x"}')); pw.wait_for_timeout(300)
    pw.click('#btnSample'); pw.wait_for_timeout(500)
    ok(pw.inner_text('#warn').strip() == '', '例を読み込むと、読み込みの知らせを消す')
    # 週を選んだ後にマイログがなくなったら、選んだ週を捨てる。作業分析のビューにいたら概要に移る
    pw.select_option('#viewKind', 'week'); pw.wait_for_timeout(150)
    pw.select_option('#weekSel', index=1); pw.wait_for_timeout(150)
    for _ in range(3):
        pw.locator('#logs li').first.locator('button', has_text='外す').click(); pw.wait_for_timeout(200)
    ok(not pw.locator('#weekLab').is_visible() and pw.input_value('#viewKind') == 'overview' and not pw.locator('#bar').is_visible(), 'マイログがなくなったら、週の欄と基準日の欄を隠し、概要に移る')
    ok('作業の概要' not in pw.inner_text('#canvas'), 'マイログがなければ、概要は版の概要だけ')
    pw.set_input_files('#fileAdd', put('青木5.mylog', aoki)); pw.wait_for_timeout(300)
    pw.select_option('#viewKind', 'week'); pw.wait_for_timeout(150)
    ok(pw.locator('#weekLab').is_visible() and pw.input_value('#weekSel') == '', 'マイログがなくなったら選んだ週を捨てる(足し直すと基準日の週)')
    # 空の一覧から足したときは、ビューを選び直す(仕様書 8.3 節)
    pw.click('#btnNew'); pw.wait_for_timeout(200)
    pw.set_input_files('#fileAdd', [put('s_old.plan', (d / 'sample_old.plan').read_text()), put('s.plan', (d / 'sample.plan').read_text()), put('青木.mylog', (d / 'sample_aoki.mylog').read_text())]); pw.wait_for_timeout(500)
    ok(pw.input_value('#viewKind') in ('reflect', 'alerts'), f'空の一覧から足すと、ビューを選び直す: {pw.input_value("#viewKind")}')
    # ---- 夜のバグ探しで見つかった誤りの検査(版 0.40)
    # 印刷の向きの並び: 概要(横)→ 作業分析(縦)→ 計画書分析(横)
    pw.click('#btnSample'); pw.wait_for_timeout(500)
    lands = pw.evaluate("(() => { window.print = () => {}; document.querySelector('#btnPrint').click(); return [...document.querySelectorAll('#printArea .page')].map((x) => x.classList.contains('land')); })()")
    runs = []
    for x in lands:
        if not runs or runs[-1][0] != x: runs.append([x, 0])
        runs[-1][1] += 1
    ok([r[0] for r in runs] == [True, False, True] and runs[1][1] >= 12, f'印刷の向きの並びは、概要が横・作業分析が縦・計画書分析が横: {runs}')
    # 概要: マイログのないメンバーの数を添える(7.2 節)
    pw.locator('#logs li').first.locator('button', has_text='外す').click(); pw.wait_for_timeout(300)
    pw.select_option('#viewKind', 'overview'); pw.wait_for_timeout(150)
    ok('2 人(マイログのないメンバー 1 人)' in pw.inner_text('#canvas'), '概要: マイログのないメンバーの数を添える')
    # マイログだけ・版が 1 つ・エラーの版だけのときも、全ビューと印刷が描ける
    def all_views(label):
        bad = []
        for v in [o.get_attribute('value') for o in pw.locator('#viewKind option').all()]:
            pw.select_option('#viewKind', v); pw.wait_for_timeout(80)
            t = pw.inner_text('#canvas')
            if pw.locator('#canvas svg').count() != 1 or 'NaN' in t or 'undefined' in t: bad.append(v)
        n = pw.evaluate("(() => { window.print = () => {}; document.querySelector('#btnPrint').click(); return document.querySelectorAll('#printArea .page').length; })()")
        ok(not bad and n >= 1, f'{label}: 全ビューと印刷が描ける(描けないビュー {bad}、印刷 {n} ページ)')
    aoki_t = (d / 'sample_aoki.mylog').read_text()
    for label, fs in [('マイログだけ', [('青木.mylog', aoki_t)]), ('版が 1 つ', [('s.plan', (d / 'sample.plan').read_text()), ('青木.mylog', aoki_t)]), ('エラーの版だけ', [('e.plan', (d / 'err.plan').read_text()), ('青木.mylog', aoki_t)])]:
        pw.click('#btnNew'); pw.wait_for_timeout(200)
        pw.set_input_files('#fileAdd', [put(n_, t_) for n_, t_ in fs]); pw.wait_for_timeout(400)
        all_views(label)
    # プロジェクト計画の版 0.30 までの SVG(.plan を埋め込んだもの)を、1 つの版として読む(3.1 節)
    pw.click('#btnNew'); pw.wait_for_timeout(200)
    emb = pw.evaluate("(t) => Plan.embedSource('<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>', t)", (d / 'sample.plan').read_text())
    pw.set_input_files('#fileAdd', put('team_gantt.svg', emb)); pw.wait_for_timeout(300)
    ok(pw.locator('#plans li').count() == 1 and 'team_gantt.plan' in pw.inner_text('#plans'), f'プロジェクト計画の SVG を 1 つの版として読む({pw.inner_text("#plans")[:60]!r})')
    pw.click('#btnSample'); pw.wait_for_timeout(500)
    # 基準日を過去にしても、マイログの一覧の診断は変わらない(マイログの解析は本当の今日で行う)
    logs0 = pw.inner_text('#logs')
    d9 = (datetime.date.today() - datetime.timedelta(days=9)).isoformat()
    pw.fill('#baseDate', d9); pw.dispatch_event('#baseDate', 'change'); pw.wait_for_timeout(300)
    ok(pw.inner_text('#logs') == logs0, '基準日を過去にしても、マイログの一覧の警告は変わらない')
    pw.click('#btnToday'); pw.wait_for_timeout(150)
    # 知らせだけがあるとき(反映候補も兆候もない)は、要確認で開く
    only = json.dumps({'format': 'projalysis-plans', 'files': [{'name': 'n.plan', 'text': f'version: {today}\nstart: {today}\nmembers:\n- 青木\nWBS: r\n- t days: 1 by: 青木 status: done'}], 'logs': [{'name': '青木.mylog', 'text': 'by: 青木\n# 見出し\n'}]})
    pw.set_input_files('#fileOpen', put('notes.plans', only)); pw.wait_for_timeout(400)
    ok(pw.input_value('#viewKind') == 'alerts' and 'エラーのため集計から除外' in pw.inner_text('#canvas'), f'知らせだけがあるときは要確認で開く: {pw.input_value("#viewKind")}')
    # 保存の競合: ファイル操作機能の書き込みを遅らせる偽物で確かめる
    # 自動保持を作業分析の検査のタブと分けるため、別の文脈で開く(同じ文脈だと「別のタブで一覧が変わりました」が出る)
    zctx = b.new_context(viewport={'width': 1400, 'height': 900})
    pz = zctx.new_page()
    pz.add_init_script("""if (!sessionStorage.getItem("cleared")) { localStorage.clear(); sessionStorage.setItem("cleared", "1"); }
      window.__w = []; window.__rel = []; window.__next = 'a.plans';
      const mk = (name) => ({ name, kind: 'file', createWritable: async () => ({ write: async (t) => { window.__w.push(name); }, close: () => new Promise((r) => window.__rel.push(r)) }) });
      window.showSaveFilePicker = async () => mk(window.__next);
      window.showOpenFilePicker = async () => { throw new DOMException('x', 'AbortError'); };""")
    pz.on('pageerror', lambda e: errs.append(str(e)))
    zmsgs = []
    pz_dialog = lambda dl: (zmsgs.append(dl.message), dl.accept())
    pz.on('dialog', pz_dialog)
    pz.goto(url); pz.wait_for_timeout(300)
    rel = lambda: (pz.evaluate("window.__rel.splice(0).forEach((r) => r())"), pz.wait_for_timeout(200))
    pz.click('#btnSample'); pz.wait_for_timeout(500)
    pz.click('#btnSaveAs'); pz.wait_for_timeout(200)
    ok(pz.locator('#btnSave').is_disabled() and pz.locator('#btnSaveAs').is_disabled(), '書き込みの間は、保存のボタンを押せない')
    pz.focus('body'); pz.keyboard.press('Control+s'); pz.wait_for_timeout(200)
    ok(pz.evaluate('window.__w.length') == 1, f'書き込みの間の Ctrl+S では、もう一度書き込まない({pz.evaluate("window.__w")})')
    pz.set_input_files('#fileAdd', put('s2.plan', f'version: {today}\nstart: {today}\nmembers:\n- 青木\nWBS: r\n- 追加のタスク days: 1 by: 青木')); pz.wait_for_timeout(300)
    rel()
    ok(pz.inner_text('#fileName') == 'a.plans *' and 'まだ保存されていません' in pz.inner_text('#stat'), f'書き込みの間に版を足したら「 *」を残す({pz.inner_text("#fileName")})')
    pz.keyboard.press('Control+s'); pz.wait_for_timeout(200); rel()
    ok(pz.evaluate('window.__w') == ['a.plans', 'a.plans'] and pz.inner_text('#fileName') == 'a.plans', f'Ctrl+S で、保存した先に上書きする({pz.evaluate("window.__w")})')
    # 別名で保存の書き込みの間に別の plans を開くと、名前と上書きの先は開いた plans のまま
    pz.evaluate("window.__next = 'b.plans'")
    pz.click('#btnSaveAs'); pz.wait_for_timeout(200)
    pz.set_input_files('#fileOpen', put('other.plans', only)); pz.wait_for_timeout(400)
    rel()
    ok(pz.inner_text('#fileName') == 'other.plans', f'別名で保存の間に開いた plans の名前のまま({pz.inner_text("#fileName")})')
    pz.evaluate("window.__next = 'c.plans'")
    pz.keyboard.press('Control+s'); pz.wait_for_timeout(200); rel()
    ok(pz.evaluate('window.__w')[-1] == 'c.plans', f'その後の Ctrl+S は、前の保存先(b.plans)に書かない({pz.evaluate("window.__w")})')
    # ドラッグ・アンド・ドロップ: .zip は読まずに知らせもしない。.plans は 2 つの一覧を入れ替える
    def zdrop(files):
        dt = pz.evaluate_handle("(fs) => { const d = new DataTransfer(); for (const [n, t] of fs) d.items.add(new File([t], n)); return d; }", files)
        pz.dispatch_event('body', 'drop', {'dataTransfer': dt}); pz.wait_for_timeout(500)
    zmsgs.clear()
    zdrop([['x.zip', 'PK'], ['dropped.plans', saved]])
    ok(not [m for m in zmsgs if '開けません' in m] and pz.inner_text('#fileName') == 'dropped.plans' and pz.locator('#logs li').count() == 3, f'置いた .zip は無視し、.plans で入れ替える({zmsgs})')
    # 同じ人のマイログを尋ねる間に置いたファイルは、答えの後に、別に尋ねる
    zdrop([['青木6.mylog', aoki + '\n']])
    ok(pz.locator('#dlgAsk[open]').count() == 1, '同じ人のマイログを置くと尋ねる')
    zdrop([['青木7.mylog', aoki + '\n\n']])
    pz.click('#dlgAsk button[data-k="replace"]'); pz.wait_for_timeout(400)
    ok(pz.locator('#dlgAsk[open]').count() == 1 and '青木7.mylog' in pz.inner_text('#dlgAsk'), '尋ねている間に置いたマイログは、答えの後に別に尋ねる')
    pz.click('#dlgAsk button[data-k="both"]'); pz.wait_for_timeout(400)
    ok('青木6.mylog' in pz.inner_text('#logs') and '青木7.mylog' in pz.inner_text('#logs') and pz.locator('#logs li').count() == 4, '1 回目の答え(置き換える)と 2 回目の答え(両方残す)が、それぞれのマイログに当たる')
    # Ctrl+Shift+S では保存しない
    pz.evaluate("window.__next = 'd.plans'")
    n0 = len(pz.evaluate('window.__w'))
    pz.keyboard.press('Control+Shift+s'); pz.wait_for_timeout(200); rel()
    ok(len(pz.evaluate('window.__w')) == n0, 'Ctrl+Shift+S では保存しない')
    # 読めない plans は破棄の確認を出さずに知らせる。入れ替えを取りやめたら、一緒に置いたファイルも足さない
    pz.set_input_files('#fileAdd', put('zz.plan', f'version: {today}\nstart: {today}\nmembers:\n- 青木\nWBS: r\n- 追加 days: 1 by: 青木')); pz.wait_for_timeout(300)
    zmsgs.clear()
    zdrop([['bad.plans', '{"format":"x"}']])
    ok(not [m for m in zmsgs if '破棄' in m] and 'bad.plans を読めませんでした' in pz.inner_text('#warn'), f'読めない plans は破棄の確認を出さない({zmsgs})')
    nlogs = pz.locator('#logs li').count()
    pz.remove_listener('dialog', pz_dialog)
    pz.on('dialog', lambda dl: (zmsgs.append(dl.message), dl.dismiss()))
    zdrop([['dropped2.plans', saved], ['extra.mylog', 'by: 江藤\n']])
    ok(pz.locator('#logs li').count() == nlogs and 'extra.mylog' not in pz.inner_text('#logs'), '入れ替えを取りやめたら、一緒に置いたファイルも足さない')
    zctx.close()
    # ファイル操作機能のないブラウザ: plans を開いた後の上書き保存は、同じ名前でダウンロードする。.txt の計画も読む。規則の値は 0 以上だけを戻す
    nctx = b.new_context(viewport={'width': 1400, 'height': 900}, accept_downloads=True)
    pn = nctx.new_page()
    pn.add_init_script('window.showSaveFilePicker = undefined; window.showOpenFilePicker = undefined;')
    pn.on('pageerror', lambda e: errs.append(str(e)))
    ptypes = []
    pn.on('dialog', lambda dl: (ptypes.append(dl.type), dl.accept()))
    pn.goto(url); pn.wait_for_timeout(300)
    pn.set_input_files('#fileOpen', put('nofs.plans', saved)); pn.wait_for_timeout(400)
    pn.set_input_files('#fileAdd', put('more.txt', f'version: {today}\nstart: {today}\nmembers:\n- 青木\nWBS: r\n- 追加 days: 1 by: 青木')); pn.wait_for_timeout(300)
    ok('more.txt' in pn.inner_text('#plans'), '.txt の計画も計画書の一覧に足す')
    with pn.expect_download() as dl:
        pn.click('#btnSave')
    ok(dl.value.suggested_filename == 'nofs.plans' and pn.inner_text('#fileName') == 'nofs.plans' and 'prompt' not in ptypes, f'ファイル操作機能がなければ、上書き保存は同じ名前でダウンロードする({dl.value.suggested_filename})')
    pn.evaluate("(() => { const k = 'projalysis.sapp.jp:doc'; const d = JSON.parse(localStorage.getItem(k)); d.th = { S2: -3, S1: 9 }; localStorage.setItem(k, JSON.stringify(d)); })()")
    pn.reload(); pn.wait_for_timeout(500)
    pn.select_option('#viewKind', 'alerts'); pn.wait_for_timeout(150)
    ok('S2 7 日' in pn.inner_text('#canvas') and 'S1 9 日' in pn.inner_text('#canvas'), '自動保持から、負の規則の値は戻さない')
    # 比べられる版が 1 つでも、推移と改訂履歴は印刷する
    pn.click('#btnNew'); pn.wait_for_timeout(200)
    pn.set_input_files('#fileAdd', [put('one.plan', (d / 'sample.plan').read_text()), put('青木.mylog', (d / 'sample_aoki.mylog').read_text())]); pn.wait_for_timeout(400)
    txt = pn.evaluate("(() => { window.print = () => {}; document.querySelector('#btnPrint').click(); return document.querySelector('#printArea').textContent; })()")
    ok('改訂履歴' in txt and '推移' in txt, '比べられる版が 1 つでも、推移と改訂履歴を印刷する')
    nctx.close()
    # 帯の幅
    pw.set_viewport_size({'width': 1280, 'height': 800}); pw.wait_for_timeout(100)
    ok(pw.locator('header').bounding_box()['height'] < 50, f'幅 1280px で上の帯が 1 段に収まる({pw.inner_text("header")!r})')
    ok(not errs, f'ページのエラー(作業分析): {errs}')
    b.close()
print('画像:', out)
print('NG' if fail else 'OK', fail)
sys.exit(1 if fail else 0)
