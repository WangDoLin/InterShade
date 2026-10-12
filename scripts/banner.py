#!/usr/bin/env python3
"""INTERSHADE terminal banner: Hermes Agent ANSI Shadow box-drawing font with Gold/Amber/Bronze gradient."""
from __future__ import annotations

import os
import re
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# Hermes Agent 3-tier color palette
GOLD = "\033[38;5;220m"
AMBER = "\033[38;5;214m"
BRONZE = "\033[38;5;172m"
DIM = "\033[38;5;137m"
RESET = "\033[0m"

LOGO_ART = [
    "██╗███╗   ██╗████████╗███████╗██████╗     ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗",
    "██║████╗  ██║╚══██╔══╝██╔════╝██╔══██╗    ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝",
    "██║██╔██╗ ██║   ██║   █████╗  ██████╔╝    ███████╗███████║███████║██║  ██║█████╗  ",
    "██║██║╚██╗██║   ██║   ██╔══╝  ██╔══██╗    ╚════██║██╔══██║██╔══██║██║  ██║██╔══╝  ",
    "██║██║ ╚████║   ██║   ███████╗██║  ██║    ███████║██║  ██║██║  ██║██████╔╝███████╗",
    "╚═╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝╚═╝  ╚═╝    ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚══════╝",
]

GRADIENT = [GOLD, GOLD, AMBER, AMBER, BRONZE, BRONZE]
TAGLINE = "WANG DO LIN  |  AGENTIC CODING"
LOGO_WIDTH = max(len(line) for line in LOGO_ART)


def color_enabled() -> bool:
    return sys.stdout.isatty() and "NO_COLOR" not in os.environ and os.environ.get("TERM", "") != "dumb"


def render_art(use_color: bool) -> list[str]:
    lines: list[str] = []
    for i, line in enumerate(LOGO_ART):
        if use_color:
            color = GRADIENT[i]
            lines.append(f"{color}{line}{RESET}")
        else:
            lines.append(line)
    return lines


def strip_ansi(value: str) -> str:
    return re.sub(r"\x1b\[[0-9;]*m", "", value)


def main() -> None:
    use_color = color_enabled()
    art = render_art(use_color)
    print()
    for line in art:
        print(line)
    print()
    centered_tagline = TAGLINE.center(LOGO_WIDTH)
    if use_color:
        print(f"{DIM}{centered_tagline}{RESET}")
    else:
        print(centered_tagline)
    print()


if __name__ == "__main__":
    main()
