from pathlib import Path
import asyncio
import os

from playwright.async_api import async_playwright


EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PROFILE_DIR = Path(os.environ.get("TEMP", ".")) / "codex-grok-edge-profile"


async def main() -> None:
    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            executable_path=EDGE_PATH,
            headless=False,
            viewport={"width": 1440, "height": 960},
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = context.pages[0] if context.pages else await context.new_page()
        await page.goto("https://grok.com/imagine", wait_until="domcontentloaded")
        await page.wait_for_timeout(7000)
        data = await page.locator("textarea,input,[contenteditable='true']").evaluate_all(
            """els => els.map((el, i) => ({
                i,
                tag: el.tagName,
                type: el.getAttribute('type') || '',
                role: el.getAttribute('role') || '',
                placeholder: el.getAttribute('placeholder') || '',
                aria: el.getAttribute('aria-label') || '',
                testid: el.getAttribute('data-testid') || '',
                text: (el.innerText || el.value || '').slice(0, 400),
            }))"""
        )
        for item in data:
            print(str(item).encode("ascii", "backslashreplace").decode("ascii"))
        await page.screenshot(path=str(PROFILE_DIR / "grok-imagine-fields.png"), full_page=True)
        await context.close()


if __name__ == "__main__":
    asyncio.run(main())
