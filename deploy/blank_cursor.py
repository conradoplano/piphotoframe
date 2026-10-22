"""Writes an invisible Xcursor theme so the kiosk shows no mouse pointer.

cage draws its default cursor in the middle of the screen until a mouse moves, which never
happens on a touch-only frame. cage ignores XCURSOR_THEME and always loads the theme called
"default", so the theme is installed as "default" in a folder of its own, and the kiosk service
sets XCURSOR_PATH to only that folder. The cursor is then a single transparent pixel.

Usage: python3 blank_cursor.py /usr/share/photoframe/icons/default
"""

import struct
import sys
from pathlib import Path

IMAGE_TYPE = 0xFFFD0002
NOMINAL_SIZE = 24
# names compositors and toolkits ask for; all get the same invisible image
NAMES = ["default", "left_ptr", "arrow", "pointer", "hand2", "text", "xterm", "watch", "wait",
         "progress", "crosshair", "grab", "grabbing", "not-allowed", "move"]


def xcursor_blank() -> bytes:
    width = height = 1
    header_size, toc_entries = 16, 1
    image_pos = header_size + 12 * toc_entries
    out = struct.pack("<4sIII", b"Xcur", header_size, 0x10000, toc_entries)
    out += struct.pack("<III", IMAGE_TYPE, NOMINAL_SIZE, image_pos)
    out += struct.pack("<IIIIIIIII", 36, IMAGE_TYPE, NOMINAL_SIZE, 1, width, height, 0, 0, 0)
    out += struct.pack("<I", 0x00000000)  # one fully transparent ARGB pixel
    return out


def main(theme_dir: Path) -> None:
    cursors = theme_dir / "cursors"
    cursors.mkdir(parents=True, exist_ok=True)
    data = xcursor_blank()
    for name in NAMES:
        (cursors / name).write_bytes(data)
    (theme_dir / "index.theme").write_text(
        "[Icon Theme]\nName=photoframe-blank\nComment=Invisible cursor for the photo frame kiosk\n")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "/usr/share/photoframe/icons/default"))
