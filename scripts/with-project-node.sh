#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
    echo "nvm not found at $NVM_DIR/nvm.sh" >&2
    exit 1
fi

# shellcheck source=/dev/null
source "$NVM_DIR/nvm.sh"

cd "$PROJECT_ROOT"
nvm use --silent >/dev/null

exec "$@"
