# Security Policy

## Supported Versions

The BAP platform is currently in active development. Security updates are applied to the main branch and deployed to production.

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report security vulnerabilities by emailing the maintainer directly. You can find contact information in the repository owner's GitHub profile.

### What to Include

Please include the following information in your report:

- Type of vulnerability
- Full paths of source file(s) related to the vulnerability
- Location of the affected source code (tag/branch/commit or direct URL)
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

### Response Timeline

- **Initial Response**: Within 48 hours of report
- **Status Update**: Within 7 days with assessment and timeline
- **Fix Timeline**: Critical issues patched within 7 days; others within 30 days

### Disclosure Policy

- Security issues will be disclosed after a fix is deployed
- Credit will be given to reporters unless anonymity is requested
- We follow responsible disclosure practices

## Security Best Practices

This application implements several security measures:

- **Authentication**: Google OAuth 2.0
- **Session Management**: Secure, HTTP-only cookies with CSRF protection
- **Input Validation**: Zod schema validation on all user inputs
- **SQL Injection Protection**: Parameterized queries throughout
- **Rate Limiting**: nginx-level protection against abuse
- **HTTPS**: Enforced via Let's Encrypt SSL certificates
- **Image Uploads**: Server-side validation and sanitization
- **Dependencies**: Automated updates via Dependabot

## Known Security Considerations

- The application uses SQLite which is appropriate for the current scale
- File uploads are validated and stored in Cloudflare R2
- Admin actions require explicit authentication checks
- Session tokens are rotated and securely stored

## Security Updates

Security updates are applied through:

1. Automated Dependabot PRs for npm dependencies
2. Regular security audits via `npm audit`
3. GitHub security advisories monitoring

To check for vulnerabilities locally:

```bash
npm audit
npm audit fix  # Apply automatic fixes
```
