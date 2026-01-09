#!/bin/bash
#
# Health Check Metric Script for BASNY BAP Production
#
# Pushes application health status to CloudWatch as a custom metric.
# Run via cron every 5 minutes.
#
# Exit codes:
#   0 - Metric pushed successfully
#   1 - Failed to push metric
#

set -euo pipefail

# Configuration
HEALTH_URL="https://bap.basny.org/health"
METRIC_NAMESPACE="BASNY"
METRIC_NAME="HealthCheckStatus"
TIMEOUT=10

# Check health endpoint
if curl -sf --max-time ${TIMEOUT} "${HEALTH_URL}" > /dev/null 2>&1; then
    HEALTH_VALUE=1
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Health check PASSED"
else
    HEALTH_VALUE=0
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Health check FAILED"
fi

# Push metric to CloudWatch
aws cloudwatch put-metric-data \
    --namespace "${METRIC_NAMESPACE}" \
    --metric-name "${METRIC_NAME}" \
    --value ${HEALTH_VALUE} \
    --unit Count \
    --region us-east-1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Pushed metric ${METRIC_NAME}=${HEALTH_VALUE} to CloudWatch"
