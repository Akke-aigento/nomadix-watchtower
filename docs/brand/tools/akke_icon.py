"""Studio Akke-icoonfamilie (basis: Akke Mail).

Elk product = dezelfde zeshoek met verloop (teal -> cyaan -> hemelsblauw),
de uitsparing + stip rechtsboven, en een eigen kern in het midden.

Gebruik:  python3 docs/brand/tools/akke_icon.py <kern> <uitvoermap>
Kernen:   mail (ruit), watchtower (lens). Nieuwe tak = nieuwe kern in KERN.
Vereist:  pip install cairosvg ; ImageMagick (convert) voor favicon.ico
"""
import sys, subprocess, pathlib, cairosvg

BG = "#0b1a2e"  # achtergrond app-iconen, gelijk aan Akke Mail
GRAD = ("#14b8a6", "#06b6d4", "#0ea5e9")
DOT = "#0ea5e9"

KERN = {
    "mail": '<path d="M16 11.8 L21.5 16 L16 20.2 L10.5 16 Z" fill="url(#g)"/>',
    "watchtower": '<circle cx="16" cy="16" r="4.6" stroke="url(#g)" stroke-width="2" fill="none"/>'
                  '<circle cx="16" cy="16" r="1.9" fill="url(#g)"/>',
}

def mark(kern: str) -> str:
    """Het teken op 32x32, zonder achtergrond."""
    return (
        '<defs><linearGradient id="g" x1="5" y1="3.5" x2="27" y2="28.5" gradientUnits="userSpaceOnUse">'
        f'<stop offset="0" stop-color="{GRAD[0]}"/><stop offset=".5" stop-color="{GRAD[1]}"/><stop offset="1" stop-color="{GRAD[2]}"/></linearGradient>'
        '<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32"><rect width="32" height="32" fill="#fff"/>'
        '<circle cx="27" cy="9.75" r="5.6" fill="#000"/></mask></defs>'
        '<path d="M16 3.5 L27 9.75 L27 22.25 L16 28.5 L5 22.25 L5 9.75 Z" stroke="url(#g)" stroke-width="3" '
        'stroke-linejoin="round" fill="none" mask="url(#m)"/>'
        f'<circle cx="27" cy="9.75" r="3.5" fill="{DOT}"/>' + KERN[kern]
    )

def svg_mark(kern: str) -> str:
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">{mark(kern)}</svg>'

def svg_tile(kern: str, size: int, pad: float) -> str:
    s = size * (1 - 2 * pad) / 32
    o = size * pad
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">'
            f'<rect width="{size}" height="{size}" fill="{BG}"/><g transform="translate({o},{o}) scale({s})">{mark(kern)}</g></svg>')

def build(kern: str, out: pathlib.Path):
    out.mkdir(parents=True, exist_ok=True)
    (out / "logo-mark.svg").write_text(svg_mark(kern))
    (out / "favicon.svg").write_text(svg_mark(kern))
    for name, size, pad in [("icon-192.png", 192, .18), ("icon-512.png", 512, .18),
                            ("icon-maskable-512.png", 512, .28), ("apple-touch-icon.png", 180, .18),
                            ("favicon-32.png", 32, .06)]:
        cairosvg.svg2png(bytestring=svg_tile(kern, size, pad).encode(), write_to=str(out / name))
    cairosvg.svg2png(bytestring=svg_tile(kern, 64, .06).encode(), write_to=str(out / "_fav64.png"))
    subprocess.run(["convert", str(out / "_fav64.png"), "-define", "icon:auto-resize=48,32,16", str(out / "favicon.ico")], check=True)
    (out / "_fav64.png").unlink()

if __name__ == "__main__":
    build(sys.argv[1], pathlib.Path(sys.argv[2]))
