# Reverse-proxy setup (Debian 13 + nginx)

This directory contains the nginx vhost that fronts Filament with TLS at
`https://filament.home.obrys.cz/`.

## Install

```bash
# Copy to the proxy server, enable, test, reload
scp filament.home.obrys.cz.conf root@deb-gw:/etc/nginx/sites-available/
ssh root@deb-gw
ln -s /etc/nginx/sites-available/filament.home.obrys.cz.conf \
      /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

The upstream is set to `http://web.lan:8081` — make sure `web.lan` resolves
on the proxy host (it should, since both are on the LAN DNS).

## Notes

- The `map $http_upgrade $connection_upgrade { ... }` block must live in the
  `http {}` scope. If you already declare it elsewhere, **delete the
  duplicate** from this file (nginx will fail to start otherwise).
- The `/ws/` location must come **before** `/`. nginx prefix-match ordering
  is significant.
- WebSocket idle timeout is 1 h; the Filament client pings every 20 s, so
  reconnects happen long before that.
- HSTS is enabled (1 year). Comment that header out while testing if you're
  not yet ready to commit.

## Firewall on the server (recommended)

Restrict the application port so it's only reachable from the proxy:

```bash
sudo firewall-cmd --permanent --add-rich-rule="rule family=ipv4 \
    source address=<proxy-ip>/32 port port=8081 protocol=tcp accept"
sudo firewall-cmd --permanent --remove-port=8081/tcp 2>/dev/null || true
sudo firewall-cmd --reload
```

## Troubleshooting

| Symptom                              | Likely cause / fix                                  |
|--------------------------------------|-----------------------------------------------------|
| `502 Bad Gateway`                    | Server VM unreachable or web container down. Check `systemctl --user status filament-web` on the VM. |
| WebSocket connects but disconnects every minute | A different proxy (Cloudflare, etc.) is in front; raise its read timeout. |
| `duplicate "map" directive`          | The `map` block in this file conflicts with an existing one elsewhere — remove from this file. |
| `unknown directive "http2"`          | Your nginx is older than 1.25. Replace `listen 443 ssl;` + `http2 on;` with `listen 443 ssl http2;`. |
