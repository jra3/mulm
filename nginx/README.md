# Nginx Configuration

Nginx serves as the reverse proxy for the production application, handling HTTP/HTTPS traffic, SSL certificates, and rate limiting.

## Configuration Files

- `nginx.conf` - Main nginx config with rate limiting zones
- `conf.d/default.conf` - Server blocks for HTTP/HTTPS
- Files in `conf.d/` are automatically included
- Remove any temporary/test config files before production deployment

## SSL/HTTPS Setup

**Certificate**: Let's Encrypt certificate for bap.basny.org

**Auto-renewal**: certbot container runs every 12 hours

**Certificate location**: `/mnt/basny-data/nginx/certs/`

**Configuration**:
- HTTP traffic redirects to HTTPS (301)
- HSTS enabled with preload: `max-age=31536000; includeSubDomains; preload`
- Modern TLS: TLSv1.2 and TLSv1.3 only

### SSL Certificate Management

**Check certificate status**:
```bash
ssh BAP "sudo docker exec basny-certbot certbot certificates"
```

**Manual renewal** (if needed):
```bash
ssh BAP "sudo docker exec basny-certbot certbot renew"
```

**Test renewal process**:
```bash
ssh BAP "sudo docker exec basny-certbot certbot renew --dry-run"
```

**Re-issue certificates** (if lost):
```bash
# 1. Verify DNS points to correct IP
dig bap.basny.org +short  # Should return: 98.91.62.199

# 2. Run Let's Encrypt init script
ssh BAP "cd /opt/basny && sudo ./scripts/init-letsencrypt.sh"
```

## Rate Limiting

Defined in `nginx.conf`:

**General requests**: 10 req/sec (burst 20)
- Applied to all requests by default

**API endpoints** (`/api/*`): 30 req/sec (burst 50)
- Higher limit for API calls

**Upload endpoints** (`/submission`, `/tank`, `/upload`): 5 req/sec (burst 10)
- Lower limit to prevent abuse
- 100MB max upload size
- 300s timeout for large uploads

### Rate Limit Configuration

```nginx
# In nginx.conf
http {
    # Define zones
    limit_req_zone $binary_remote_addr zone=general:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=api:10m rate=30r/s;
    limit_req_zone $binary_remote_addr zone=upload:10m rate=5r/s;
}

# In conf.d/default.conf
location / {
    limit_req zone=general burst=20 nodelay;
}

location /api/ {
    limit_req zone=api burst=50 nodelay;
}

location ~ ^/(submission|tank|upload) {
    limit_req zone=upload burst=10 nodelay;
}
```

## Security Headers

All configured in `conf.d/default.conf`:

**Strict-Transport-Security**: Force HTTPS for 1 year
```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
```

**X-Frame-Options**: Prevent clickjacking
```nginx
add_header X-Frame-Options "SAMEORIGIN" always;
```

**X-Content-Type-Options**: Prevent MIME sniffing
```nginx
add_header X-Content-Type-Options "nosniff" always;
```

**X-XSS-Protection**: Enable XSS filter
```nginx
add_header X-XSS-Protection "1; mode=block" always;
```

**Referrer-Policy**: Control referrer info
```nginx
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
```

## Server Version Hiding

Production security configuration:

**Nginx**: `server_tokens off` in nginx.conf hides version numbers

**Express**: `app.disable('x-powered-by')` in src/index.ts hides Express version

## Default Server Block

First server block in `conf.d/default.conf` catches invalid Host headers:

```nginx
server {
    listen 80 default_server;
    listen 443 ssl default_server;
    server_name _;
    return 444;  # Close connection without response
}
```

This prevents host header injection attacks.

## Updating Nginx Config

### Local Development

1. Edit local config:
   ```bash
   vim nginx/conf.d/default.conf
   ```

2. Copy to production and test:
   ```bash
   scp nginx/conf.d/default.conf BAP:/tmp/
   ssh BAP "sudo cp /tmp/default.conf /opt/basny/nginx/conf.d/ && sudo docker exec basny-nginx nginx -t"
   ```

3. If test succeeds, reload nginx:
   ```bash
   ssh BAP "sudo docker exec basny-nginx nginx -s reload"
   ```

### Testing Config Changes

Always test nginx config before reloading:

```bash
ssh BAP "sudo docker exec basny-nginx nginx -t"
```

If test fails, config syntax has errors - fix before reloading.

## Logs

**Access logs**: `/mnt/basny-data/nginx/logs/access.log`

**Error logs**: `/mnt/basny-data/nginx/logs/error.log`

**View logs**:
```bash
# Access log
ssh BAP "tail -f /mnt/basny-data/nginx/logs/access.log"

# Error log
ssh BAP "tail -f /mnt/basny-data/nginx/logs/error.log"

# Docker container logs
ssh BAP "sudo docker logs basny-nginx --tail 100 -f"
```

**Find large log files**:
```bash
ssh BAP "find /mnt/basny-data/nginx/logs -type f -size +100M -ls"
```

## Troubleshooting

### Nginx Won't Start

1. Check syntax:
   ```bash
   ssh BAP "sudo docker exec basny-nginx nginx -t"
   ```

2. Check logs:
   ```bash
   ssh BAP "sudo docker logs basny-nginx"
   ```

3. Common issues:
   - Syntax error in config file
   - Port already in use (another container?)
   - SSL certificate files missing

### SSL Certificate Issues

1. Check certificate status:
   ```bash
   ssh BAP "sudo docker exec basny-certbot certbot certificates"
   ```

2. Check certificate files exist:
   ```bash
   ssh BAP "ls -la /mnt/basny-data/nginx/certs/"
   ```

3. Re-issue if needed (see SSL Certificate Management above)

### Rate Limit Too Restrictive

If legitimate traffic is being rate limited:

1. Increase limits in `nginx.conf`:
   ```nginx
   limit_req_zone $binary_remote_addr zone=general:10m rate=20r/s;  # Was 10r/s
   ```

2. Update config on production (see Updating Nginx Config above)

3. Reload nginx:
   ```bash
   ssh BAP "sudo docker exec basny-nginx nginx -s reload"
   ```

### 502 Bad Gateway

Nginx can't connect to upstream application:

1. Check app container is running:
   ```bash
   ssh BAP "sudo docker ps | grep basny-app"
   ```

2. Check app logs:
   ```bash
   ssh BAP "sudo docker logs basny-app --tail 100"
   ```

3. Restart app if needed:
   ```bash
   ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml restart app"
   ```

## Further Reading

- **[infrastructure/README.md](../infrastructure/README.md)** - Production deployment, monitoring, operations
- **Nginx Docs**: https://nginx.org/en/docs/
- **Let's Encrypt Docs**: https://letsencrypt.org/docs/
