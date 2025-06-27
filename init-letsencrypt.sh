#!/bin/bash

# Load environment variables
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

if [ -z "$DOMAIN" ] || [ -z "$LETSENCRYPT_EMAIL" ]; then
  echo "Error: DOMAIN and LETSENCRYPT_EMAIL must be set"
  exit 1
fi

echo "### Starting initial setup for domain: $DOMAIN"

# Stop any running containers
docker-compose -f docker-compose-letsencrypt.yml down

# Start nginx with initial config (no SSL)
echo "### Starting nginx without SSL for initial certificate request..."
docker-compose -f docker-compose-letsencrypt.yml up -d nginx mulm

# Wait for nginx to be ready
echo "### Waiting for nginx to be ready..."
sleep 5

# Request the certificate
echo "### Requesting Let's Encrypt certificate..."
docker-compose -f docker-compose-letsencrypt.yml run --rm --entrypoint="" certbot certonly \
  --webroot --webroot-path=/var/www/certbot \
  --email $LETSENCRYPT_EMAIL \
  --agree-tos \
  --no-eff-email \
  --force-renewal \
  -d $DOMAIN -d www.$DOMAIN

if [ $? -eq 0 ]; then
  echo "### Certificate obtained successfully!"
  
  # Now restart everything with SSL enabled
  echo "### Restarting with SSL configuration..."
  docker-compose -f docker-compose-letsencrypt.yml down
  
  # The docker-compose will now use the full nginx.conf.template with SSL
  docker-compose -f docker-compose-letsencrypt.yml up -d
  
  echo "### Setup complete! Your site should now be available at https://$DOMAIN"
else
  echo "### Certificate request failed. Please check the error messages above."
  exit 1
fi