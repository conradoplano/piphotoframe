"""Pre-compose photos at exact screen resolution so the browser only has to cross-fade."""

from __future__ import annotations

import io
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter, ImageOps

from .util import write_atomic

# Photos whose aspect ratio is within this tolerance of the screen are simply cropped.
NEAR_FIT = 0.12


def validate_image(data: bytes) -> None:
    with Image.open(io.BytesIO(data)) as im:
        im.verify()


def compose(im: Image.Image, mode: str, size: tuple[int, int]) -> Image.Image:
    W, H = size
    w, h = im.size
    if mode == "cover" or abs((w / h) / (W / H) - 1) < NEAR_FIT:
        return ImageOps.fit(im, size, Image.Resampling.LANCZOS, centering=(0.5, 0.45))

    scale = min(W / w, H / h)
    fg = im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.Resampling.LANCZOS)
    if mode == "contain":
        canvas = Image.new("RGB", size, (0, 0, 0))
    else:  # blur: the photo itself, blurred and darkened, fills the empty space
        small = ImageOps.fit(im, (W // 10, H // 10), Image.Resampling.BILINEAR)
        small = small.filter(ImageFilter.GaussianBlur(3))
        canvas = small.resize(size, Image.Resampling.BICUBIC)
        canvas = ImageEnhance.Brightness(canvas).enhance(0.6)
    canvas.paste(fg, ((W - fg.width) // 2, (H - fg.height) // 2))
    return canvas


def render(src: Path, dst: Path, mode: str, size: tuple[int, int]) -> None:
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
    out = compose(im, mode, size)
    buf = io.BytesIO()
    out.save(buf, "JPEG", quality=88)
    write_atomic(dst, buf.getvalue())
