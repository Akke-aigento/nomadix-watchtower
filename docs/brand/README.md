# Studio Akke-icoonfamilie

Basis: **Akke Mail** (Lovable-project Nomadix Mail, `public/merk/akke-mail-icoon.svg`). Elk product van Studio Akke/Nomadix volgt dezelfde vorm:

| Onderdeel | Waarde |
|---|---|
| Frame | zeshoek, lijndikte 3 op 32×32, `stroke-linejoin: round` |
| Verloop | `#14b8a6` → `#06b6d4` → `#0ea5e9` (linksboven → rechtsonder) |
| Stip | rechtsboven op de hoek (27, 9.75), r 3.5, `#0ea5e9`, met uitsparing r 5.6 in het frame |
| Achtergrond app-icoon | `#0b1a2e` (ook `theme_color`) |
| Kern | het enige dat per product verschilt |

## Kernen

| Product | Kern |
|---|---|
| Akke Mail | ruit |
| Watchtower | lens (ring + pupil) |

Een nieuwe tak = één nieuwe kern in `tools/akke_icon.py` (`KERN`), daarna:

```bash
pip install cairosvg   # + ImageMagick voor favicon.ico
python3 docs/brand/tools/akke_icon.py watchtower public
```

Dat maakt `logo-mark.svg`, `favicon.svg`, `favicon.ico`, `favicon-32.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` en `icon-maskable-512.png`.

## Let op

- iOS bewaart het icoon van een beginscherm-app. Na een icoonwijziging: app van het beginscherm verwijderen en opnieuw "Zet op beginscherm" doen.
- Lettertypen in de familie: Manrope (tekst) en JetBrains Mono (cijfers/labels), zoals Akke Mail.
