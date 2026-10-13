#!/usr/bin/env bash
# Starts the hmm devnet: an anvil fork of Ethereum mainnet on :9645 (chain id 31337), hmm launched through the real
# IMD ProjectFactory, IMD for anvil's first five accounts, and the simulated swarm that answers questions.
# Usage: devnet/start.sh            (FORK_URL defaults to the local mainnet node at http://127.0.0.1:8545)
#        devnet/stop.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$HOME/.nvm/versions/node/v22.23.3/bin:$PATH"

FORK_URL="${FORK_URL:-http://127.0.0.1:8545}"
PORT="${DEVNET_PORT:-9645}"
RUN=devnet/.run
mkdir -p "$RUN" deployments

if [ -f "$RUN/anvil.pid" ] && kill -0 "$(cat "$RUN/anvil.pid")" 2>/dev/null; then
  echo "devnet already running (anvil pid $(cat "$RUN/anvil.pid")); devnet/stop.sh first" >&2
  exit 1
fi

nohup anvil --fork-url "$FORK_URL" --port "$PORT" --host 127.0.0.1 --chain-id 31337 --auto-impersonate \
  --silent > "$RUN/anvil.log" 2>&1 &
echo $! > "$RUN/anvil.pid"
for _ in $(seq 1 60); do
  cast block-number --rpc-url "http://127.0.0.1:$PORT" >/dev/null 2>&1 && break
  sleep 1
done
echo "anvil fork up on :$PORT at block $(cast block-number --rpc-url "http://127.0.0.1:$PORT")"

FOUNDRY_PROFILE=devnet DEVNET_RPC_URL="http://127.0.0.1:$PORT" forge script script/Devnet.s.sol --rpc-url "http://127.0.0.1:$PORT" \
  --broadcast --unlocked --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --slow > "$RUN/deploy.log" 2>&1 \
  || { tail -30 "$RUN/deploy.log"; exit 1; }
grep -E "hmm devnet" "$RUN/deploy.log" || true

( cd devnet && [ -d node_modules ] || npm install --silent --no-audit --no-fund )
nohup node devnet/swarm.mjs > "$RUN/swarm.log" 2>&1 &
echo $! > "$RUN/swarm.pid"
if [ "${DEVNET_ACTIVITY:-1}" = "1" ]; then
  nohup node devnet/activity.mjs > "$RUN/activity.log" 2>&1 &
  echo $! > "$RUN/activity.pid"
fi
sleep 2
cat deployments/devnet.json
echo
echo "swarm simulator pid $(cat "$RUN/swarm.pid"); logs in $RUN/"
