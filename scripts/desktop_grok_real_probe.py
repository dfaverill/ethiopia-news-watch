from pathlib import Path
import ctypes
import time

import pyautogui
import pyperclip
from PIL import ImageGrab


CACHE = Path(r"D:\Ethiopia\News app\ethiopia-news-app-task-2\.cache\desktop-grok-real")
CACHE.mkdir(parents=True, exist_ok=True)

URL = "https://grok.com/imagine"


user32 = ctypes.WinDLL("user32", use_last_error=True)
EnumWindows = user32.EnumWindows
EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
GetWindowTextLength = user32.GetWindowTextLengthW
GetWindowText = user32.GetWindowTextW
IsWindowVisible = user32.IsWindowVisible
SetForegroundWindow = user32.SetForegroundWindow
ShowWindow = user32.ShowWindow
BringWindowToTop = user32.BringWindowToTop

SW_RESTORE = 9
SW_MAXIMIZE = 3
SW_MINIMIZE = 6


def title_of(hwnd: int) -> str:
    length = GetWindowTextLength(hwnd)
    buf = ctypes.create_unicode_buffer(length + 1)
    GetWindowText(hwnd, buf, length + 1)
    return buf.value


def find_window(predicate) -> int | None:
    matches: list[int] = []

    def callback(hwnd: int, _lparam: int) -> bool:
        if IsWindowVisible(hwnd):
            title = title_of(hwnd)
            if predicate(title):
                matches.append(hwnd)
        return True

    EnumWindows(EnumWindowsProc(callback), 0)
    return matches[0] if matches else None


def minimize_codex() -> None:
    def callback(hwnd: int, _lparam: int) -> bool:
        if IsWindowVisible(hwnd):
            title = title_of(hwnd)
            if title == "Codex" or title.startswith("Codex"):
                ShowWindow(hwnd, SW_MINIMIZE)
                time.sleep(0.1)
        return True

    EnumWindows(EnumWindowsProc(callback), 0)


def focus_grok() -> None:
    hwnd = find_window(lambda title: title == "Imagine - Grok")
    if hwnd is None:
        hwnd = find_window(lambda title: "Edge" in title and "Grok" in title)
    if hwnd is None:
        raise RuntimeError("No Grok window found")

    ShowWindow(hwnd, SW_RESTORE)
    time.sleep(0.4)
    BringWindowToTop(hwnd)
    SetForegroundWindow(hwnd)
    time.sleep(0.5)
    ShowWindow(hwnd, SW_MAXIMIZE)
    time.sleep(1.5)
    pyautogui.moveTo(200, 120, duration=0.2)
    time.sleep(0.2)


def snap(name: str) -> None:
    ImageGrab.grab(all_screens=True).save(CACHE / f"{name}.png")


def click(x: int, y: int, pause: float = 0.8) -> None:
    pyautogui.click(x, y)
    time.sleep(pause)


def main() -> None:
    pyautogui.FAILSAFE = True

    minimize_codex()
    focus_grok()
    snap("00-front")
    snap("01-imagine")

    # Prompt area.
    focus_grok()
    click(1480, 1770)

    # Switch to video and use a landscape probe.
    click(1240, 1828)
    click(1448, 1827)
    click(1448, 1746)

    prompt = (
        "Create a 6-second premium editorial news teaser about Ethiopia. "
        "Dark cinematic motion-graphics package, red-gold-green accent lighting, "
        "subtle map contours, floating headlines, elegant lower-third bars, clean modern newsroom pacing. "
        "Audio: an off-screen professional female news reporter clearly says, "
        "'This week in Ethiopia, dialogue, elections and investment drive the headlines.' "
        "No visible presenter on screen, no watermarks, no logos, polished broadcast sound."
    )
    pyperclip.copy(prompt)
    focus_grok()
    pyautogui.hotkey("ctrl", "v")
    time.sleep(1.2)

    snap("02-filled")

    # Submit.
    focus_grok()
    click(2470, 1818, pause=2.0)
    snap("03-submitted")

    for i, wait_s in enumerate((12, 24, 36), start=1):
        time.sleep(wait_s)
        focus_grok()
        snap(f"poll-{i:02d}")


if __name__ == "__main__":
    main()
