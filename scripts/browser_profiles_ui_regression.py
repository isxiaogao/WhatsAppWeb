from playwright.sync_api import sync_playwright


DESKTOP_BRIDGE = """
window.desktop = {
  apiVersion: 2,
  getRuntimeConfig: async () => ({ controlApiUrl: 'http://127.0.0.1:4100' }),
  saveRuntimeConfig: async (input) => input,
  getVersion: async () => 'test',
  listBrowserProfiles: async () => [],
  createBrowserProfile: async (input) => ({
    id: 'ui-regression-profile',
    ...input,
    proxyUrl: input.proxyUrl || null,
    createdAt: new Date().toISOString(),
    lastOpenedAt: null,
  }),
  openBrowserProfile: async () => { throw new Error('not used') },
}
"""


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()
    console_errors = []
    page.on(
        "console",
        lambda message: console_errors.append(message.text)
        if message.type == "error"
        else None,
    )
    page.add_init_script(DESKTOP_BRIDGE)
    page.route(
        "**/api/accounts",
        lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body='{"items":[]}',
        ),
    )
    page.route("**/api/events", lambda route: route.fulfill(status=204, body=""))
    page.goto("http://127.0.0.1:5273", wait_until="networkidle")

    assert page.locator(".runtime-state").inner_text() == "DESKTOP"
    browser_profiles_button = page.get_by_title("浏览器档案")
    assert browser_profiles_button.count() == 1
    browser_profiles_button.click()
    page.locator(".browser-header h2").wait_for()
    assert page.locator(".browser-header h2").inner_text() == "浏览器档案"

    page.get_by_label("浏览器名称").fill("UI 回归档案")
    page.get_by_label("责任人").fill("自动测试")
    page.get_by_role("button", name="创建独立档案").click()
    page.get_by_role("heading", name="UI 回归档案").wait_for()

    assert not console_errors, console_errors
    print("Browser profiles UI regression passed: desktop navigation and creation both work.")
    browser.close()
