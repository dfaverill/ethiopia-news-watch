from pathlib import Path
import asyncio
import os

from playwright.async_api import async_playwright


EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PROFILE_DIR = Path(os.environ.get("TEMP", ".")) / "codex-grok-edge-profile"


async def dump_links(page) -> None:
    texts = await page.locator("a,button,[role='button']").evaluate_all(
        """els => els.map((el, i) => ({
            i,
            tag: el.tagName,
            text: (el.innerText || el.getAttribute('aria-label') || '').trim(),
            href: el.getAttribute('href') || '',
        })).filter(x => x.text).slice(0, 120)"""
    )
    for item in texts:
        safe = str(item).encode("ascii", "backslashreplace").decode("ascii")
        print(safe)


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
        await page.goto("https://grok.com/", wait_until="domcontentloaded")
        await page.wait_for_timeout(5000)
        print("HOME", page.url, await page.title())
        await dump_links(page)
        await page.goto("https://grok.com/imagine", wait_until="domcontentloaded")
        await page.wait_for_timeout(7000)
        print("AFTER", page.url, await page.title())
        body = await page.locator("body").inner_text()
        print(body[:4000].encode("ascii", "backslashreplace").decode("ascii"))
        await dump_links(page)
        await page.screenshot(path=str(PROFILE_DIR / "grok-imagine-probe.png"), full_page=True)
        print("SCREENSHOT:", PROFILE_DIR / "grok-imagine-probe.png")
        await context.close()


if __name__ == "__main__":
    asyncio.run(main())
