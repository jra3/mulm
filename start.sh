#!/bin/bash
# silly health check while i'm debugging the CF tunnel
while sleep 600; do curl -I localhost:4200; done &
node src/index.js
