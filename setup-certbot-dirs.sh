#!/bin/bash

# Create certbot directories with proper permissions
sudo mkdir -p certbot/www
sudo mkdir -p certbot/conf

# Set ownership to current user
sudo chown -R $USER:$USER certbot/

# Set permissions
chmod -R 755 certbot/

echo "Certbot directories created with proper permissions"