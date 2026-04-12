from pathlib import Path
import time

import pyautogui
import pyperclip
from PIL import ImageGrab


CACHE = Path(r"D:\Ethiopia\News app\ethiopia-news-app-task-2\.cache\desktop-grok")
CACHE.mkdir(parents=True, exist_ok=True)


def snap(name: str) -> None:
    img = ImageGrab.grab(all_screens=True)
    img.save(CACHE / f"{name}.png")


def click(x: int, y: int, pause: float = 0.8) -> None:
    pyautogui.click(x, y)
    time.sleep(pause)


def main() -> None:
    pyautogui.FAILSAFE = True
    snap("00-start")

    # Prompt area
    click(1285, 1720)

    # Switch to Video
    click(1240, 1828)

    # Keep 480p / 6s for probe, select landscape
    click(1448, 1827)  # aspect ratio control
    click(1448, 1746)  # 16:9 option in the popover

    prompt = (
        "Create a 6-second premium editorial motion-graphics probe video. "
        "Dark news dashboard background, subtle Ethiopia map glow, floating headlines. "
        "Audio: a calm off-screen reporter says, 'This is a generation test.' "
        "No people on screen, no logos, clear sound."
    )
    pyperclip.copy(prompt)
    pyautogui.hotkey("ctrl", "a")
    time.sleep(0.2)
    pyautogui.hotkey("ctrl", "v")
    time.sleep(1.2)

    snap("01-filled")

    # Submit
    click(2470, 1818, pause=2.0)

    snap("02-submitted")

    # Poll a few times after submission
    for i, wait_s in enumerate((10, 20, 30), start=1):
        time.sleep(wait_s)
        snap(f"poll-{i:02d}")


if __name__ == "__main__":
    main()
