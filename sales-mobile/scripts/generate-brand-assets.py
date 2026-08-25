"""Generate Expo icon / splash / notification PNGs for DZ Sotuvchi."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[1] / "assets"
GREEN = (22, 101, 52)
GREEN_DARK = (15, 76, 39)
WHITE = (255, 255, 255)


def try_font(size: int) -> ImageFont.ImageFont:
    for name in (
        r"C:\Windows\Fonts\segoeuib.ttf",
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\arial.ttf",
    ):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def make_icon(size: int, path: Path) -> None:
    img = Image.new("RGBA", (size, size), GREEN + (255,))
    draw = ImageDraw.Draw(img)
    margin = int(size * 0.12)
    draw.ellipse([margin, margin, size - margin, size - margin], fill=GREEN_DARK + (255,))
    font = try_font(int(size * 0.36))
    text = "DZ"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((size - tw) / 2, (size - th) / 2 - size * 0.04), text, font=font, fill=WHITE)
    img.save(path, "PNG")
    print("wrote", path)


def make_adaptive_foreground(size: int, path: Path) -> None:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    m = int(size * 0.18)
    draw.ellipse([m, m, size - m, size - m], fill=GREEN + (255,))
    font = try_font(int(size * 0.28))
    text = "DZ"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((size - tw) / 2, (size - th) / 2 - size * 0.03), text, font=font, fill=WHITE)
    img.save(path, "PNG")
    print("wrote", path)


def make_splash(size: int, path: Path) -> None:
    img = Image.new("RGBA", (size, size), GREEN + (255,))
    draw = ImageDraw.Draw(img)
    box = int(size * 0.28)
    left = (size - box) // 2
    top = (size - box) // 2 - int(size * 0.04)
    radius = int(box * 0.18)
    draw.rounded_rectangle([left, top, left + box, top + box], radius=radius, fill=WHITE)
    font = try_font(int(box * 0.42))
    text = "DZ"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(
        (left + (box - tw) / 2, top + (box - th) / 2 - box * 0.05),
        text,
        font=font,
        fill=GREEN,
    )
    img.save(path, "PNG")
    print("wrote", path)


def make_notif(size: int, path: Path) -> None:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse([2, 2, size - 3, size - 3], fill=WHITE)
    font = try_font(int(size * 0.45))
    text = "DZ"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((size - tw) / 2, (size - th) / 2 - 1), text, font=font, fill=WHITE)
    img.save(path, "PNG")
    print("wrote", path)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    make_icon(1024, OUT / "icon.png")
    make_adaptive_foreground(1024, OUT / "adaptive-icon.png")
    make_splash(1284, OUT / "splash-icon.png")
    make_notif(96, OUT / "notification-icon.png")
    print("done")


if __name__ == "__main__":
    main()
