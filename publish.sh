#!/bin/bash

set -e

PACKAGES=("core" "react" "vue")

for pkg in "${PACKAGES[@]}"
do
  echo "📦 Publishing @epikoder/valync-$pkg..."
  cd "packages/$pkg"

  # Double-check package is versioned and ready
  if grep -q '"private": true' package.json; then
    echo "❌ Skipping @epikoder/valync-$pkg (marked private)"
  else
    pnpm publish --access public
  fi

  cd - > /dev/null
done

echo "✅ All packages published (if not private)."
