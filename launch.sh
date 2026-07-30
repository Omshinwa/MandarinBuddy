#!/usr/bin/env bash

# Run the app locally over the LAN — the normal case, when your phone and this
# machine are on the same Wi-Fi and can reach each other.
#
#   - backend (:6767) runs directly, reachable at http://<this-machine-lan-ip>:6767
#   - Expo bundles on :6768 in LAN mode
#
# EXPO_PUBLIC_API_URL is deliberately left unset: with no explicit value, the app
# derives the API host itself (guessBase in v2/app/src/lib/api.ts) — from the Expo
# dev-server host on a device, or the page origin on web — and hits port 6767 there.
#
# Just: ./launch.sh   then scan the QR. If the phone can't reach the backend
# (Wi-Fi client isolation, VPN, NAT), use ./launch-tunnel.sh instead.
#
# Extra arguments are passed through to expo, e.g:
#   ./launch.sh --web      open in the browser
#   ./launch.sh --ios      open the iOS simulator
#   ./launch.sh -c         start with the Metro cache cleared

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BACKEND_PID=""
cleanup() {
  echo
  if [ -n "$BACKEND_PID" ]; then
    echo "→ stopping backend ($BACKEND_PID)"
    # npm run dev spawns tsx underneath, so take the children down too.
    pkill -P "$BACKEND_PID" 2>/dev/null || true
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# Start the backend only if nothing is already serving on 6767. Asking /health is
# portable (the tunnel script's `ss` is Linux-only) and confirms it actually answers.
if curl -sf --max-time 2 http://localhost:6767/health >/dev/null 2>&1; then
  echo "→ backend already running on :6767 (reusing it)"
else
  echo "→ starting backend on :6767"
  ( cd "$ROOT/v2/server" && npm run dev ) &
  BACKEND_PID=$!
  ready=""
  for _ in $(seq 1 30); do
    curl -sf --max-time 2 http://localhost:6767/health >/dev/null 2>&1 && { ready=1; break; }
    sleep 1
  done
  if [ -z "$ready" ]; then
    echo "✗ backend never answered on :6767 — check v2/server/.env (MONGODB_URI)." >&2
    exit 1
  fi
fi

# Informational only: the app works this out on its own, but it's the address the
# phone will be talking to, so it's worth seeing when something doesn't connect.
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
if [ -n "$LAN_IP" ]; then
  echo "→ backend: http://$LAN_IP:6767   (health: http://$LAN_IP:6767/health)"
else
  echo "→ backend: http://localhost:6767  (no LAN IP found — a phone won't reach this)"
fi

cd "$ROOT/v2/app"
npx expo start --port 6768 "$@"
