"""Icono LIGUX = logo de la foto de Tomas (pecten oficial) sobre blanco opaco."""
from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(r"E:\reportador")
WIKI = ROOT / "assets" / "shell-wiki.svg"
PHOTO = ROOT / "assets" / "tomas-shell.jpg"
PHOTO_TG = Path(r"E:\escuchadores-bot\data\general\1787099467687-general-1.jpg")
WHITE = (255, 255, 255)


def render_svg(size: int) -> Image.Image:
    import fitz

    svg = WIKI.read_text(encoding="utf8")
    doc = fitz.open(stream=svg.encode("utf8"), filetype="svg")
    page = doc[0]
    zoom = size / max(page.rect.width, page.rect.height, 1)
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=True)
    return Image.frombytes("RGBA", (pix.width, pix.height), pix.samples)


def from_photo() -> Image.Image:
    src = PHOTO_TG if PHOTO_TG.exists() else PHOTO
    im = Image.open(src).convert("RGBA")
    px = im.load()
    w, h = im.size
    xs, ys = [], []
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 20:
                continue
            if r > 245 and g > 245 and b > 245:
                continue
            xs.append(x)
            ys.append(y)
    if not xs:
        return im
    pad = 4
    box = (
        max(0, min(xs) - pad),
        max(0, min(ys) - pad),
        min(w, max(xs) + pad + 1),
        min(h, max(ys) + pad + 1),
    )
    return im.crop(box)


def master_pecten(size: int = 2048) -> Image.Image:
    if WIKI.exists() and WIKI.stat().st_size > 400:
        try:
            im = render_svg(size)
            if im.getbbox():
                return im
        except Exception as e:
            print("svg:", e)
    return from_photo()


def on_white(src: Image.Image, size: int, fill: float = 0.86) -> Image.Image:
    out = Image.new("RGB", (size, size), WHITE)
    bbox = src.getbbox() if src.mode == "RGBA" else None
    shield = src.crop(bbox) if bbox else src
    if shield.mode != "RGBA":
        shield = shield.convert("RGBA")
    sw, sh = shield.size
    target = int(size * fill)
    scale = min(target / max(sw, 1), target / max(sh, 1))
    nw, nh = max(1, int(sw * scale)), max(1, int(sh * scale))
    resized = shield.resize((nw, nh), Image.Resampling.LANCZOS)
    layer = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    layer.paste(resized, ((size - nw) // 2, (size - nh) // 2), resized)
    out.paste(layer.convert("RGB"), (0, 0), layer)
    # force every transparent leftover to white
    return Image.alpha_composite(Image.new("RGBA", (size, size), (255, 255, 255, 255)), layer).convert("RGB")


def save(im: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.convert("RGB").save(path, "PNG")


def save_rgba(im: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.convert("RGBA").save(path, "PNG")


def on_transparent(src: Image.Image, size: int, fill: float = 0.66) -> Image.Image:
    bbox = src.getbbox() if src.mode == "RGBA" else None
    shield = src.crop(bbox) if bbox else src
    if shield.mode != "RGBA":
        shield = shield.convert("RGBA")
    sw, sh = shield.size
    target = int(size * fill)
    scale = min(target / max(sw, 1), target / max(sh, 1))
    nw, nh = max(1, int(sw * scale)), max(1, int(sh * scale))
    resized = shield.resize((nw, nh), Image.Resampling.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(resized, ((size - nw) // 2, (size - nh) // 2), resized)
    return out


def circle_on_white(src: Image.Image, size: int, fill: float = 0.86) -> Image.Image:
    from PIL import ImageDraw

    sq = on_white(src, size, fill)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((1, 1, size - 2, size - 2), fill=255)
    rgba = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    layer = sq.convert("RGBA")
    layer.putalpha(mask)
    return Image.alpha_composite(rgba, layer).convert("RGB")


ADAPTIVE_XML = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_shell_fg"/>
</adaptive-icon>
"""


def main() -> None:
    if PHOTO_TG.exists():
        shutil.copy2(PHOTO_TG, PHOTO)
    raw = master_pecten(2048)
    save(raw.convert("RGBA"), ROOT / "assets" / "shell-pecten.png")

    for size, rel in [
        (1024, "public/icons/icon-source.png"),
        (512, "public/icons/icon-512.png"),
        (192, "public/icons/icon-192.png"),
    ]:
        save(on_white(raw, size), ROOT / rel)

    master = on_white(raw, 1024)
    save(master, ROOT / "resources" / "icon.png")
    save(master, ROOT / "assets" / "logo.png")
    save(master, ROOT / "assets" / "ligux-shield-icon.png")

    splash = on_white(raw, 1024, 0.55)
    for p in (ROOT / "android" / "app" / "src" / "main" / "res").rglob("splash.png"):
        save(splash, p)
    save(splash, ROOT / "resources" / "splash.png")
    save(splash, ROOT / "assets" / "splash.png")

    mips = {
        "mipmap-ldpi": 36,
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }
    fg_sizes = {
        "mipmap-ldpi": 81,
        "mipmap-mdpi": 108,
        "mipmap-hdpi": 162,
        "mipmap-xhdpi": 216,
        "mipmap-xxhdpi": 324,
        "mipmap-xxxhdpi": 432,
    }
    for name, sz in mips.items():
        d = ROOT / "android" / "app" / "src" / "main" / "res" / name
        icon = on_white(raw, sz, 0.86)
        round_icon = circle_on_white(raw, sz, 0.86)
        fg = on_transparent(raw, fg_sizes[name], 0.66)
        for fname in (
            "ic_shell.png",
            "ic_ligux.png",
            "ic_launcher.png",
        ):
            save(icon, d / fname)
        for fname in (
            "ic_shell_round.png",
            "ic_ligux_round.png",
            "ic_launcher_round.png",
        ):
            save(round_icon, d / fname)
        save_rgba(fg, d / "ic_shell_fg.png")
        save_rgba(fg, d / "ic_ligux_fg.png")
        for extra in ("ic_launcher_foreground.png", "ic_launcher_background.png"):
            p = d / extra
            if p.exists():
                p.unlink()

    # Sin icono adaptativo: Configuración de Android a veces muestra el viejo
    # (el 11 negro) si hay mipmap-anydpi-v26. El PNG cuadrado blanco + Shell
    # es el que se ve en Info de la app y en el escritorio.
    anydpi = ROOT / "android" / "app" / "src" / "main" / "res" / "mipmap-anydpi-v26"
    if anydpi.exists():
        shutil.rmtree(anydpi)

    man = ROOT / "android" / "app" / "src" / "main" / "AndroidManifest.xml"
    body = man.read_text(encoding="utf-8")
    body = body.replace('android:icon="@mipmap/ic_launcher"', 'android:icon="@mipmap/ic_shell"')
    body = body.replace('android:icon="@mipmap/ic_ligux"', 'android:icon="@mipmap/ic_shell"')
    body = body.replace('android:roundIcon="@mipmap/ic_launcher_round"', 'android:roundIcon="@mipmap/ic_shell_round"')
    body = body.replace('android:roundIcon="@mipmap/ic_ligux_round"', 'android:roundIcon="@mipmap/ic_shell_round"')
    man.write_text(body, encoding="utf-8")

    (ROOT / "android" / "app" / "src" / "main" / "res" / "values" / "ic_launcher_background.xml").write_text(
        """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#FFFFFFFF</color>
</resources>
""",
        encoding="utf-8",
    )
    im = Image.open(ROOT / "android/app/src/main/res/mipmap-xxxhdpi/ic_ligux.png")
    print("mode", im.mode, "corner", im.getpixel((0, 0)), "center", im.getpixel((im.size[0] // 2, im.size[1] // 2)))
    if im.mode != "RGB":
        raise SystemExit(f"tiene que ser RGB, es {im.mode}")
    if im.getpixel((0, 0)) != (255, 255, 255):
        raise SystemExit("esquina no blanca")
    print("ok")


if __name__ == "__main__":
    main()
