from playwright.sync_api import sync_playwright


DESKTOP_BRIDGE = """
let profiles = [];
const makeProfile = (input, existing = {}) => ({
  ...existing,
  id: existing.id || 'ui-regression-profile',
  ...input,
  proxyUrl: input.proxyUrl || null,
  proxyUsername: input.proxyUsername || null,
  hasProxyPassword: Boolean(input.proxyPassword),
  fingerprint: {
    userAgent: 'Mozilla/5.0 Chrome/147.0.0.0',
    platform: 'Win32',
    language: input.locale,
    screen: '1920 × 1080 @ 1',
    hardwareConcurrency: 8,
    webgl: 'Google Inc. / ANGLE',
  },
  createdAt: existing.createdAt || new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastOpenedAt: existing.lastOpenedAt || null,
  runtime: existing.runtime || { status: 'STOPPED', cdpEndpoint: null, startedAt: null, lastError: null },
});
window.desktop = {
  apiVersion: 3,
  getRuntimeConfig: async () => ({ controlApiUrl: 'http://127.0.0.1:4100' }),
  saveRuntimeConfig: async (input) => input,
  getVersion: async () => 'test',
  listBrowserProfiles: async () => profiles,
  createBrowserProfile: async (input) => {
    const created = makeProfile(input);
    profiles = [created, ...profiles];
    return created;
  },
  updateBrowserProfile: async (id, input) => {
    const updated = makeProfile(input, profiles.find((profile) => profile.id === id));
    profiles = profiles.map((profile) => profile.id === id ? updated : profile);
    return updated;
  },
  deleteBrowserProfile: async (id) => {
    profiles = profiles.filter((profile) => profile.id !== id);
  },
  startBrowserProfile: async (id) => {
    const startedAt = new Date().toISOString();
    const current = profiles.find((profile) => profile.id === id);
    const updated = {
      ...current,
      lastOpenedAt: startedAt,
      runtime: {
        status: 'RUNNING',
        cdpEndpoint: 'http://127.0.0.1:9222',
        startedAt,
        lastError: null,
      },
    };
    profiles = profiles.map((profile) => profile.id === id ? updated : profile);
    return updated;
  },
  stopBrowserProfile: async (id) => {
    const current = profiles.find((profile) => profile.id === id);
    const updated = {
      ...current,
      runtime: { status: 'STOPPED', cdpEndpoint: null, startedAt: null, lastError: null },
    };
    profiles = profiles.map((profile) => profile.id === id ? updated : profile);
    return updated;
  },
  getBrowserProfileStatus: async () => ({ status: 'STOPPED', cdpEndpoint: null, startedAt: null, lastError: null }),
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

    page.get_by_role("button", name="启动浏览器").click()
    page.get_by_text("运行中", exact=True).wait_for()
    assert page.locator(".cdp-row code").inner_text() == "http://127.0.0.1:9222"

    page.get_by_role("button", name="关闭浏览器").click()
    page.get_by_text("已停止", exact=True).wait_for()

    page.get_by_role("button", name="编辑").click()
    page.get_by_label("浏览器名称").fill("UI 回归档案（已编辑）")
    page.get_by_role("button", name="保存档案").click()
    page.get_by_role("heading", name="UI 回归档案（已编辑）").wait_for()

    page.once("dialog", lambda dialog: dialog.accept())
    page.get_by_role("button", name="删除").click()
    page.get_by_text("还没有浏览器档案").wait_for()

    assert not console_errors, console_errors
    print("Browser profiles UI regression passed: create, start, stop, edit, and delete all work.")
    browser.close()
