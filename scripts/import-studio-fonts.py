"""
MA62: builds `assets/fonts/studio/` (the Darkroom title + caption display fonts the phone preview
bundles) from the two lockstep font sets of docs/content-studio/design/04-title-fonts.md, and writes
`assets/fonts/studio/manifest.json` (source path + SHA-256 of every input, SHA-256 + size of every
output, the route taken). `src/studio/mobile/skia/text/__tests__/fonts.test.ts` checks the manifest
against the files and the copied `titleFonts.ts` registry.

Licence routes (each family's own licence text: the `OFL.txt` header of both directories and every
file's `name` table, IDs 0 and 13):
- OFL 1.1, no Reserved Font Name: the WEB's file (`media-manipulator-ui/public/fonts/studio`,
  latin-subset woff2: the exact glyphs the web preview draws), unwrapped to TTF (Skia 3.10.2 has no
  WOFF2 decoder: no brotli in libskia.a) and, for the css2 variable builds, instanced at wght 400 /
  700 (what the browser renders for those @font-face weights). A converted font is an OFL
  "Modified Version", allowed because no reserved name applies.
- OFL 1.1 WITH a Reserved Font Name (Raleway, Playfair Display, Merriweather, Lora, Dancing Script,
  and the caption display fonts Titan One, Lilita One, Bowlby One, Russo One): a modified version
  may not carry the reserved name, so these are the API's static TTFs (`media_manipulator_api/
  assets/fonts/studio`, the export's own files), copied byte for byte, never converted.
- DejaVu Sans (Bitstream Vera / Arev licence, not OFL): NOT bundled. The app downloads the web's
  `https://www.media-manipulator.com/fonts/studio/dejavu-sans-{400,700}.ttf` on first use.
- The caption script fallbacks (Noto Sans Hebrew / Arabic / SC / KR, 3.5 MB): not bundled; the
  preview falls back to the phone's system fonts for those scripts (approximate preview).

Run (fontTools is not an app dependency; use a throwaway venv):
  python3 -m venv /tmp/fonts && /tmp/fonts/bin/pip install fonttools==4.55.3 brotli==1.1.0
  /tmp/fonts/bin/python -I scripts/import-studio-fonts.py ../media-manipulator-ui ../media_manipulator_api
"""
import hashlib
import json
import os
import shutil
import sys

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ui_repo, api_repo = sys.argv[1], sys.argv[2]
UI = os.path.join(ui_repo, 'public', 'fonts', 'studio')
API = os.path.join(api_repo, 'assets', 'fonts', 'studio')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'fonts', 'studio')

# stem -> (family, weights, reserved font name?) ; mirrors titleFonts.ts STUDIO_TITLE_FONTS (minus DejaVu).
TITLE = [
    ('inter', 'Inter', [400, 700], False),
    ('noto-sans', 'Noto Sans', [400, 700], False),
    ('open-sans', 'Open Sans', [400, 700], False),
    ('montserrat', 'Montserrat', [400, 700], False),
    ('poppins', 'Poppins', [400, 700], False),
    ('raleway', 'Raleway', [400, 700], True),
    ('oswald', 'Oswald', [400, 700], False),
    ('bebas-neue', 'Bebas Neue', [400], False),
    ('anton', 'Anton', [400], False),
    ('playfair-display', 'Playfair Display', [400, 700], True),
    ('merriweather', 'Merriweather', [400, 700], True),
    ('lora', 'Lora', [400, 700], True),
    ('jetbrains-mono', 'JetBrains Mono', [400, 700], False),
    ('space-mono', 'Space Mono', [400, 700], False),
    ('dancing-script', 'Dancing Script', [400, 700], True),
    ('pacifico', 'Pacifico', [400], False),
]
# Caption-only display families (captionsCatalog.json fonts), all 400-only, all from the API set.
CAPTION = [
    ('bangers', 'Bangers', False),
    ('titan-one', 'Titan One', True),
    ('lilita-one', 'Lilita One', True),
    ('bowlby-one', 'Bowlby One', True),
    ('rubik-mono-one', 'Rubik Mono One', False),
    ('russo-one', 'Russo One', True),
]


def sha(p):
    with open(p, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def reserved(path):
    return 'Reserved Font Name' in (TTFont(path)['name'].getDebugName(0) or '')


if os.path.isdir(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)
files = []


def metrics(path):
    """The vertical metrics the canvas `middle` baseline uses (Blink: the OS/2 typo ascender and
    descender normalised to one em, else hhea), in font units, plus unitsPerEm."""
    t = TTFont(path)
    os2, hhea = t['OS/2'], t['hhea']
    return {'unitsPerEm': t['head'].unitsPerEm, 'typoAscender': os2.sTypoAscender,
            'typoDescender': os2.sTypoDescender, 'hheaAscender': hhea.ascent, 'hheaDescender': hhea.descent}


def emit(name, family, weight, rfn, repo, src_rel, route):
    p = os.path.join(OUT, name)
    files.append({
        'file': name, 'family': family, 'weight': weight, 'reservedFontName': rfn,
        'source': {'repo': repo, 'path': src_rel, 'sha256': sha(os.path.join(repo_dir[repo], src_rel))},
        'route': route, 'sha256': sha(p), 'bytes': os.path.getsize(p), 'metrics': metrics(p),
    })


repo_dir = {'media-manipulator-ui': ui_repo, 'media_manipulator_api': api_repo}

for stem, family, weights, rfn in TITLE:
    for w in weights:
        api_rel = os.path.join('assets', 'fonts', 'studio', f'{stem}-{w}.ttf')
        if reserved(os.path.join(api_repo, api_rel)) != rfn:
            raise SystemExit(f'{stem}-{w}: reserved-font-name flag disagrees with the font file')
        name = f'{stem}-{w}.ttf'
        if rfn:
            shutil.copyfile(os.path.join(api_repo, api_rel), os.path.join(OUT, name))
            emit(name, family, w, True, 'media_manipulator_api', api_rel, 'copied unmodified (reserved font name)')
            continue
        ui_rel = os.path.join('public', 'fonts', 'studio', f'{stem}-{w}.woff2')
        t = TTFont(os.path.join(ui_repo, ui_rel))
        t.flavor = None
        route = 'woff2 unwrapped to TTF'
        if 'fvar' in t:
            t = instancer.instantiateVariableFont(t, {'wght': w}, updateFontNames=False)
            t['OS/2'].usWeightClass = w
            route += f', variable font instanced at wght={w}'
        t.save(os.path.join(OUT, name))
        emit(name, family, w, False, 'media-manipulator-ui', ui_rel, route)

for stem, family, rfn in CAPTION:
    api_rel = os.path.join('assets', 'fonts', 'studio', f'{stem}-400.ttf')
    if reserved(os.path.join(api_repo, api_rel)) != rfn:
        raise SystemExit(f'{stem}: reserved-font-name flag disagrees with the font file')
    name = f'{stem}-400.ttf'
    shutil.copyfile(os.path.join(api_repo, api_rel), os.path.join(OUT, name))
    emit(name, family, 400, rfn, 'media_manipulator_api', api_rel, 'copied unmodified')

shutil.copyfile(os.path.join(API, 'OFL.txt'), os.path.join(OUT, 'OFL.txt'))
# DejaVu Sans is not bundled (not OFL): the app downloads the web's file on first use. Its metrics
# are recorded from the export's copy, which is the same file the web serves.
downloaded = []
for w in (400, 700):
    rel = os.path.join('public', 'fonts', 'studio', f'dejavu-sans-{w}.ttf')
    downloaded.append({'family': 'DejaVu Sans', 'weight': w, 'url': f'/fonts/studio/dejavu-sans-{w}.ttf',
                       'licence': 'Bitstream Vera / Arev (DEJAVU-LICENSE.txt): not bundled',
                       'source': {'repo': 'media-manipulator-ui', 'path': rel, 'sha256': sha(os.path.join(ui_repo, rel))},
                       'metrics': metrics(os.path.join(ui_repo, rel))})
manifest = {
    'note': 'Generated by scripts/import-studio-fonts.py (MA62). Do not edit by hand.',
    'files': files,
    'downloaded': downloaded,
    'totalBytes': sum(f['bytes'] for f in files),
}
with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
    json.dump(manifest, f, indent=2)
    f.write('\n')
print(manifest['totalBytes'], len(files))

# The vertical metrics table the title raster's `middle` baseline needs (src/studio/mobile/skia/text/fontMetrics.ts).
rows = {}
for f in files + downloaded:
    m = f['metrics']
    rows.setdefault(f['family'], {})[f['weight']] = [m['unitsPerEm'], m['typoAscender'], m['typoDescender'], m['hheaAscender'], m['hheaDescender']]
out_ts = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'studio', 'mobile', 'skia', 'text', 'fontMetrics.ts')
with open(out_ts, 'w') as f:

    f.write('// Generated by scripts/import-studio-fonts.py (MA62). Do not edit by hand.\n')
    f.write('/** family -> weight -> [unitsPerEm, OS/2 typoAscender, typoDescender, hhea ascender, hhea descender]. */\n')
    f.write('export const FONT_METRICS: Record<string, Record<number, readonly [number, number, number, number, number]>> = {\n')
    for fam in sorted(rows):
        parts = ', '.join(f'{w}: [{", ".join(str(x) for x in v)}]' for w, v in sorted(rows[fam].items()))
        f.write(f"  '{fam}': {{ {parts} }},\n")
    f.write('};\n')
