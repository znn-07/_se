#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test/ui_e2e.py — 校務系統「瀏覽器 UI」端對端測試 (Python + Playwright)

有別於 test/e2e.js（只打到 HTTP API），本測試會：
  1. 啟動一份真實的 server.js（使用隔離的暫存資料庫，不污染正式 data/）
  2. 開啟 Chromium「真的打開網頁」
  3. 從登入畫面開始操作：登入 → 選課 → 查成績 → 教師登成績 → 教務處管理
  4. 每一步截圖到 test/screenshots/，方便事後檢視

執行方式（需先安裝 playwright）：
  pip install playwright
  python -m playwright install chromium
  python test/ui_e2e.py            # 無頭模式（CI 適用）
  python test/ui_e2e.py --headed   # 開啟瀏覽器視窗，可直接觀看操作過程
"""

import argparse
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import traceback

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SERVER_ENTRY = ROOT / "server.js"
SHOT_DIR = ROOT / "test" / "screenshots"
BASE_HOST = "127.0.0.1"
DEFAULT_PORT = 8392

ok_count = 0
fail_log = []


def log_ok(msg):
    global ok_count
    ok_count += 1
    print(f"  [OK] {msg}")


def log_fail(msg):
    fail_log.append(msg)
    print(f"  [FAIL] {msg}")


def wait_ready(port, timeout=20):
    start = time.time()
    while time.time() - start < timeout:
        try:
            with socket.create_connection((BASE_HOST, port), timeout=1):
                return
        except OSError:
            time.sleep(0.25)
    raise RuntimeError("server did not become ready")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--headed", action="store_true", help="open a visible browser window")
    args = ap.parse_args()

    port = int(os.environ.get("UI_PORT", DEFAULT_PORT))
    base = f"http://{BASE_HOST}:{port}"
    data_dir = tempfile.mkdtemp(prefix="nqu-ui-e2e-")
    SHOT_DIR.mkdir(parents=True, exist_ok=True)

    proc = subprocess.Popen(
        ["node", str(SERVER_ENTRY)],
        env={**os.environ, "PORT": str(port), "DATA_DIR": data_dir},
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        wait_ready(port)
        print(f"server ready @ {base}  (isolation data dir: {data_dir})")
        run_browser_tests(base, headed=args.headed)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(data_dir, ignore_errors=True)

    print("=" * 46)
    print(f"UI e2e result: {ok_count} passed, {len(fail_log)} failed")
    for f in fail_log:
        print(f"  FAILED: {f}")
    print(f"screenshots saved to: {SHOT_DIR}")
    sys.exit(1 if fail_log else 0)


def new_page(browser):
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    ctx.set_default_timeout(10000)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    return ctx, page, errs


def login(page, base, username, password="1111"):
    page.goto(base)
    page.wait_for_selector("#login-screen:not([hidden])")
    page.fill("#login-username", username)
    page.fill("#login-password", password)
    page.click("#login-form button[type=submit]")
    page.wait_for_selector("#app-screen:not([hidden])")


def check_no_errors(errs):
    if errs:
        raise AssertionError(f"page console errors: {errs}")


def run_browser_tests(base, headed=False):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not headed)
        try:
            scenario_login_page(browser, base)
            scenario_student_enroll(browser, base)
            scenario_student_grades(browser, base)
            scenario_teacher_score(browser, base)
            scenario_admin_crud(browser, base)
            scenario_logout(browser, base)
        finally:
            browser.close()


# ---------- scenarios ----------
def scenario_login_page(browser, base):
    print("[scenario] login page loads")
    ctx, page, errs = new_page(browser)
    try:
        page.goto(base)
        page.wait_for_selector("#login-screen:not([hidden])")
        h1 = page.locator(".login-card h1").inner_text()
        assert "校務" in h1 or "大學" in h1
        page.screenshot(path=str(SHOT_DIR / "01_login_screen.png"))
        check_no_errors(errs)
        log_ok("登入畫面載入，標題正確，無網頁錯誤")
    except Exception as e:
        log_fail(f"登入畫面：{e}\n{traceback.format_exc()}")
    finally:
        ctx.close()


def scenario_student_enroll(browser, base):
    print("[scenario] student enroll flow")
    ctx, page, errs = new_page(browser)
    try:
        login(page, base, "S001")
        page.click('#sidebar a[data-href="#/student/enroll"]')
        page.wait_for_selector("table.tbl")
        page.screenshot(path=str(SHOT_DIR / "02_enroll_courses.png"))
        # 第一個可加選的課程（種子資料下為 C002 資料結構），點擊加選
        btn = page.locator("button[data-enroll]").first
        btn.click()
        page.wait_for_selector("#toast:not([hidden])")
        page.screenshot(path=str(SHOT_DIR / "03_enroll_toast.png"))
        # 到「已選課程」分頁，確認剛加選的資料結構已列出
        page.click('#sidebar a[data-href="#/student/enrolled"]')
        page.wait_for_selector("table.tbl")
        enrolled_text = page.locator("#table-wrap").inner_text()
        assert "資料結構" in enrolled_text
        page.screenshot(path=str(SHOT_DIR / "04_enrolled_courses.png"))
        check_no_errors(errs)
        log_ok("點加選出現提示，且「已選課程」分頁正確列出新課「資料結構」")
    except Exception as e:
        log_fail(f"學生選課：{e}\n{traceback.format_exc()}")
    finally:
        ctx.close()


def scenario_student_grades(browser, base):
    print("[scenario] student grades view")
    ctx, page, errs = new_page(browser)
    try:
        login(page, base, "S001")
        page.click('#sidebar a[data-href="#/student/grades"]')
        page.wait_for_selector(".summary-item")
        avg = page.locator(".summary-item", has_text="加權平均").locator(".v").inner_text()
        assert avg not in ("", "－")
        page.screenshot(path=str(SHOT_DIR / "05_grades.png"))
        check_no_errors(errs)
        log_ok(f"成績單平均成績顯示為 {avg}")
    except Exception as e:
        log_fail(f"學生查成績：{e}\n{traceback.format_exc()}")
    finally:
        ctx.close()


def scenario_teacher_score(browser, base):
    print("[scenario] teacher score entry")
    ctx, page, errs = new_page(browser)
    try:
        login(page, base, "T001")
        page.click('#sidebar a[data-href="#/teacher/scores"]')
        page.wait_for_selector("#roster-wrap .tbl")
        score_input = page.locator("#roster-wrap input.score-input").first
        score_input.fill("95")
        page.locator("#roster-wrap button[data-save]").first.click()
        page.wait_for_selector("#toast:not([hidden])")
        page.screenshot(path=str(SHOT_DIR / "06_teacher_score_saved.png"))
        check_no_errors(errs)
        log_ok("教師登錄成績成功（出現儲存提示）")
    except Exception as e:
        log_fail(f"教師登成績：{e}\n{traceback.format_exc()}")
    finally:
        ctx.close()


def scenario_admin_crud(browser, base):
    print("[scenario] admin student CRUD")
    ctx, page, errs = new_page(browser)
    try:
        page.on("dialog", lambda d: d.accept())
        login(page, base, "admin")
        page.click('#sidebar a[data-href="#/admin/students"]')
        page.wait_for_selector("#btn-add")
        page.screenshot(path=str(SHOT_DIR / "07_admin_students.png"))
        page.click("#btn-add")
        page.wait_for_selector("#modal-mask:not([hidden])")
        page.fill('#modal-form input[name="id"]', "S888")
        page.fill('#modal-form input[name="name"]', "UI E2E STUDENT")
        page.select_option('#modal-form select[name="dept"]', "CS")
        page.fill('#modal-form input[name="entryYear"]', "2024")
        page.screenshot(path=str(SHOT_DIR / "08_admin_student_form.png"))
        page.click("#modal-save")
        # 等待「儲存後」彈窗真正關閉；#modal-mask[hidden] 在頁面載入時就成立，
        # 不能用 state="attached"，必須等元素從「可見」變成「不可見」。
        page.wait_for_selector("#modal-mask", state="hidden")
        page.wait_for_selector("text=S888")
        log_ok("教務處新增學生成功，表格出現 S888")
        row = page.locator("tr", has_text="S888")
        row.locator('button[data-action="del"]').click()
        page.wait_for_selector("text=S888", state="detached")
        page.screenshot(path=str(SHOT_DIR / "09_admin_student_deleted.png"))
        log_ok("教務處刪除學生成功，S888 已從表格移除")
        check_no_errors(errs)
    except Exception as e:
        diag = ""
        try:
            diag = (
                "\n  [diag] toast: "
                + repr(page.evaluate("() => document.getElementById('toast').textContent"))
                + "\n  [diag] modal hidden attr: "
                + repr(page.get_attribute("#modal-mask", "hidden"))
                + "\n  [diag] app visible: "
                + str(page.is_visible("#app-screen"))
                + "\n  [diag] content: "
                + repr(page.evaluate("() => document.getElementById('content').innerText"))
            )
        except Exception as de:
            diag = f"\n  [diag] 取得診斷資訊失敗: {de}"
        log_fail(f"教務處管理：{e}\n{traceback.format_exc()}{diag}")
    finally:
        ctx.close()


def scenario_logout(browser, base):
    print("[scenario] logout")
    ctx, page, errs = new_page(browser)
    try:
        login(page, base, "S001")
        page.click("#logout-btn")
        page.wait_for_selector("#login-screen:not([hidden])")
        page.screenshot(path=str(SHOT_DIR / "10_logged_out.png"))
        check_no_errors(errs)
        log_ok("登出後回到登入畫面")
    except Exception as e:
        log_fail(f"登出：{e}\n{traceback.format_exc()}")
    finally:
        ctx.close()


if __name__ == "__main__":
    main()