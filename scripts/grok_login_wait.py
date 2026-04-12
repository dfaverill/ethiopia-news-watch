from pathlib import Path
import asyncio
import os
import sys
import time

from playwright.async_api import async_playwright


EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PROFILE_DIR = Path(os.environ.get("TEMP", ".")) / "codex-grok-edge-profile"
STATE_FILE = PROFILE_DIR / "login-state.txt"


async def body_text(page) -> str:
    try:
        return await page.locator("body").inner_text(timeout=3000)
    except Exception:
        return ""


async def is_logged_in(page) -> bool:
    text = (await body_text(page)).lower()
    if "sign in" in text and "sign up" in text:
        return False
    return "new" in text or "attach" in text or "imagine" in text


async def main() -> None:
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text("starting", encoding="utf-8")

    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            executable_path=EDGE_PATH,
            headless=False,
            viewport={"width": 1440, "height": 960},
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = context.pages[0] if context.pages else await context.new_page()
        await page.goto("https://grok.com/", wait_until="domcontentloaded")

        deadline = time.time() + 60 * 10
        while time.time() < deadline:
            if await is_logged_in(page):
                STATE_FILE.write_text(f"logged-in\n{page.url}", encoding="utf-8")
                print("LOGIN_READY")
                print(page.url)
                await page.screenshot(
                    path=str(PROFILE_DIR / "grok-login-ready.png"),
                    full_page=True,
                )
                await context.close()
                return

            STATE_FILE.write_text(f"waiting\n{page.url}", encoding="utf-8")
            await page.wait_for_timeout(2500)

        STATE_FILE.write_text(f"timeout\n{page.url}", encoding="utf-8")
        print("LOGIN_TIMEOUT", file=sys.stderr)
        await context.close()
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
