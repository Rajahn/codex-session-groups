#!/bin/zsh
set -euo pipefail

cd -- "${0:A:h}"
exec /usr/bin/env node scripts/codex-injector.mjs --launch --watch
