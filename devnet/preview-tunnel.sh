#!/usr/bin/env bash
# Exposes the preview (devnet/preview.mjs on 127.0.0.1:5180) through a temporary Cloudflare quick tunnel: a random
# https://*.trycloudflare.com URL that does not reveal this server's address and needs no account. The URL changes on
# every start and dies with the process. Stop: kill "$(cat devnet/.run/tunnel.pid)"
set -euo pipefail
cd "$(dirname "$0")/.."
RUN=devnet/.run
mkdir -p "$RUN"
if [ -f "$RUN/tunnel.pid" ] && kill -0 "$(cat "$RUN/tunnel.pid")" 2>/dev/null; then
  grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$RUN/tunnel.log" | head -1
  exit 0
fi
nohup "$HOME/.local/bin/cloudflared" tunnel --no-autoupdate --url "http://127.0.0.1:${PREVIEW_PORT:-5180}" > "$RUN/tunnel.log" 2>&1 &
echo $! > "$RUN/tunnel.pid"
for _ in $(seq 1 60); do
  url=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$RUN/tunnel.log" | head -1 || true)
  [ -n "$url" ] && { echo "$url" | tee "$RUN/tunnel.url"; exit 0; }
  sleep 1
done
echo "tunnel did not come up; see $RUN/tunnel.log" >&2
exit 1
