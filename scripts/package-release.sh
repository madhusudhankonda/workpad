#!/usr/bin/env sh
set -eu

version=$(node -p "require('./package.json').version")
archive="workpad-${version}.zip"

test -d dist
rm -f "$archive"
# The manifest "key" pins the store extension ID for local unpacked builds; the Chrome Web Store rejects it in uploads.
staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT
cp -R dist/. "$staging/"
node -e 'const fs = require("fs"); const path = process.argv[1]; const manifest = JSON.parse(fs.readFileSync(path, "utf8")); delete manifest.key; fs.writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");' "$staging/manifest.json"
(cd "$staging" && zip -X -q -r "$OLDPWD/$archive" .)
node -e 'const { execSync } = require("child_process"); const manifest = JSON.parse(execSync(`unzip -p ${process.argv[1]} manifest.json`)); if ("key" in manifest) { console.error("manifest key must not be in the store package"); process.exit(1); }' "$archive"
printf '%s\n' "$archive"
