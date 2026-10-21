#!/usr/bin/env sh
set -eu

version=$(node -p "require('./package.json').version")
archive="workpad-${version}.zip"

test -d dist
rm -f "$archive"
(cd dist && zip -X -q -r "../$archive" .)
printf '%s\n' "$archive"
