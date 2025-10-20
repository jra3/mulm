# Local Development with Tailscale SSL

This directory contains the configuration for running a local nginx reverse proxy with Tailscale SSL certificates for OAuth testing.

## Quick Start

```bash
# Start nginx proxy
docker-compose -f docker-compose.local-proxy.yml up -d

# Start dev server (in another terminal)
npm run dev

# Access the app
https://johns-mac.corgi-hammerhead.ts.net
```

## What's Configured

- **SSL Certificate**: Tailscale-issued Let's Encrypt certificate
- **Hostname**: `johns-mac.corgi-hammerhead.ts.net`
- **Ports**:
  - 443 (HTTPS) → proxies to localhost:4200
  - 80 (HTTP) → redirects to HTTPS
- **Features**: HTTP/2, security headers, WebSocket support for hot reload

## Management Commands

```bash
# Start nginx
docker-compose -f docker-compose.local-proxy.yml up -d

# Stop nginx
docker-compose -f docker-compose.local-proxy.yml down

# Restart nginx (after config changes)
docker-compose -f docker-compose.local-proxy.yml restart

# View logs
docker logs basny-nginx-local-proxy -f

# Check container status
docker ps | grep nginx-local-proxy
```

## Certificate Renewal

Tailscale certificates expire after 90 days. To renew:

```bash
cd nginx/certs
tailscale cert johns-mac.corgi-hammerhead.ts.net
docker-compose -f ../../docker-compose.local-proxy.yml restart
```

## Google OAuth Configuration

Add these to your Google Cloud Console OAuth 2.0 Client ID:

**Authorized redirect URIs:**
```
https://johns-mac.corgi-hammerhead.ts.net/auth/google/callback
```

**Authorized JavaScript origins:**
```
https://johns-mac.corgi-hammerhead.ts.net
```

## Files

- `nginx.local-proxy.conf` - nginx configuration
- `certs/` - Tailscale SSL certificates (git-ignored)
- `docker-compose.local-proxy.yml` - Docker setup for nginx

## Troubleshooting

### 502 Bad Gateway

If you see a 502 error, check that:
1. The dev server is running (`npm run dev`)
2. The app is listening on port 4200 (check logs)
3. Nginx can reach `host.docker.internal:4200`

```bash
# Check if app is running
curl http://localhost:4200/health

# Check nginx logs
docker logs basny-nginx-local-proxy
```

### Certificate Not Found

If nginx fails to start with certificate errors:

```bash
cd nginx/certs
tailscale cert johns-mac.corgi-hammerhead.ts.net
docker-compose -f ../../docker-compose.local-proxy.yml restart
```

### Can't Access from Other Devices

Make sure:
1. The device is on your Tailscale network
2. The hostname resolves: `ping johns-mac.corgi-hammerhead.ts.net`
3. Ports 80 and 443 aren't blocked by firewall

## Security Features

This setup includes multiple security hardening measures:

### SSL/TLS Security
- **TLS 1.2 and 1.3 only** - No support for older, vulnerable protocols
- **Modern cipher suites** - ECDHE and CHACHA20-POLY1305 ciphers
- **HSTS enabled** - Prevents protocol downgrade attacks (24-hour max-age for dev)
- **SSL session caching** - Improves performance without sacrificing security

### Security Headers
- **Content-Security-Policy** - Mitigates XSS attacks (permissive for dev)
- **X-Frame-Options** - Prevents clickjacking
- **X-Content-Type-Options** - Prevents MIME-sniffing attacks
- **Referrer-Policy** - Controls referrer information leakage
- **Strict-Transport-Security** - Enforces HTTPS

### Container Security
- **Resource limits** - CPU and memory constraints prevent resource exhaustion
- **Capability dropping** - Minimal Linux capabilities (NET_BIND_SERVICE only)
- **No new privileges** - Prevents privilege escalation
- **Read-only volumes** - Config and certificates cannot be modified by container

### Network Security
- **Tailscale isolation** - Only accessible from your private Tailscale network
- **Request size limits** - 100MB max body size prevents large payload DoS
- **Proper proxy headers** - X-Forwarded-For, X-Real-IP for accurate logging

### Important Notes

⚠️ **Local Development Only** - This configuration is optimized for local development within a Tailscale network. For production use, additional hardening is required:
- Stricter CSP without 'unsafe-inline' and 'unsafe-eval'
- Rate limiting
- Longer HSTS max-age (1 year+)
- Regular security updates
- Monitoring and alerting

## Benefits

✅ Real HTTPS with valid certificate
✅ OAuth flows work properly (redirect URIs)
✅ Test on any device in your Tailscale network
✅ No Cloudflare tunnel needed
✅ Faster than tunneling (direct connection)
✅ Hot reload works (WebSocket support)
✅ Security hardened for local development
