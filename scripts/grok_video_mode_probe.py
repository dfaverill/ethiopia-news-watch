from pathlib import Path
import asyncio
import os

from playwright.async_api import async_playwright


EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PROFILE_DIR = Path(os.environ.get("TEMP", ".")) / "codex-grok-edge-profile"


async def dump(page, label: str) -> None:
    body = await page.locator("body").inner_text()
    print(label)
    print(body[:5000].encode("ascii", "backslashreplace").decode("ascii"))
    controls = await page.locator("button,[role='radio']").evaluate_all(
        """els => els.map((el, i) => ({
            i,
            text: (el.innerText || el.getAttribute('aria-label') || '').trim(),
            checked: el.getAttribute('aria-checked') || '',
            expanded: el.getAttribute('aria-expanded') || '',
        })).filter(x => x.text).slice(0, 200)"""
    )
    for item in controls:
        print(str(item).encode("ascii", "backslashreplace").decode("ascii"))


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
        await dump(page, "BEFORE")
        await page.get_by_role("radio", name="Video").click()
        await page.wait_for_timeout(3000)
        await dump(page, "AFTER_VIDEO")
        await page.screenshot(path=str(PROFILE_DIR / "grok-video-mode-probe.png"), full_page=True)
        await context.close()


if __name__ == "__main__":
    asyncio.run(main())
