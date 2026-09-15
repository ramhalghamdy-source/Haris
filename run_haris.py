"""Reliable one-command launcher for the HARIS local demo."""
from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser

import uvicorn

URL = "http://127.0.0.1:8000"
HEALTH_URL = URL + "/api/health"


def _open_url() -> bool:
    """Open the dashboard with a Windows-friendly fallback chain."""
    try:
        if os.name == "nt":
            # ShellExecute via os.startfile is more reliable than Python's
            # browser registry lookup on some Windows/Edge installations.
            os.startfile(URL)  # type: ignore[attr-defined]
            return True
    except Exception:
        pass

    try:
        if webbrowser.open(URL, new=2):
            return True
    except Exception:
        pass

    if os.name == "nt":
        try:
            subprocess.Popen(["cmd", "/c", "start", "", URL])
            return True
        except Exception:
            pass
    return False


def open_when_ready() -> None:
    """Wait for FastAPI to answer before opening the browser."""
    for _ in range(120):  # up to ~30 seconds, including first model load
        try:
            with urllib.request.urlopen(HEALTH_URL, timeout=0.5) as response:
                if response.status == 200:
                    opened = _open_url()
                    if opened:
                        print(f"\nDashboard opened: {URL}\n")
                    else:
                        print(f"\nCould not open the browser automatically. Open manually: {URL}\n")
                    return
        except Exception:
            time.sleep(0.25)
    print(f"\nServer startup is taking longer than expected. Try manually: {URL}\n")


if __name__ == "__main__":
    threading.Thread(target=open_when_ready, daemon=True).start()
    print("\nHARIS is starting locally...")
    print(f"Open: {URL}")
    print("Keep this window open during the demo. Press Ctrl+C to stop.\n")
    uvicorn.run("app:app", host="127.0.0.1", port=8000, log_level="warning")
