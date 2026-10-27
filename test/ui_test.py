# 画面の検査。Python の playwright と Chromium で動かす(python3 test/ui_test.py)
# 一覧・比べる 2 つの版・ビュー・表のコピーと表・図の画像の保存・plans の保存と読み込み・自動保持を確かめる
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
    ok(pg.locator('#list .item').count() == 0, '最初の一覧が空でない')
    files = [str(d / f) for f in ['v3.plan', 'v1.plan', 'v2.plan', 'err.plan', 'nover.plan']]
    pg.set_input_files('#fileOpen', files)
    pg.wait_for_function('document.querySelectorAll("#list .item").length === 5')
    labs = pg.locator('#list .lab').all_inner_texts()
    names = pg.locator('#list .iname').all_inner_texts()
    ok(labs == ['2026-04-20 版', '2026-05-01 版', '2026-05-01 版 (2)', '2026-05-03 版', 'version: なし'], f'版の名前: {labs}')
    ok(names == ['v1.plan', 'v3.plan', 'v2.plan', 'err.plan', 'nover.plan'], f'並び: {names}')
    ok('*' in pg.inner_text('#fileName'), '足した後に * が付かない')
    # 比べる 2 つの版の既定は、比べられる版の最初と最後
    a = pg.eval_on_selector('#selA', 'e => e.options[e.selectedIndex].text')
    bb = pg.eval_on_selector('#selB', 'e => e.options[e.selectedIndex].text')
    ok(a.startswith('2026-04-20 版') and bb.startswith('2026-05-01 版 (2)'), f'既定の 2 つ: {a} / {bb}')
    # 同じ日付の中の並べ替え: v3 を後ろへ
    pg.locator('#list .item').nth(1).locator('button', has_text='▼').click()
    names = pg.locator('#list .iname').all_inner_texts()
    ok(names[1:3] == ['v2.plan', 'v3.plan'], f'並べ替え: {names}')
    ok(pg.locator('#list .item').nth(0).locator('button', has_text='▼').is_disabled(), '日付をまたいで並べ替えられる')
    # 同じテキストは足さない
    pg.set_input_files('#fileOpen', [str(d / 'v1.plan')])
    pg.wait_for_timeout(200)
    ok(pg.locator('#list .item').count() == 5, '同じ版が足された')
    ok('同じ内容のため追加しませんでした' in pg.inner_text('#stat'), '同じ版の知らせがない')
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
    copies = pg.eval_on_selector_all('#canvas [data-copy]', 'es => es.map((e) => e.dataset.copy)')
    ok(copies == ['タスクの進捗が初めて変わった版'], f'推移のビューでコピーできる表: {copies}')
    figs = pg.eval_on_selector_all('#canvas [data-fig]', 'es => es.map((e) => e.dataset.fig)')
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
    check_align('#canvas [data-fig="status|svg"]', 'タスク数と進捗の推移', '推移の図 D のボタン')
    check_align('#canvas [data-copy]', 'タスクの進捗が初めて変わった版', '表のコピーのボタン')
    with pg.expect_download() as dl:
        pg.click('#canvas [data-fig="status|svg"]')
    ok(dl.value.suggested_filename.endswith('_trend_status.svg'), f'図の SVG の名前: {dl.value.suggested_filename}')
    fsvg = pathlib.Path(dl.value.path()).read_text()
    ok('<metadata' not in fsvg and 'タスク数と進捗の推移' in fsvg and '終了日の推移' not in fsvg and 'コピー' not in fsvg, '図の SVG が図 1 つでない、埋め込みがない、またはボタンが入っている')
    with pg.expect_download() as dl:
        pg.click('#canvas [data-fig="changes|png"]')
    ok(dl.value.suggested_filename.endswith('_trend_changes.png') and pathlib.Path(dl.value.path()).read_bytes()[:4] == b'\x89PNG', f'図の PNG: {dl.value.suggested_filename}')
    pg.select_option('#viewKind', 'gantt')
    check_align('#canvas [data-fig="gantt|svg"]', 'ガントチャートの比較', 'ガントチャート F のボタン(15 px の題)')
    check_align('#canvas [data-copy]', '対応した要素', '対応した要素のコピーのボタン')
    pg.select_option('#viewKind', 'tasks')
    ok(pg.locator('#canvas [data-fig]').count() == 0, '図のないビューに図の保存のボタンがある')
    # 表のコピー
    pg.click('#canvas [data-copy="追加したタスク"]')
    clip = pg.evaluate('navigator.clipboard.readText()')
    ok(clip.split('\n')[0] == 'タスク\t日数\t作成者\t確認者', f'コピーの見出し: {clip[:60]!r}')
    # 表の画像(仕様書 6.2 節): コピー・SVG・PNG が並び、SVG は題を入れない表 1 つだけで、何も埋め込まない
    ok(pg.locator('#canvas [data-copy]').count() == pg.locator('#canvas [data-tbl$="|svg"]').count() == pg.locator('#canvas [data-tbl$="|png"]').count() > 0, '表ごとにコピー・SVG・PNG が並ばない')
    tops = pg.evaluate("""() => ['[data-copy="追加したタスク"]', '[data-tbl="追加したタスク|svg"]', '[data-tbl="追加したタスク|png"]'].map((s) => { const r = document.querySelector('#canvas ' + s).getBoundingClientRect(); return [r.top, r.left]; })""")
    ok(abs(tops[0][0] - tops[1][0]) < 0.5 and abs(tops[0][0] - tops[2][0]) < 0.5 and tops[0][1] < tops[1][1] < tops[2][1], f'表の SVG・PNG のボタンがコピーの右に並ばない: {tops}')
    with pg.expect_download() as dl:
        pg.click('#canvas [data-tbl="追加したタスク|svg"]')
    ok(dl.value.suggested_filename.endswith('_tasks_追加したタスク.svg'), f'表の SVG の名前: {dl.value.suggested_filename}')
    tsvg = pathlib.Path(dl.value.path()).read_text()
    ok(tsvg.count('>タスク</text>') == 1 and '追加したタスク' not in tsvg and '削除したタスク' not in tsvg and '<metadata' not in tsvg and 'コピー' not in tsvg, '表の SVG が題のない表 1 つでない、または埋め込みがある')
    with pg.expect_download() as dl:
        pg.click('#canvas [data-tbl="追加したタスク|png"]')
    ok(dl.value.suggested_filename.endswith('_tasks_追加したタスク.png') and pathlib.Path(dl.value.path()).read_bytes()[:4] == b'\x89PNG', f'表の PNG: {dl.value.suggested_filename}')
    # ビュー全体の画像の保存はない。保存した SVG を開いても一覧は変わらない(仕様書 3.1 節・7.3 節)
    ok(pg.locator('#exportImg').count() == 0, '「画像…」の選択欄がある')
    svgp = out / 'table.svg'
    svgp.write_text(tsvg)
    n0 = pg.locator('#list .item').count()
    msgs = []
    pg.once('dialog', lambda dl: msgs.append(dl.message))
    pg.set_input_files('#fileOpen', [str(svgp)])
    pg.wait_for_timeout(300)
    ok(pg.locator('#list .item').count() == n0 and any('埋め込まれていません' in m for m in msgs), f'保存した SVG を開いたら一覧が変わった、または知らせがない: {msgs}')
    # plans を書いて読む: 空の一覧に .plans を 1 つ開くと、ファイル名が付き、* は付かない
    pp = out / 'all.plans'
    pp.write_text(pg.evaluate('Projalysis.toPlans(Projalysis.sortList(JSON.parse(localStorage.getItem("projalysis.sapp.jp:doc")).files.map((f) => Projalysis.load(f.name, f.text))))'))
    pg.click('#btnNew')
    pg.set_input_files('#fileOpen', [str(pp)])
    pg.wait_for_function('document.querySelectorAll("#list .item").length === 5')
    ok(pg.inner_text('#fileName') == 'all.plans', f'plans のファイル名: {pg.inner_text("#fileName")!r}')
    # 自動保持: 開き直すと続きが開く
    pg.select_option('#viewKind', 'people')
    pg.reload()
    pg.wait_for_function('document.querySelectorAll("#list .item").length === 5')
    ok(pg.input_value('#viewKind') == 'people', 'ビューが自動保持で戻らない')
    # 印刷のページ
    n = pg.evaluate('(() => { let n = 0; for (const v of Projalysis.VIEWS) n += Projalysis.printPages(Projalysis.sortList(JSON.parse(localStorage.getItem("projalysis.sapp.jp:doc")).files.map((f) => Projalysis.load(f.name, f.text))), v.id, null).length; return n; })()')
    ok(n >= 5, f'印刷のページ数: {n}')
    # 印刷: ビューをすべてページにする(window.print は呼ぶだけにする)
    pg.evaluate('window.print = () => { window.__printed = document.querySelectorAll("#printArea .page").length; }')
    pg.click('#btnPrint')
    ok(pg.evaluate('window.__printed') >= 5, f'印刷のページ: {pg.evaluate("window.__printed")}')
    ok(not errs, f'ページのエラー: {errs}')

    # 保存: ファイル操作機能のないブラウザの流れ(ダウンロード)で、足した plans の警告を確かめる(仕様書 7.2 節)
    pg2 = ctx.new_page()
    pg2.add_init_script('delete window.showOpenFilePicker; delete window.showSaveFilePicker; if (!sessionStorage.getItem("cleared")) { localStorage.clear(); sessionStorage.setItem("cleared", "1"); }')
    pg2.on('pageerror', lambda e: errs.append(str(e)))
    pg2.goto(url)
    pa = out / 'a.plans'; pb = out / 'b.plans'
    pa.write_text(pg2.evaluate(f'Projalysis.toPlans([Projalysis.load("v1.plan", {json.dumps((d / "v1.plan").read_text())})])'))
    pb.write_text(pg2.evaluate(f'Projalysis.toPlans([Projalysis.load("v1.plan", {json.dumps((d / "v1.plan").read_text())}), Projalysis.load("v2.plan", {json.dumps((d / "v2.plan").read_text())})])'))
    pg2.set_input_files('#fileOpen', [str(pa)])
    pg2.wait_for_function('document.querySelectorAll("#list .item").length === 1')
    ok(pg2.inner_text('#fileName') == 'a.plans', '空の一覧に開いた .plans が上書きの先にならない')
    # .plan を足しただけなら警告しない
    pg2.set_input_files('#fileOpen', [str(d / 'v3.plan')])
    pg2.wait_for_function('document.querySelectorAll("#list .item").length === 2')
    with pg2.expect_download() as dl:
        pg2.click('#btnSave')
    ok(not pg2.locator('#dlgMerge').is_visible(), '.plan を足しただけで警告が出た')
    ok(dl.value.suggested_filename == 'a.plans', f'上書き保存の名前: {dl.value.suggested_filename}')
    # plans を足すと、次の上書き保存の前に 1 回だけ確かめる(v1 は同じなので足さない)
    pg2.set_input_files('#fileOpen', [str(pb)])
    pg2.wait_for_function('document.querySelectorAll("#list .item").length === 3')
    # 開き直しても、警告を出すことは残る(ファイル操作機能のないブラウザでは、ファイル名が上書きの先として残る)
    pg2.reload()
    pg2.wait_for_function('document.querySelectorAll("#list .item").length === 3')
    pg2.click('#btnSave')
    ok(pg2.locator('#dlgMerge').is_visible(), 'plans を足した後の上書き保存で警告が出ない(開き直した後)')
    ok('足した plans(b.plans)の版も、a.plans に書き込みます' in pg2.inner_text('#dlgMerge'), f'警告の文: {pg2.inner_text("#dlgMerge")!r}')
    pg2.click('#dlgMerge [data-a="cancel"]')
    ok('*' in pg2.inner_text('#fileName'), 'やめた後に * が消えた')
    pg2.click('#btnSave')
    with pg2.expect_download() as dl:
        pg2.click('#dlgMerge [data-a="save"]')
    saved = json.loads(pathlib.Path(dl.value.path()).read_text())
    ok([f['name'] for f in saved['files']] == ['v1.plan', 'v3.plan', 'v2.plan'], f'保存した plans: {[f["name"] for f in saved["files"]]}')
    ok('*' not in pg2.inner_text('#fileName'), '保存の後に * が残った')
    with pg2.expect_download():
        pg2.click('#btnSave')
    ok(not pg2.locator('#dlgMerge').is_visible(), '一度上書きした後も警告が出た')
    ok(not errs, f'ページのエラー(保存): {errs}')

    # 比べる 2 つの版: 選ぶまでは、版を足すと既定(最初と最後)に従う。選んだ後は残す(仕様書 5.2 節)
    pg3 = ctx.new_page()
    pg3.add_init_script('if (!sessionStorage.getItem("cleared")) { localStorage.clear(); sessionStorage.setItem("cleared", "1"); }')
    pg3.goto(url)
    sel = lambda q: pg3.eval_on_selector(q, 'e => e.options[e.selectedIndex].text')
    pg3.set_input_files('#fileOpen', [str(d / 'v1.plan'), str(d / 'v2.plan')])
    pg3.wait_for_function('document.querySelectorAll("#list .item").length === 2')
    # 比較する版の帯は、2 つの版を比較するビューの上にだけ出る(左下の選択欄はない)
    ok(pg3.locator('#pairsel').count() == 0, '左下の比較する版の選択欄が残っている')
    for v, shown in [('overview', False), ('history', False), ('trend', False), ('tasks', True), ('sched', True), ('fbs', True), ('people', True), ('gantt', True)]:
        pg3.select_option('#viewKind', v)
        ok(pg3.locator('#pairbar').is_visible() == shown, f'{v} のビューで比較する版の帯の出方が違う')
    pg3.select_option('#viewKind', 'tasks')
    pg3.set_input_files('#fileOpen', [str(d / 'v3.plan')])
    pg3.wait_for_function('document.querySelectorAll("#list .item").length === 3')
    ok(sel('#selB').startswith('2026-05-01 版 (2)(v3.plan)'), f'版を足した後の既定の後の版: {sel("#selB")}')
    pg3.select_option('#selB', label=[o for o in pg3.eval_on_selector('#selB', 'e => [...e.options].map((o) => o.text)') if 'v2.plan' in o][0])
    v4 = out / 'v4.plan'
    v4.write_text((d / 'v3.plan').read_text().replace('version: 2026-05-01', 'version: 2026-05-09'))
    pg3.set_input_files('#fileOpen', [str(v4)])
    pg3.wait_for_function('document.querySelectorAll("#list .item").length === 4')
    ok('v2.plan' in sel('#selB'), f'選んだ版が、版を足した後に変わった: {sel("#selB")}')
    pg3.reload()
    pg3.wait_for_function('document.querySelectorAll("#list .item").length === 4')
    ok('v2.plan' in sel('#selB'), f'選んだ版が、開き直した後に変わった: {sel("#selB")}')
    pg3.locator('#list .item', has_text='v2.plan').locator('button', has_text='外す').click()
    ok('v4.plan' in sel('#selB'), f'選んだ版を外した後に既定に戻らない: {sel("#selB")}')
    ok(not errs, f'ページのエラー(2 つの版): {errs}')
    # ---- レビューの指摘を直した所(v0.25)
    pg3.on('dialog', lambda dl: dl.accept())  # 「新規」で空にしてよいかの確認に答える
    # 1-2 「コピー」を続けて押しても、2 秒後に元の文に戻る
    pg3.select_option('#viewKind', 'history')
    cb = pg3.locator('#canvas [data-copy]').first
    cb.click(); pg3.wait_for_timeout(300); cb.click()
    pg3.wait_for_timeout(2400)
    ok(cb.inner_text() == 'コピー', f'続けて押した後にコピーの文が戻らない: {cb.inner_text()!r}')
    # 1-15 比べられる版が 2 つ未満のときは、比較する版の帯を出さない
    pg3.click('#btnNew')
    pg3.set_input_files('#fileOpen', [str(d / 'v1.plan'), str(d / 'err.plan')])
    pg3.wait_for_function('document.querySelectorAll("#list .item").length === 2')
    pg3.select_option('#viewKind', 'tasks')
    ok(not pg3.locator('#pairbar').is_visible(), '比べられる版が 1 つなのに比較する版の帯が出る')
    # 1-9 画像のファイル名の元の名前も、使えない文字と空白を「_」にする
    odd = out / 'チーム A;版.plan'
    odd.write_text((d / 'v1.plan').read_text())
    pg3.click('#btnNew')
    pg3.set_input_files('#fileOpen', [str(odd), str(d / 'v3.plan')])
    pg3.wait_for_function('document.querySelectorAll("#list .item").length === 2')
    pg3.select_option('#viewKind', 'tasks')
    with pg3.expect_download() as dl:
        pg3.click('#canvas [data-tbl="追加したタスク|svg"]')
    ok(dl.value.suggested_filename == 'チーム_A;版_tasks_追加したタスク.svg', f'元の名前の置き換え: {dl.value.suggested_filename}')
    # 1-8 自動保持から戻した一覧は日付の順に並べ直す(同じ日付の中は保持した順)。選んだ組は変更前が前になる
    docs = {'files': [{'name': n, 'text': (d / n).read_text()} for n in ['v3.plan', 'v2.plan', 'v1.plan']], 'name': '', 'dirty': True, 'pair': [2, 0], 'pairUser': True, 'view': 'tasks', 'mergeWarn': False, 'mergeNames': []}
    pg3.evaluate('(t) => localStorage.setItem("projalysis.sapp.jp:doc", t)', json.dumps(docs, ensure_ascii=False))
    pg3.reload()
    pg3.wait_for_function('document.querySelectorAll("#list .item").length === 3')
    ok(pg3.locator('#list .iname').all_inner_texts() == ['v1.plan', 'v3.plan', 'v2.plan'], f'戻した一覧の並び: {pg3.locator("#list .iname").all_inner_texts()}')
    ok('v1.plan' in sel('#selA') and 'v3.plan' in sel('#selB'), f'戻した組: {sel("#selA")} / {sel("#selB")}')
    # 1-15 localStorage が使えないブラウザでも、一覧が空なら警告を出さない
    pg5 = ctx.new_page()
    pg5.add_init_script('Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } });')
    pg5.goto(url)
    pg5.wait_for_timeout(300)
    ok(pg5.inner_text('#warn') == '', f'空の一覧で保持の警告が出る: {pg5.inner_text("#warn")!r}')
    pg5.set_input_files('#fileOpen', [str(d / 'v1.plan')])
    pg5.wait_for_function('document.querySelectorAll("#list .item").length === 1')
    ok('自動保持に失敗' in pg5.inner_text('#warn'), '一覧があるのに保持の警告が出ない')
    ok(not errs, f'ページのエラー(指摘の修正): {errs}')
    # ---- 帯のプリセットのボタン「初版 → 最新版」「前の版 → 最新版」(仕様書 6 章)
    pg3.click('#btnNew')
    pg3.set_input_files('#fileOpen', [str(d / 'v1.plan'), str(d / 'v2.plan'), str(d / 'v3.plan'), str(d / 'err.plan')])
    pg3.wait_for_function('document.querySelectorAll("#list .item").length === 4')
    pg3.select_option('#viewKind', 'tasks')
    ok(pg3.locator('#pairbar #btnFirstLast').inner_text() == '初版 → 最新版' and pg3.locator('#pairbar #btnPrevLast').inner_text() == '前の版 → 最新版', 'ボタンの名前')
    pg3.click('#btnPrevLast')
    ok('v2.plan' in sel('#selA') and 'v3.plan' in sel('#selB'), f'前の版 → 最新版(エラーの版は数えない): {sel("#selA")} / {sel("#selB")}')
    v5 = out / 'v5.plan'
    v5.write_text((d / 'v3.plan').read_text().replace('version: 2026-05-01', 'version: 2026-05-10'))
    pg3.set_input_files('#fileOpen', [str(v5)])
    pg3.wait_for_function('document.querySelectorAll("#list .item").length === 5')
    ok('v2.plan' in sel('#selA') and 'v3.plan' in sel('#selB'), f'前の版 → 最新版は、版を足しても変わらない: {sel("#selA")} / {sel("#selB")}')
    pg3.click('#btnFirstLast')
    ok('v1.plan' in sel('#selA') and 'v5.plan' in sel('#selB'), f'初版 → 最新版: {sel("#selA")} / {sel("#selB")}')
    v6 = out / 'v6.plan'
    v6.write_text((d / 'v3.plan').read_text().replace('version: 2026-05-01', 'version: 2026-05-11'))
    pg3.set_input_files('#fileOpen', [str(v6)])
    pg3.wait_for_function('document.querySelectorAll("#list .item").length === 6')
    ok('v1.plan' in sel('#selA') and 'v6.plan' in sel('#selB'), f'初版 → 最新版は、版を足すと最新版に合わせて変わる: {sel("#selA")} / {sel("#selB")}')
    ok(not errs, f'ページのエラー(帯のボタン): {errs}')
    # ---- 図・表の「PDF」: その 1 つだけを、同じ大きさの紙で印刷する(仕様書 7.4 節)
    import re, subprocess
    pg3.evaluate('window.print = () => { window.__t = document.title; }')
    pg3.select_option('#viewKind', 'gantt')
    for sel, name in [('[data-fig="gantt|pdf"]', 'gantt'), ('[data-fig="gantt-people|pdf"]', 'gantt-people')]:
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
        pg3.click('#canvas [data-fig="gantt|svg"]')
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
    pg3.wait_for_function('document.querySelectorAll("#list .item").length === 2')
    pg3.select_option('#viewKind', 'gantt')
    chk = '''() => { const ids = (sel) => [...document.querySelectorAll(sel + ' [id]')].map((e) => e.id);
      const c = new Set(ids('#canvas')), p = ids('#printArea');
      const refs = [...document.querySelector('#printArea').innerHTML.matchAll(/="url\\(#([^)"]+)\\)"/g)].map((m) => m[1]);  // 属性の参照だけを数える(文の中の url(#…) は数えない)
      return { n: p.length, clash: p.filter((x) => c.has(x)).length, refs: refs.length, bad: refs.filter((x) => !p.includes(x)).length }; }'''
    pg3.click('#canvas [data-fig="gantt|pdf"]')
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
    pg3.wait_for_function('document.querySelectorAll("#list .item").length === 2')
    pg3.select_option('#viewKind', 'gantt')
    pg3.evaluate('window.print = () => {}')
    pg3.click('#canvas [data-fig="gantt|pdf"]')
    txt = pg3.evaluate('document.getElementById("printArea").textContent')
    r = pg3.evaluate(chk)
    ok('url(#offA)画面' in txt and 'url(#offA-' not in txt and r['clash'] == 0 and r['bad'] == 0, f'印刷の領域で文の中の url(#…) が書き換わる、または参照が壊れた: {r} {txt[:80]!r}')
    pg3.click('#btnPrint')
    txt = pg3.evaluate('document.getElementById("printArea").textContent')
    r = pg3.evaluate(chk)
    ok('url(#offA)画面' in txt and 'url(#offA-' not in txt and r['clash'] == 0 and r['bad'] == 0, f'全体の印刷で文の中の url(#…) が書き換わる、または参照が壊れた: {r}')
    ok(not errs, f'ページのエラー(v0.32): {errs}')
    b.close()
print('画像:', out)
print('NG' if fail else 'OK', fail)
sys.exit(1 if fail else 0)
