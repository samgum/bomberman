"""Build the small, OFL-licensed pixel UI font from the pinned upstream release."""
from io import BytesIO
from pathlib import Path
from urllib.request import urlopen
from zipfile import ZipFile
import hashlib
import string
import sys
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
URL = "https://github.com/TakWolf/fusion-pixel-font/releases/download/2026.09.25/fusion-pixel-font-12px-proportional-otf.woff2-v2026.09.25.zip"
EXPECTED = "44b456f6f920d700f98d5865e03152d6a7357ed0a8ee388376ac0530d2d57072"
if len(sys.argv) > 1:
    data = Path(sys.argv[1]).read_bytes()
else:
    with urlopen(URL, timeout=60) as response:
        data = response.read()
assert hashlib.sha256(data).hexdigest() == EXPECTED, "Unexpected font release"
with ZipFile(BytesIO(data)) as archive:
    selected = next(name for name in archive.namelist() if "zh_hans" in name and name.endswith(".woff2"))
    font = TTFont(BytesIO(archive.read(selected)))
text = "".join(path.read_text(encoding="utf-8") for path in ROOT.glob("*.html"))
text += "".join(path.read_text(encoding="utf-8") for path in (ROOT / "app").glob("*.js")) + string.printable
options = subset.Options()
options.layout_features = ["*"]
options.name_IDs = ["*"]
options.name_languages = ["*"]
options.notdef_outline = True
subsetter = subset.Subsetter(options=options)
subsetter.populate(text=text)
subsetter.subset(font)
for name in font["name"].names:
    if name.nameID in (1, 3, 4, 6):
        value = "BomberPixelUI" if name.nameID == 6 else "Bomber Pixel UI"
        name.string = value.encode(name.getEncoding())
font.flavor = "woff2"
font.save(ROOT / "assets" / "ui-pixel.woff2")
print(f"Generated {len(font.getBestCmap())} glyphs in assets/ui-pixel.woff2")
