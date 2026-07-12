#!/bin/sh
set -eu

CONFIG=/etc/nginx/sites-enabled/evohub
sync_upstream() {
  LABEL=$1
  PORT=$2
  CONTAINER=$(docker ps --filter "label=coolify.resourceName=$LABEL" --format '{{.Names}}' | head -n 1)
  [ -n "$CONTAINER" ] || return 0

  IP=$(docker inspect "$CONTAINER" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
  [ -n "$IP" ] || return 0

  CURRENT=$(sed -nE "s#.*proxy_pass http://(10\\.0\\.2\\.[0-9]+):$PORT;.*#\\1#p" "$CONFIG" | head -n 1)
  [ "$CURRENT" = "$IP" ] && return 0

  sed -i -E "s#proxy_pass http://10\\.0\\.2\\.[0-9]+:$PORT;#proxy_pass http://$IP:$PORT;#g" "$CONFIG"
  CHANGED=1
}

CHANGED=0
sync_upstream evohub-bridge 8000
sync_upstream evohub-dashboard 3000

if [ "$CHANGED" -eq 1 ]; then
  nginx -t
  systemctl reload nginx
fi
