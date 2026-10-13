#!/usr/bin/env bash
# Exports a clean copy of this repository for the public launch repo: tracked files only, a fresh one-commit history
# with a neutral author, and a scan for anything identifying. The swarm imports only public GitHub repositories, and
# the launch request pins the commit this prints.
#
# Usage: launch/export-public.sh <github-account> [dest]
#   then: cd <dest> && git push -u origin main      (remote uses the github-hmm SSH alias / ~/.ssh/hmm_ed25519)
set -euo pipefail
TERMS="${HMM_SCAN_TERMS:-$HOME/.hmm/scan-terms}"
[ -s "$TERMS" ] || { echo "missing $TERMS (one identifying term per line, kept outside the repo)" >&2; exit 1; }
ACCOUNT="${1:?usage: launch/export-public.sh <github-account> [dest]}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${2:-$SRC/../hmm-public}"

rm -rf "$DEST"
mkdir -p "$DEST"
(cd "$SRC" && git ls-files -z | xargs -0 tar cf -) | (cd "$DEST" && tar xf -)

# nothing that points at a person, another project or this server; the terms live outside the repo
if grep -rniEf "$TERMS" "$DEST" --exclude-dir=lib --exclude-dir=node_modules; then
  echo "identifying text found above; fix before publishing" >&2
  exit 1
fi

cd "$DEST"
git init -q -b main
git -c user.name="hmm contributors" -c user.email="contributors@hmm.invalid" add -A
git -c user.name="hmm contributors" -c user.email="contributors@hmm.invalid" commit -q -m "hmm: proof of thought"
git remote add origin "git@github-hmm:${ACCOUNT}/hmm.git"
echo "exported to $DEST"
echo "commit $(git rev-parse HEAD)"
echo "next: create the public repo ${ACCOUNT}/hmm on GitHub (empty), add ~/.ssh/hmm_ed25519.pub to that account, then"
echo "      cd $DEST && git push -u origin main"
