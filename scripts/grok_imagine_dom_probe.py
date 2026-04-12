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
        btn = page.get_by_role("button", name="Submit")
        await btn.wait_for(timeout=10000)
        html = await btn.evaluate(
            """el => {
                let node = el;
                for (let i = 0; i < 6 && node; i += 1) {
                    node = node.parentElement;
                }
                return node ? node.outerHTML : 'NO_PARENT';
            }"""
        )
        print(html[:20000].encode("ascii", "backslashreplace").decode("ascii"))
        await context.close()


if __name__ == "__main__":
    asyncio.run(main())
