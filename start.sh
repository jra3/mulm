#!/bin/bash
# silly health check while i'm debugging the CF tunnel
while sleep 60; do curl -I localhost:4200; done &
node src/index.js
