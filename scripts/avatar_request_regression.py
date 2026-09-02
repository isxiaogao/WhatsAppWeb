from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright


base_url = "http://127.0.0.1:5273"
avatar_mutations: list[str] = []
console_errors: list[str] = []

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        headless=True,
        executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    )
    page = browser.new_page(viewport={"width": 1440, "height": 960})
    page.on(
        "request",
        lambda request: avatar_mutations.append(f"{request.method} {request.url}")
        if "/api/accounts/" in request.url and request.url.endswith("/avatar")
        else None,
    )
    page.on(
        "console",
        lambda message: console_errors.append(message.text)
        if message.type == "error"
        else None,
    )
    page.on("pageerror", lambda error: console_errors.append(str(error)))

    page.goto(base_url)
    try:
        page.wait_for_load_state("networkidle", timeout=5_000)
    except PlaywrightTimeoutError:
        # The control center intentionally keeps one SSE request open.
        pass

    online_card = page.locator(".account-card:has(.is-online)").first
    online_card.wait_for(timeout=15_000)
    avatar_url = online_card.locator(".account-avatar img").get_attribute("src")
    assert avatar_url, "Online account does not have an avatar to reapply"
    initial_accounts = page.request.get(base_url + "/api/accounts").json()["items"]
    initial_account = next(
        item
        for item in initial_accounts
        if item["status"] == "ONLINE" and item["avatarUrl"] == avatar_url
    )
    account_id = initial_account["id"]

    current_avatar = page.request.get(base_url + avatar_url)
    assert current_avatar.ok, f"Could not read current avatar: {current_avatar.status}"

    online_card.locator("button", has_text="修改账号头像").click()
    profile_dialog = page.locator(".profile-dialog")
    profile_dialog.wait_for()
    profile_dialog.locator("input[type=file]").set_input_files(
        {
            "name": "avatar-regression.jpg",
            "mimeType": current_avatar.headers.get("content-type", "image/jpeg"),
            "buffer": current_avatar.body(),
        }
    )

    with page.expect_response(
        lambda response: response.request.method == "PUT"
        and response.url.endswith(f"/api/accounts/{account_id}/avatar"),
        timeout=60_000,
    ) as response_info:
        profile_dialog.locator("button.primary").click()

    response = response_info.value
    assert response.ok, f"Avatar update failed: {response.status} {response.text()}"
    profile_dialog.wait_for(state="hidden", timeout=15_000)
    page.wait_for_timeout(3_000)

    assert avatar_mutations == [f"PUT {base_url}/api/accounts/{account_id}/avatar"], avatar_mutations
    accounts_response = page.request.get(base_url + "/api/accounts")
    accounts = accounts_response.json()["items"]
    account = next(item for item in accounts if item["id"] == account_id)
    assert account["status"] == "ONLINE", account
    assert not console_errors, f"Browser console errors: {console_errors}"
    browser.close()

print("Avatar regression passed: one PUT request, dialog closed, account remained ONLINE")
