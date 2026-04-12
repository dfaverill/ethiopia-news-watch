from pathlib import Path
import asyncio
import os

from playwright.async_api import async_playwright


CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PROFILE_DIR = Path(os.environ.get("TEMP", ".")) / "codex-grok-chrome-profile"


async def main() -> None:
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            executable_path=CHROME_PATH,
            headless=False,
            viewport={"width": 1440, "height": 960},
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = context.pages[0] if context.pages else await context.new_page()
        await page.goto("https://grok.com/", wait_until="domcontentloaded")
        await page.wait_for_timeout(8000)
        print("TITLE:", await page.title())
        print("URL:", page.url)
        body = await page.locator("body").inner_text()
        print(body[:4000].encode("ascii", "backslashreplace").decode("ascii"))
        await page.screenshot(path=str(PROFILE_DIR / "grok-chrome-probe.png"), full_page=True)
        await context.close()


if __name__ == "__main__":
    asyncio.run(main())
