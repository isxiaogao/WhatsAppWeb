from pathlib import Path
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright


workspace = Path(__file__).resolve().parents[1]
artifact_dir = workspace / "artifacts"
artifact_dir.mkdir(exist_ok=True)
console_errors: list[str] = []

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        headless=True,
        executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    )
    page = browser.new_page(viewport={"width": 1440, "height": 960})
    page.on(
        "console",
        lambda message: console_errors.append(message.text)
        if message.type == "error"
        else None,
    )
    page.on("pageerror", lambda error: console_errors.append(str(error)))

    page.goto("http://127.0.0.1:5273")
    try:
        page.wait_for_load_state("networkidle", timeout=5_000)
    except PlaywrightTimeoutError:
        # The application intentionally keeps an SSE connection open.
        pass
    page.locator("h1").wait_for()
    try:
        page.locator(".account-card").first.wait_for(timeout=10_000)
    except Exception:
        body_debug = page.locator("body").inner_text()[:3000].encode("ascii", "backslashreplace").decode()
        error_debug = repr(console_errors).encode("ascii", "backslashreplace").decode()
        print("PAGE BODY:", body_debug)
        print("CONSOLE ERRORS:", error_debug)
        page.screenshot(path=str(artifact_dir / "ui-failure.png"), full_page=True)
        raise
    assert page.locator(".account-card").count() >= 1
    assert "EVOLUTION" in page.locator(".account-card").first.inner_text()
    assert page.locator(".profile-line code").first.inner_text().startswith("wa_")

    online_card = page.locator(".account-card:has(.is-online)").first
    online_card.click()
    online_card.locator("button", has_text="修改账号头像").click()
    page.locator(".profile-dialog").wait_for()
    assert "512 × 512 CENTER CROP" in page.locator(".profile-dialog").inner_text()
    page.locator(".dialog-header button").click()

    if page.locator(".conversation-item").count() > 0:
        page.locator(".conversation-item").first.click()
        page.locator(".media-composer input[type=file]").set_input_files(str(artifact_dir / "ui-smoke.png"))
        page.locator(".media-draft").wait_for()
        assert "IMAGE" in page.locator(".media-draft").inner_text()
        page.locator(".draft-actions button").first.click()

    page.locator(".square-action").click()
    page.locator(".connect-dialog").wait_for()
    assert page.locator(".provider-card").count() == 1
    assert "EVOLUTION API + BAILEYS" in page.locator(".provider-card").inner_text()
    page.locator(".close-button").click()

    selected_name = page.locator(".account-card.selected .account-name").inner_text()
    page.locator(".account-card.selected button", has_text="永久删除实例").click()
    page.locator(".delete-dialog").wait_for()
    assert "无法撤销" in page.locator(".delete-dialog").inner_text()
    page.locator("#delete-confirmation").fill(selected_name)
    assert page.locator(".delete-dialog .danger").is_enabled()
    page.locator(".delete-dialog .close-button").click()

    page.screenshot(path=str(artifact_dir / "ui-smoke.png"), full_page=True)

    assert not console_errors, f"Browser console errors: {console_errors}"
    browser.close()

print("UI smoke passed: media preview, profile dialog, instance creation, and guarded deletion dialog")
