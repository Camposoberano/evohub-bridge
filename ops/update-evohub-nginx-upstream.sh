#!/bin/sh
set -eu

CONFIG=/etc/nginx/sites-enabled/evohub
CONTAINER=$(docker ps --filter label=coolify.resourceName=evohub-bridge --format '{{.Names}}' | head -n 1)

[ -n "$CONTAINER" ] || exit 0

IP=$(docker inspect "$CONTAINER" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
[ -n "$IP" ] || exit 0

CURRENT=$(sed -nE 's#.*proxy_pass http://(10\.0\.2\.[0-9]+):8000;.*#\1#p' "$CONFIG" | head -n 1)
[ "$CURRENT" = "$IP" ] && exit 0

sed -i -E "s#proxy_pass http://10\.0\.2\.[0-9]+:8000;#proxy_pass http://$IP:8000;#g" "$CONFIG"
nginx -t
systemctl reload nginx

