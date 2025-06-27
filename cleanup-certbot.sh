#!/bin/bash

# Load environment variables
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

if [ -z "$DOMAIN" ]; then
  echo "Error: DOMAIN must be set"
  exit 1
fi

echo "### Cleaning up certbot configurations for domain: $DOMAIN"

# Stop any running containers
docker-compose -f docker-compose-letsencrypt.yml down

# Remove the broken configuration
echo "### Removing broken renewal configuration..."
sudo rm -f ./certbot/conf/renewal/${DOMAIN}.conf

# Check if we have the -0001 certificate
if [ -d "./certbot/conf/live/${DOMAIN}-0001" ]; then
  echo "### Found existing certificate at ${DOMAIN}-0001"
  
  # Create symlink from expected location to actual certificate
  echo "### Creating symlink for nginx configuration..."
  sudo mkdir -p ./certbot/conf/live/${DOMAIN}
  sudo ln -sf ../${DOMAIN}-0001/fullchain.pem ./certbot/conf/live/${DOMAIN}/fullchain.pem
  sudo ln -sf ../${DOMAIN}-0001/privkey.pem ./certbot/conf/live/${DOMAIN}/privkey.pem
  
  echo "### Cleanup complete! You can now run docker-compose normally:"
  echo "docker-compose -f docker-compose-letsencrypt.yml up -d"
else
  echo "### No existing certificate found. Run init-letsencrypt.sh to obtain a new certificate."
fi