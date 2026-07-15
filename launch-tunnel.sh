#!/usr/bin/env bash

# Run the app over public tunnels so a phone can reach it even when the LAN
# path is blocked (e.g. VirtualBox NAT with Wi-Fi client isolation).
#
#   - backend (:6767) is exposed via a cloudflared quick tunnel (public https URL)
#   - Expo bundles over its own --tunnel, with EXPO_PUBLIC_API_URL pointed at the
#     backend's cloudflared URL so api.ts talks to the tunnel, not the LAN IP.
#
# No HOST_IP / port-forwarding needed. Just: ./launch-tunnel.sh  then scan the QR.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Resolve cloudflared (installed to ~/.local/bin if sudo wasn't available).
CLOUDFLARED="$(command -v cloudflared || true)"
[ -z "$CLOUDFLARED" ] && [ -x "$HOME/.local/bin/cloudflared" ] && CLOUDFLARED="$HOME/.local/bin/cloudflared"
if [ -z "$CLOUDFLARED" ]; then
  echo "✗ cloudflared not found. Install it, then re-run." >&2
  exit 1
fi

BACKEND_PID=""; CF_PID=""
cleanup() {
  echo
  [ -n "$CF_PID" ]      && { echo "→ stopping cloudflared ($CF_PID)"; kill "$CF_PID" 2>/dev/null || true; }
  [ -n "$BACKEND_PID" ] && { echo "→ stopping backend ($BACKEND_PID)"; kill "$BACKEND_PID" 2>/dev/null || true; }
}
trap cleanup EXIT INT TERM

# Start the backend only if nothing is already listening on 6767.
if ss -tlnp 2>/dev/null | grep -q ':6767 '; then
  echo "→ backend already running on :6767 (reusing it)"
else
  echo "→ starting backend on :6767"
  ( cd "$ROOT/v2/server" && npm run dev ) &
  BACKEND_PID=$!
  # wait for it to answer locally
  for i in $(seq 1 30); do
    curl -sf --max-time 2 http://localhost:6767/health >/dev/null 2>&1 && break
    sleep 1
  done
fi

# Bring up the cloudflared quick tunnel and capture its public URL.
CF_LOG="$(mktemp)"
echo "→ opening cloudflared tunnel for the backend..."
"$CLOUDFLARED" tunnel --url http://localhost:6767 --no-autoupdate > "$CF_LOG" 2>&1 &
CF_PID=$!

API_URL=""
for i in $(seq 1 40); do
  API_URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$CF_LOG" | head -1 || true)"
  REG="$(grep -c 'Registered tunnel connection' "$CF_LOG" 2>/dev/null || true)"
  [ -n "$API_URL" ] && [ "${REG:-0}" -ge 1 ] 2>/dev/null && break
  sleep 1
done
if [ -z "$API_URL" ]; then
  echo "✗ cloudflared did not produce a URL. Log:" >&2
  tail -20 "$CF_LOG" >&2
  exit 1
fi
# Give the edge a few seconds to finish propagating before the app hits it.
sleep 4
echo "→ backend tunnel: $API_URL   (health: $API_URL/health)"

# Start Expo over its own tunnel, pointing the app's API base at the backend tunnel.
cd "$ROOT/v2/app"
EXPO_PUBLIC_API_URL="$API_URL" \
  npx expo start --tunnel --port 6768
