#!/bin/bash

# Let's Encrypt initialization script for first-time SSL setup
# Run this on the EC2 instance after initial deployment

set -e

DOMAIN="bap.basny.org"
EMAIL="basny-admins@porcnick.com"  # Change this to your email
STAGING=0  # Set to 1 to use Let's Encrypt staging server for testing

echo "### Starting Let's Encrypt initialization for $DOMAIN ###"

# Check if certificates already exist
if [ -d "/mnt/basny-data/certs/live/$DOMAIN" ]; then
    read -p "Certificates already exist. Do you want to replace them? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Exiting without changes."
        exit 0
    fi
fi

# Ensure required directories exist
echo "Creating required directories..."
mkdir -p /mnt/basny-data/certs
mkdir -p /mnt/basny-data/webroot

# Start nginx service if not running (HTTP only for ACME challenge)
echo "Starting nginx for ACME challenge..."
docker-compose -f docker-compose.prod.yml up -d nginx

# Wait for nginx to be ready
echo "Waiting for nginx to be ready..."
sleep 5

# Set up staging flag if needed
STAGING_ARG=""
if [ $STAGING -eq 1 ]; then
    STAGING_ARG="--staging"
    echo "Using Let's Encrypt staging server..."
fi

# Request certificate
echo "Requesting Let's Encrypt certificate for $DOMAIN..."
docker run -it --rm \
    -v /mnt/basny-data/certs:/etc/letsencrypt \
    -v /mnt/basny-data/webroot:/var/www/certbot \
    certbot/certbot certonly \
    --webroot \
    -w /var/www/certbot \
    --email $EMAIL \
    --agree-tos \
    --no-eff-email \
    --force-renewal \
    $STAGING_ARG \
    -d $DOMAIN \

if [ $? -eq 0 ]; then
    echo "### Certificate obtained successfully! ###"
    
    # Update nginx configuration to use SSL
    echo "Updating nginx configuration for SSL..."
    
    # Create a backup of the current config
    cp nginx/conf.d/default.conf nginx/conf.d/default.conf.bak
    
    # Enable SSL configuration
    cat > nginx/conf.d/default.conf << 'EOF'
# HTTP server - redirect all traffic to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name bap.basny.org;

    # Allow Let's Encrypt ACME challenges
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Redirect all other traffic to HTTPS
    location / {
        return 301 https://$server_name$request_uri;
    }
}

# HTTPS server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name bap.basny.org;

    # SSL configuration
    ssl_certificate /etc/letsencrypt/live/bap.basny.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bap.basny.org/privkey.pem;
    ssl_trusted_certificate /etc/letsencrypt/live/bap.basny.org/chain.pem;

    # SSL security settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:DHE-DSS-AES128-GCM-SHA256:kEDH+AESGCM:ECDHE-RSA-AES128-SHA256:ECDHE-ECDSA-AES128-SHA256:ECDHE-RSA-AES128-SHA:ECDHE-ECDSA-AES128-SHA:ECDHE-RSA-AES256-SHA384:ECDHE-ECDSA-AES256-SHA384:ECDHE-RSA-AES256-SHA:ECDHE-ECDSA-AES256-SHA:DHE-RSA-AES128-SHA256:DHE-RSA-AES128-SHA:DHE-DSS-AES128-SHA256:DHE-RSA-AES256-SHA256:DHE-DSS-AES256-SHA:DHE-RSA-AES256-SHA:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!3DES:!MD5:!PSK;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    ssl_stapling on;
    ssl_stapling_verify on;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Rate limiting
    location / {
        limit_req zone=general burst=20 nodelay;
        
        proxy_pass http://app:4200;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Timeouts for long-running requests
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # API endpoints with higher rate limit
    location /api/ {
        limit_req zone=api burst=50 nodelay;
        
        proxy_pass http://app:4200;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # File upload endpoints with lower rate limit
    location ~ ^/(submission|tank|upload) {
        limit_req zone=uploads burst=10 nodelay;
        client_max_body_size 100M;
        
        proxy_pass http://app:4200;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Longer timeouts for file uploads
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }
}
EOF

    echo "Reloading nginx with SSL configuration..."
    docker-compose -f docker-compose.prod.yml restart nginx
    
    echo "### SSL setup complete! ###"
    echo "Your site should now be accessible via HTTPS."
    echo ""
    echo "To test the renewal process, run:"
    echo "docker-compose -f docker-compose.prod.yml run --rm certbot renew --dry-run"
    
else
    echo "### Certificate request failed! ###"
    echo "Please check the error messages above and try again."
    exit 1
fi