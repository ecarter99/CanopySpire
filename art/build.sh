#!/usr/bin/env bash
# Rebuild every Blender asset into public/assets/*.glb (headless, deterministic).
#   BLENDER=/path/to/blender art/build.sh            # all assets
#   BLENDER=/path/to/blender art/build.sh character  # just one
set -euo pipefail
cd "$(dirname "$0")/.."
BLENDER="${BLENDER:-$(command -v blender || echo "$HOME/tools/blender-4.2.23-linux-x64/blender")}"
[ -x "$BLENDER" ] || { echo "Blender not found — set BLENDER=/path/to/blender (4.2 LTS)"; exit 1; }
assets=("${@:-character thornheart trees props}")
for a in ${assets[@]}; do
  echo "▶ $a"
  "$BLENDER" -b --factory-startup -P "art/blender/$a.py" 2>&1 | grep -E "EXPORTED|CHECK|Error|Traceback" || true
done
python3 art/inspect_glb.py public/assets/*.glb
