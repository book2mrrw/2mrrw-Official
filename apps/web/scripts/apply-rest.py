#!/usr/bin/env python3
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
patch_src = (ROOT / "scripts/phase1-ui-patch.py").read_text()
P = ROOT / "src/app/page.js"
c = P.read_text()

def extract(name, next_name):
    m = re.search(rf"{name} = '''(.*?)'''\n\n{next_name}", patch_src, re.DOTALL)
    if not m:
        raise SystemExit(f"missing {name}")
    return m.group(1)

SINGLE = extract("SINGLE", "ALBUM")
ALBUM = extract("ALBUM", "NOW_DESKTOP")
MOBILE_UI = extract("MOBILE_UI", "STRIPE")
STRIPE = extract("STRIPE", "# Apply")

def sub(pat, repl, label):
    global c
    c2, n = re.subn(pat, repl, c, count=1, flags=re.DOTALL)
    print(("OK" if n else "FAIL"), label)
    if n:
        c = c2

sub(
    r"      \{/\* ── SINGLE MODAL ── \*/\}.*?\n\n      \{/\* ── ALBUM MODAL",
    SINGLE + "\n\n      {/* ── ALBUM MODAL",
    "single",
)
sub(
    r"      \{/\* ── ALBUM MODAL ── \*/\}.*?\n\n      \{/\* ── TICKET MODAL",
    ALBUM + "\n\n      {/* ── TICKET MODAL",
    "album",
)
sub(
    r"      \{/\* ── MOBILE UI ── \*/\}.*?\n\n      \{/\* ── CSS",
    MOBILE_UI + "\n\n      {/* ── CSS",
    "mobile",
)
sub(
    r"      \{/\* ── STRIPE MODAL ── \*/\}.*?\n    </>",
    STRIPE + "\n    </>",
    "stripe",
)

P.write_text(c)
print("done", len(c.splitlines()), "lines")
