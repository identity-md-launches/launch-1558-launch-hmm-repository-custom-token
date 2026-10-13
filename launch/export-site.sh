#!/usr/bin/env bash
# Builds the production site (mainnet, contract addresses discovered at runtime through the GenesisForwarder) and exports
# it as a tiny repo with a prebuilt `dist/`, which the IMD swarm can host on IPFS under <label>.sites.imd.fun
# (see launch/site-body.json, built by launch/build-site-body.mjs). Works before the launch: the site shows its
# pre-launch state until the forwarder's Forwarded event exists.
#
# Usage: launch/export-site.sh <github-account> [dest]
set -euo pipefail
TERMS="${HMM_SCAN_TERMS:-$HOME/.hmm/scan-terms}"
[ -s "$TERMS" ] || { echo "missing $TERMS (one identifying term per line, kept outside the repo)" >&2; exit 1; }
ACCOUNT="${1:?usage: launch/export-site.sh <github-account> [dest]}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${2:-$SRC/../hmm-site}"
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH"
FORWARDER="$(python3 -I -c "import json,sys;print(json.load(open(sys.argv[1]))['forwarder'])" "$SRC/launch/config.json")"

cd "$SRC/web"
[ -d node_modules ] || npm ci --no-audit --no-fund
VITE_CHAIN_ID=1 VITE_FORWARDER="$FORWARDER" VITE_FORWARDER_BLOCK="${FORWARDER_BLOCK:-}" \
  VITE_RPC_URL="${MAINNET_PUBLIC_RPC:-https://ethereum-rpc.publicnode.com}" VITE_CHECK_URL="${CHECK_URL:-}" npm run build

rm -rf "$DEST"
mkdir -p "$DEST"
cp -r dist "$DEST/dist"
cat > "$DEST/README.md" <<'EOF'
# hmm — site

The static export of hmm's site (`dist/`). Source and contracts: see the hmm repository.
EOF
if grep -rniEf "$TERMS" "$DEST" --exclude-dir=lib --exclude-dir=node_modules; then
  echo "identifying text found above; fix before publishing" >&2
  exit 1
fi
cd "$DEST"
git init -q -b main
git -c user.name="hmm contributors" -c user.email="contributors@hmm.invalid" add -A
git -c user.name="hmm contributors" -c user.email="contributors@hmm.invalid" commit -q -m "hmm site"
git remote add origin "git@github-hmm:${ACCOUNT}/hmm-site.git"
echo "exported to $DEST ($(du -sh dist | cut -f1))"
echo "commit $(git rev-parse HEAD)"
