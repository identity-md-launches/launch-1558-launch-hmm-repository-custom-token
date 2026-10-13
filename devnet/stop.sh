#!/usr/bin/env bash
# Stops the devnet started by devnet/start.sh. Chain state is lost; start.sh relaunches from a fresh fork.
cd "$(dirname "$0")"
for p in tunnel preview activity swarm anvil; do
  if [ -f ".run/$p.pid" ]; then
    kill "$(cat ".run/$p.pid")" 2>/dev/null && echo "stopped $p"
    rm -f ".run/$p.pid"
  fi
done
