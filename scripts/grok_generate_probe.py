from pathlib import Path
import asyncio
import os
import time

from playwright.async_api import async_playwright


EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PROFILE_DIR = Path(os.environ.get("TEMP", ".")) / "codex-grok-edge-profile"
OUT_DIR = Path("D:/Ethiopia/News app/ethiopia-news-app-task-2/.cache/grok-probe")
PROMPT = """
Create a premium 6-second landscape editorial motion-graphics test clip.
Scene: dark news-dashboard background with a subtle glowing outline map of Ethiopia and floating data cards.
Action: clean animated headlines slide in and settle.
Audio: a calm off-screen news reporter says, "This is a generation test."
Style: polished app promo, no humans on screen, no logos, clear audio.
""".strip()


async def safe_dump(page, label: str) -> None:
    text = await page.locator("body").inner_text()
    path = OUT_DIR / f"{label}.txt"
    path.write_text(text, encoding="utf-8")
    buttons = await page.locator("button,a,[role='button'],[role='menuitem']").evaluate_all(
        """els => els.map((el, i) => ({
            i,
            tag: el.tagName,
            role: el.getAttribute('role') || '',
            text: (el.innerText || el.getAttribute('aria-label') || '').trim(),
            href: el.getAttribute('href') || '',
            disabled: !!el.disabled,
        })).filter(x => x.text).slice(0, 250)"""
    )
    (OUT_DIR / f"{label}-controls.txt").write_text(
        "\n".join(str(item) for item in buttons), encoding="utf-8"
    )
    await page.screenshot(path=str(OUT_DIR / f"{label}.png"), full_page=True)
    print(f"DUMPED {label} {page.url}")


async def click_text(page, role: str, name: str) -> None:
    locator = page.get_by_role(role, name=name)
    await locator.wait_for(timeout=10000)
    await locator.click()


async def set_video_settings(page) -> None:
    await click_text(page, "radio", "Video")
    await page.wait_for_timeout(500)
    await click_text(page, "radio", "480p")
    await page.wait_for_timeout(300)
    await click_text(page, "radio", "6s")
    await page.wait_for_timeout(300)
    await page.get_by_role("button", name="Aspect Ratio").click()
    await page.wait_for_timeout(500)
    ratio = page.get_by_text("16:9", exact=True).last
    await ratio.wait_for(timeout=10000)
    await ratio.click()
    await page.wait_for_timeout(700)


async def fill_prompt(page, prompt: str) -> None:
    editor = page.locator("[contenteditable='true']").last
    await editor.click()
    await page.keyboard.press("Control+A")
    await page.keyboard.press("Backspace")
    await page.keyboard.insert_text(prompt)
    await page.wait_for_timeout(500)


async def submit(page) -> None:
    submit_btn = page.get_by_role("button", name="Submit")
    await submit_btn.wait_for(timeout=10000)
    await submit_btn.click()


async def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            executable_path=EDGE_PATH,
            headless=False,
            viewport={"width": 1440, "height": 960},
            accept_downloads=True,
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = context.pages[0] if context.pages else await context.new_page()
        await page.goto("https://grok.com/imagine", wait_until="domcontentloaded")
        await page.wait_for_timeout(7000)
        await set_video_settings(page)
        await fill_prompt(page, PROMPT)
        await safe_dump(page, "before-submit")
        await submit(page)
        await page.wait_for_timeout(3000)
        await safe_dump(page, "after-submit")

        deadline = time.time() + 60 * 10
        check = 0
        while time.time() < deadline:
            check += 1
            await page.wait_for_timeout(20000)
            await safe_dump(page, f"poll-{check:02d}")

            body = await page.locator("body").inner_text()
            low = body.lower()
            if "extend" in low or "download" in low or "generated" in low or "remix" in low:
                print("LIKELY_RESULT_READY")
                break

        await context.close()


if __name__ == "__main__":
    asyncio.run(main())
