# Sendmail Configuration for Email Alerts

This document describes the sendmail (ssmtp) configuration used for sending email alerts from the BASNY BAP production server.

## Overview

The production server uses **ssmtp** (Simple SMTP) as a sendmail replacement. This allows scripts and cron jobs to send email using the standard `sendmail` command, which relays through the production SMTP server.

**Key Benefits:**
- Scripts can use standard `sendmail` command
- Cron job output can be automatically emailed
- Consistent email configuration across all scripts
- Uses same SMTP credentials as the Node.js application

## Installation

ssmtp is installed on the production server:

```bash
sudo dnf install -y ssmtp
```

This provides the `/usr/sbin/sendmail` command.

## Configuration Files

### Main Configuration: `/etc/ssmtp/ssmtp.conf`

```ini
#
# SSMTP Configuration for BASNY BAP Production
# Configured to relay mail via mail.basny.org SMTP server
#
# This allows scripts to use standard sendmail command to send alerts
# Configuration synced with /mnt/basny-data/app/config/config.production.json
#

# The mail server (SMTP relay)
mailhub=YOUR_SMTP_SERVER:465    # From config.production.json smtpHost:smtpPort

# Use SSL/TLS for secure connection (port 465)
UseTLS=YES
UseSTARTTLS=NO

# SMTP authentication credentials
AuthUser=FROM_EMAIL_ADDRESS     # From config.production.json fromEmail
AuthPass=YOUR_SMTP_PASSWORD     # From config.production.json smtpPassword

# Default From address
FromLineOverride=YES
RewriteDomain=yourdomain.org    # Your domain

# Hostname of this machine
hostname=yourdomain.org         # Your production domain

# Root email forwarding (for cron job outputs)
root=ADMIN_EMAIL_ADDRESS        # From config.production.json adminsEmail

# TLS certificate bundle
TLS_CA_File=/etc/pki/tls/certs/ca-bundle.crt
```

**Permissions:**
```bash
sudo chmod 640 /etc/ssmtp/ssmtp.conf
sudo chown root:mail /etc/ssmtp/ssmtp.conf
```

### Reverse Aliases: `/etc/ssmtp/revaliases`

Maps local system users to the outgoing email address:

```ini
# Reverse aliases for ssmtp
# Format: local_account:outgoing_address:mailhub
#
# Map all system users to FROM_EMAIL_ADDRESS so emails appear to come from the correct address

root:FROM_EMAIL_ADDRESS:YOUR_SMTP_SERVER:465
ec2-user:FROM_EMAIL_ADDRESS:YOUR_SMTP_SERVER:465
```

**Why this is needed:**
Without reverse aliases, emails would come from `ec2-user@yourdomain.org` or `root@yourdomain.org`, which the SMTP server may reject. Reverse aliases ensure all outgoing mail appears to come from your authenticated SMTP account (FROM_EMAIL_ADDRESS from config).

## Configuration Sync

The ssmtp configuration should match the SMTP settings in the application config:

**Application Config:** `/mnt/basny-data/app/config/config.production.json`

```json
{
  "smtpHost": "YOUR_SMTP_SERVER",        // SMTP server hostname
  "smtpPort": 465,                       // SMTP port (465 for SSL, 587 for STARTTLS)
  "smtpSecure": true,                    // Use SSL/TLS
  "smtpPassword": "YOUR_SMTP_PASSWORD",  // SMTP password
  "fromEmail": "FROM_EMAIL_ADDRESS",     // Outgoing email address (auth user)
  "adminsEmail": "ADMIN_EMAIL_ADDRESS"   // Where alerts are sent
}
```

**When updating SMTP credentials:**
1. Update `/mnt/basny-data/app/config/config.production.json`
2. Update `/etc/ssmtp/ssmtp.conf` to match
3. Restart application: `sudo docker-compose -f docker-compose.prod.yml restart app`
4. Test sendmail: See "Testing" section below

## Usage

### From Shell Scripts

```bash
#!/bin/bash

# Simple email
echo "Subject: Test Email

This is the email body." | sendmail recipient@example.com

# With explicit From header
echo "Subject: Alert Message
From: FROM_EMAIL_ADDRESS
To: admin@example.com

Alert message here." | sendmail admin@example.com
```

### From Cron Jobs

Cron automatically emails output to the user if there's any stdout/stderr. With ssmtp configured, these emails will be sent via the SMTP relay.

**Automatic email on error:**
```cron
# If this script outputs anything or fails, email will be sent to root (forwarded to admin email)
0 6 * * * /opt/basny/scripts/check-database-health.sh
```

**Explicit email recipient:**
```cron
MAILTO=YOUR_EMAIL@example.com
0 6 * * * /opt/basny/scripts/check-database-health.sh
```

**Disable cron emails:**
```cron
# Redirect all output to log file, no email sent
0 6 * * * /opt/basny/scripts/check-database-health.sh >> /var/log/health-check.log 2>&1
```

### From Monitoring Scripts

The database health check script uses sendmail for alerts:

```bash
# From check-database-health.sh
send_alert() {
    local subject="$1"
    local body="$2"

    local email_message=$(cat <<EOF
Subject: ${subject}
From: ${FROM_EMAIL}
To: ${ALERT_EMAIL}

${body}
EOF
)

    if command -v sendmail &> /dev/null; then
        echo "${email_message}" | sendmail -t
        log "Alert email sent to ${ALERT_EMAIL}"
    else
        log_warning "sendmail not available, alert not sent"
    fi
}
```

## Testing

### Send Test Email

```bash
# Basic test
echo "Subject: Test Email

This is a test." | sendmail YOUR_EMAIL@example.com

# With verbose output
echo "Subject: Test Email

This is a test." | sendmail -v YOUR_EMAIL@example.com
```

**Expected output (verbose mode):**
```
[<-] 220 ... SMTP server ready
[->] EHLO yourdomain.org
[<-] 250-... server capabilities
[->] AUTH LOGIN
[<-] 235 Authentication succeeded
[->] MAIL FROM:<FROM_EMAIL_ADDRESS>
[<-] 250 OK
[->] RCPT TO:<YOUR_EMAIL@example.com>
[<-] 250 Accepted
[->] DATA
[<-] 354 Enter message, ending with "." on a line by itself
[->] ... (message content)
[->] .
[<-] 250 OK id=...
[->] QUIT
```

### Test from Monitoring Script

```bash
# Run the test email script
sudo /opt/basny/scripts/test-email-alerts.sh
```

### Test Cron Email Delivery

```bash
# Temporarily add a test cron job
(crontab -l; echo "* * * * * echo 'Test cron output'") | crontab -

# Wait 1 minute, then check email

# Remove test job
crontab -l | grep -v "Test cron output" | crontab -
```

## Troubleshooting

### Check if sendmail is available

```bash
which sendmail
# Should output: /usr/sbin/sendmail

sendmail -version
# Should output: sSMTP version info
```

### Check configuration

```bash
sudo cat /etc/ssmtp/ssmtp.conf
sudo cat /etc/ssmtp/revaliases
```

### Test SMTP connection manually

```bash
# Test SSL connection to SMTP server
openssl s_client -connect YOUR_SMTP_SERVER:465 -crlf

# Should see:
# 220 ... SMTP server ready
# Then type: QUIT
```

### Common Issues

**Problem:** `550 Sender verify failed`

**Cause:** Email is coming from wrong address (e.g., `ec2-user@yourdomain.org` instead of authenticated FROM_EMAIL_ADDRESS)

**Solution:** Check `/etc/ssmtp/revaliases` is configured correctly:
```bash
sudo cat /etc/ssmtp/revaliases
# Should show: ec2-user:FROM_EMAIL_ADDRESS:YOUR_SMTP_SERVER:465
```

**Problem:** `535 Authentication failed`

**Cause:** Wrong SMTP credentials

**Solution:** Verify credentials in `/etc/ssmtp/ssmtp.conf` match `/mnt/basny-data/app/config/config.production.json`:
```bash
sudo jq -r '.smtpPassword' /mnt/basny-data/app/config/config.production.json
sudo grep AuthPass /etc/ssmtp/ssmtp.conf
```

**Problem:** `sendmail: cannot open mail.basny.org:465`

**Cause:** Network connectivity issue or firewall blocking port 465

**Solution:** Test SMTP connectivity:
```bash
telnet YOUR_SMTP_SERVER 465
# Or with SSL:
openssl s_client -connect YOUR_SMTP_SERVER:465
```

**Problem:** Permission denied reading ssmtp.conf

**Cause:** Wrong file permissions or running as wrong user

**Solution:** Fix permissions:
```bash
sudo chmod 640 /etc/ssmtp/ssmtp.conf
sudo chown root:mail /etc/ssmtp/ssmtp.conf
```

### Debug Mode

Enable verbose logging by adding to the email command:

```bash
echo "Test" | sendmail -v recipient@example.com
```

Or add to `/etc/ssmtp/ssmtp.conf`:
```ini
Debug=YES
```

**Note:** Debug mode logs passwords in plain text. Disable after debugging!

## Email Flow Diagram

```
┌─────────────────────┐
│  Cron Job / Script  │
│                     │
│  Uses sendmail cmd  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│      ssmtp          │
│  (/usr/sbin/        │
│   sendmail)         │
│                     │
│  Reads config from: │
│  /etc/ssmtp/        │
└──────────┬──────────┘
           │
           │ SSL/TLS (port 465)
           │ Auth: FROM_EMAIL_ADDRESS
           │
           ▼
┌─────────────────────┐
│  YOUR_SMTP_SERVER   │
│  SMTP Relay         │
│                     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Recipient          │
│  ADMIN_EMAIL_       │
│  ADDRESS            │
└─────────────────────┘
```

## Security Considerations

### Password Storage

The SMTP password is stored in **plain text** in `/etc/ssmtp/ssmtp.conf`. Security measures:

1. **File permissions:** 640 (readable only by root and mail group)
2. **Ownership:** root:mail
3. **Not in version control:** Config files are server-only
4. **Encrypted in transit:** All SMTP traffic uses SSL/TLS

### Best Practices

- ✅ Keep ssmtp.conf permissions at 640 or stricter
- ✅ Regularly rotate SMTP password
- ✅ Monitor /var/log/maillog for suspicious activity
- ✅ Use same credentials as production app (consistency)
- ❌ Never commit /etc/ssmtp/ssmtp.conf to version control
- ❌ Never enable Debug=YES in production (logs passwords)

## Maintenance

### Updating SMTP Password

When the SMTP password changes:

1. Update application config:
```bash
sudo nano /mnt/basny-data/app/config/config.production.json
# Update smtpPassword field
```

2. Update ssmtp config:
```bash
sudo nano /etc/ssmtp/ssmtp.conf
# Update AuthPass field
```

3. Restart application:
```bash
cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml restart app
```

4. Test sendmail:
```bash
echo "Subject: Test After Password Change

Testing email after SMTP password update." | sendmail -v YOUR_EMAIL@example.com
```

### Checking Email Logs

System mail logs (if available):
```bash
sudo tail -f /var/log/maillog

# Or check syslog
sudo journalctl -u ssmtp -f
```

Application-specific logs:
```bash
# Backup script logs
tail -f /mnt/basny-data/backups/backup.log

# Health check logs
tail -f /mnt/basny-data/backups/health-check.log
```

## Integration with Monitoring

The monitoring system uses sendmail for all alerts:

**Database Health Checks** (`/opt/basny/scripts/check-database-health.sh`):
- Daily health check at 6 AM EST
- Sends email if corruption detected
- Uses sendmail command

**Backup Scripts** (`/opt/basny/scripts/backup-database.sh`):
- Pre-backup corruption detection
- Post-backup verification failures
- Uses sendmail command

**Cron Schedule:**
```cron
# Root crontab (health checks)
0 6 * * * /opt/basny/scripts/check-database-health.sh >> /mnt/basny-data/backups/health-check.log 2>&1

# User crontab (backups)
0 */6 * * * sudo /opt/basny/scripts/backup-database.sh hourly >> /mnt/basny-data/backups/backup.log 2>&1
```

## References

- [ssmtp Configuration](https://linux.die.net/man/5/ssmtp.conf)
- [ssmtp Man Page](https://linux.die.net/man/8/ssmtp)
- [DATABASE_MONITORING.md](DATABASE_MONITORING.md) - Health check system
- [Backup & Recovery Guide](https://github.com/jra3/mulm/wiki/Backup-Recovery)

## History

**2025-11-03**: Initial configuration
- Installed ssmtp package on Amazon Linux 2023
- Configured with production SMTP credentials (mail.basny.org:465)
- Set up reverse aliases for system users
- Integrated with database monitoring system
- Tested and verified email delivery
