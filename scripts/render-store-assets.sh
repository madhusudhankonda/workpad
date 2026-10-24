#!/usr/bin/env sh
# Renders the Chrome Web Store icon and promo tiles from store-assets/src with headless Chrome.
set -eu

chrome=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
src="$(cd "$(dirname "$0")/../store-assets/src" && pwd)"
out="$(cd "$(dirname "$0")/../store-assets" && pwd)"

render() { # name width height
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --window-size="$2,$3" \
    --screenshot="$out/$1.png" "file://$src/$1.html" >/dev/null 2>&1
}

render icon-128 128 128
render small-promo-440x280 440 280
render marquee-promo-1400x560 1400 560

# The store icon keeps its transparent padding; promo tiles must be 24-bit PNG without alpha.
python3 - "$out" <<'EOF'
import sys
from PIL import Image
out = sys.argv[1]
for name in ["small-promo-440x280", "marquee-promo-1400x560"]:
    path = f"{out}/{name}.png"
    Image.open(path).convert("RGB").save(path)
for name in ["icon-128", "small-promo-440x280", "marquee-promo-1400x560"]:
    image = Image.open(f"{out}/{name}.png")
    print(f"{name}.png {image.size[0]}x{image.size[1]} {image.mode}")
EOF
