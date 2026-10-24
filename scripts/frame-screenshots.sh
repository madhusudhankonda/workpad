#!/usr/bin/env sh
# Frames real side panel captures from store-assets/raw into 1280x800 Chrome Web Store screenshots.
# Captions come from store-assets/screenshots.json; captures missing from raw are skipped.
set -eu

chrome=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
assets="$(cd "$(dirname "$0")/../store-assets" && pwd)"
mkdir -p "$assets/screenshots"

python3 - "$assets" <<'EOF' | while IFS="$(printf '\t')" read -r name url; do
import json, sys, urllib.parse
assets = sys.argv[1]
for shot in json.load(open(f"{assets}/screenshots.json")):
    query = urllib.parse.urlencode({"image": f"../raw/{shot['file']}", "title": shot["title"], "subtitle": shot["subtitle"]})
    print(f"{shot['file']}\tfile://{assets}/src/screenshot-frame.html?{query}")
EOF
  if [ ! -f "$assets/raw/$name" ]; then echo "skip $name (not in store-assets/raw)"; continue; fi
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --allow-file-access-from-files --window-size=1280,800 \
    --screenshot="$assets/screenshots/$name" "$url" >/dev/null 2>&1
  # Chrome requires screenshots as 24-bit PNG without alpha.
  python3 -c 'import sys; from PIL import Image; Image.open(sys.argv[1]).convert("RGB").save(sys.argv[1])' "$assets/screenshots/$name"
  echo "framed screenshots/$name"
done
