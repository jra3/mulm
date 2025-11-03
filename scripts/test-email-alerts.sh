#!/bin/bash
#
# Test Email Alert System for BASNY BAP Production
#
# This script sends a test email to verify the alerting system works.
# Use this to confirm email configuration before relying on automated alerts.
#

set -euo pipefail

# Configuration
CONFIG_FILE="/mnt/basny-data/app/config/config.production.json"
LOG_FILE="/tmp/email-test-$(date +%Y%m%d_%H%M%S).log"

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "${LOG_FILE}"
}

log_error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}" | tee -a "${LOG_FILE}"
}

log_success() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] SUCCESS: $1${NC}" | tee -a "${LOG_FILE}"
}

log "Starting email alert system test..."

# Check if config file exists
if [ ! -f "${CONFIG_FILE}" ]; then
    log_error "Config file not found: ${CONFIG_FILE}"
    exit 1
fi

# Read email configuration
log "Reading email configuration from ${CONFIG_FILE}..."

SMTP_HOST=$(jq -r '.smtpHost // "mail.basny.org"' "${CONFIG_FILE}" 2>/dev/null || echo "mail.basny.org")
SMTP_PORT=$(jq -r '.smtpPort // 465' "${CONFIG_FILE}" 2>/dev/null || echo "465")
SMTP_SECURE=$(jq -r '.smtpSecure // true' "${CONFIG_FILE}" 2>/dev/null || echo "true")
FROM_EMAIL=$(jq -r '.fromEmail // "bap@basny.org"' "${CONFIG_FILE}" 2>/dev/null || echo "bap@basny.org")
SMTP_USER=$(jq -r '.fromEmail // "bap@basny.org"' "${CONFIG_FILE}" 2>/dev/null || echo "bap@basny.org")
SMTP_PASS=$(jq -r '.smtpPassword // ""' "${CONFIG_FILE}" 2>/dev/null || echo "")
ALERT_EMAIL=$(jq -r '.adminsEmail // "baptest@porcnick.com"' "${CONFIG_FILE}" 2>/dev/null || echo "baptest@porcnick.com")

log "Email configuration:"
log "  SMTP Host: ${SMTP_HOST}"
log "  SMTP Port: ${SMTP_PORT}"
log "  SMTP Secure: ${SMTP_SECURE}"
log "  From: ${FROM_EMAIL}"
log "  To: ${ALERT_EMAIL}"
log "  Has Password: $([ -n "${SMTP_PASS}" ] && echo 'Yes' || echo 'No')"

# Create test email body
SUBJECT="✅ Test Email Alert - BASNY BAP Monitoring System"
BODY=$(cat <<EOF
This is a test email from the BASNY BAP database monitoring system.

If you receive this email, the alerting system is working correctly and you will be notified of:
- Database corruption detection (daily health checks)
- Pre-backup corruption detection
- Backup failures
- Health check failures

Test Details:
- Timestamp: $(date '+%Y-%m-%d %H:%M:%S %Z')
- Server: $(hostname)
- From: ${FROM_EMAIL}
- To: ${ALERT_EMAIL}

Configuration Verified:
- SMTP Host: ${SMTP_HOST}:${SMTP_PORT}
- SMTP Secure: ${SMTP_SECURE}

Next Steps:
1. Verify you received this email at ${ALERT_EMAIL}
2. Check spam/junk folder if not in inbox
3. Whitelist ${FROM_EMAIL} to ensure future alerts aren't filtered
4. Update adminsEmail in config if needed: /mnt/basny-data/app/config/config.production.json

The monitoring system is actively checking database health:
- Daily health check: 6:00 AM EST
- Pre-backup checks: Every 6 hours (with hourly backups)
- Logs: /mnt/basny-data/backups/health-check.log

For more information, see:
/opt/basny/infrastructure/DATABASE_MONITORING.md

--
BASNY BAP Database Health Monitor
This is an automated test message.
EOF
)

log "Sending test email..."

# Try multiple methods to send email

# Method 1: Using curl with SMTP
if command -v curl &> /dev/null; then
    log "Attempting to send via curl..."

    # Construct email in RFC 2822 format
    EMAIL_FILE="/tmp/test-email-$$.txt"
    cat > "${EMAIL_FILE}" <<EOF
From: ${FROM_EMAIL}
To: ${ALERT_EMAIL}
Subject: ${SUBJECT}

${BODY}
EOF

    # Determine curl SMTP options based on port
    if [ "${SMTP_PORT}" = "465" ]; then
        SMTP_URL="smtps://${SMTP_HOST}:${SMTP_PORT}"
    else
        SMTP_URL="smtp://${SMTP_HOST}:${SMTP_PORT}"
    fi

    if curl --url "${SMTP_URL}" \
        --ssl-reqd \
        --mail-from "${FROM_EMAIL}" \
        --mail-rcpt "${ALERT_EMAIL}" \
        --user "${SMTP_USER}:${SMTP_PASS}" \
        --upload-file "${EMAIL_FILE}" \
        --silent --show-error 2>&1 | tee -a "${LOG_FILE}"; then
        log_success "Email sent successfully via curl"
        rm -f "${EMAIL_FILE}"
        log ""
        log "Test email sent to: ${ALERT_EMAIL}"
        log "Check your inbox (and spam folder) for the test message."
        log "Log file: ${LOG_FILE}"
        exit 0
    else
        log "curl method failed, trying next method..."
        rm -f "${EMAIL_FILE}"
    fi
fi

# Method 2: Using Python if available
if command -v python3 &> /dev/null; then
    log "Attempting to send via Python..."

    PYTHON_SCRIPT="/tmp/send-test-email-$$.py"
    cat > "${PYTHON_SCRIPT}" <<EOPY
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

smtp_host = "${SMTP_HOST}"
smtp_port = ${SMTP_PORT}
smtp_user = "${SMTP_USER}"
smtp_pass = "${SMTP_PASS}"
from_email = "${FROM_EMAIL}"
to_email = "${ALERT_EMAIL}"

message = MIMEMultipart()
message["From"] = from_email
message["To"] = to_email
message["Subject"] = "${SUBJECT}"

body = """${BODY}"""
message.attach(MIMEText(body, "plain"))

try:
    context = ssl.create_default_context()
    with smtplib.SMTP_SSL(smtp_host, smtp_port, context=context) as server:
        server.login(smtp_user, smtp_pass)
        server.sendmail(from_email, to_email, message.as_string())
    print("SUCCESS: Email sent via Python")
except Exception as e:
    print(f"ERROR: {e}")
    exit(1)
EOPY

    if python3 "${PYTHON_SCRIPT}" 2>&1 | tee -a "${LOG_FILE}"; then
        log_success "Email sent successfully via Python"
        rm -f "${PYTHON_SCRIPT}"
        log ""
        log "Test email sent to: ${ALERT_EMAIL}"
        log "Check your inbox (and spam folder) for the test message."
        log "Log file: ${LOG_FILE}"
        exit 0
    else
        log "Python method failed, trying next method..."
        rm -f "${PYTHON_SCRIPT}"
    fi
fi

# Method 3: Using sendmail if available
if command -v sendmail &> /dev/null; then
    log "Attempting to send via sendmail..."

    EMAIL_MESSAGE=$(cat <<EOF
Subject: ${SUBJECT}
From: ${FROM_EMAIL}
To: ${ALERT_EMAIL}
Content-Type: text/plain; charset=UTF-8

${BODY}
EOF
)

    if echo "${EMAIL_MESSAGE}" | sendmail -t 2>&1 | tee -a "${LOG_FILE}"; then
        log_success "Email sent successfully via sendmail"
        log ""
        log "Test email sent to: ${ALERT_EMAIL}"
        log "Check your inbox (and spam folder) for the test message."
        log "Log file: ${LOG_FILE}"
        exit 0
    else
        log "sendmail method failed"
    fi
fi

# All methods failed
log_error "All email sending methods failed!"
log_error ""
log_error "Attempted methods:"
log_error "  1. curl (SMTP)"
log_error "  2. Python smtplib"
log_error "  3. sendmail"
log_error ""
log_error "Please check:"
log_error "  - SMTP credentials in ${CONFIG_FILE}"
log_error "  - SMTP server ${SMTP_HOST}:${SMTP_PORT} is accessible"
log_error "  - Firewall allows outbound SMTP connections"
log_error "  - Review log file: ${LOG_FILE}"

exit 1
