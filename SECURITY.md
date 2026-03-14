# Security Policy

## Supported Versions

We release patches for security vulnerabilities for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | :white_check_mark: |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via email to: **diego@diegoalto.works**

You should receive a response within 48 hours. If for some reason you do not, please follow up via email to ensure we received your original message.

Please include the following information:

- Type of issue (e.g. injection, authentication bypass, etc.)
- Full paths of source file(s) related to the manifestation of the issue
- The location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

## Security Scanning

This project uses automated security scanning:

- **Bun Audit** -- checks for known vulnerabilities in dependencies
- **CodeQL Analysis** -- static code analysis for security patterns
- **Dependency Review** -- reviews new dependencies on pull requests

### Manual Security Checks

Run security scans locally:

```bash
# Run security audit
bun run security:audit

# Run security check (fails on moderate+ vulnerabilities)
bun run security:check

# Fix automatically fixable vulnerabilities
bun run security:audit:fix

# Run full quality checks (includes security)
bun run check
```

## Security Best Practices

When deploying Talker:

1. **Use Environment Variables** for secrets (OpenAI keys, Twilio credentials, database tokens)
2. **Enable HTTPS** in production -- use a reverse proxy (nginx, Caddy) with SSL/TLS
3. **Restrict Twilio Webhooks** -- validate that incoming requests are from Twilio
4. **Keep Dependencies Updated** -- Dependabot is configured for automated updates
5. **Use Strong Secrets** -- generate cryptographically secure tokens, rotate regularly

## Vulnerability Disclosure Timeline

- **Day 0**: Vulnerability reported
- **Day 1-2**: Initial response and triage
- **Day 3-7**: Develop and test fix
- **Day 7-14**: Release security patch
- **Day 14+**: Public disclosure (coordinated)

## Security Contacts

- **Primary**: diego@diegoalto.works
- **GitHub**: [@diegoaltoworks](https://github.com/diegoaltoworks)
