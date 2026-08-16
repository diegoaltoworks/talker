# Security Policy

## Supported Versions

We release patches for security vulnerabilities for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | :white_check_mark: |

Only the latest published version is patched. A fix ships as a new release,
not as a backport to an older line: while the package is pre-1.0 there is no
stable line to backport to, and after 1.0 this table gains a row per supported
major rather than implying that every 0.x ever published still gets fixes.

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

- **Bun Audit** -- `bun run security:check` runs on every CI build and every
  publish, and fails the build on moderate-or-higher severity findings
- **Dependabot** -- weekly automated dependency update PRs for npm packages
  and GitHub Actions; minor and patch bumps auto-merge once checks pass,
  major bumps wait for a human to review and merge

No static application security testing (e.g. CodeQL) or PR-time dependency
review currently runs in CI.

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

## Logging & Data Redaction

The structured logger (`src/core/logger.ts`) redacts phone numbers by key
name (`phoneNumber`/`phone`/`From`/`To`, at any nesting depth, including
inside an array of raw phone strings) and truncates every other
structured-data string field (conversation turns, extracted flow parameters,
LLM output) to a 160-character preview once it exceeds that length -- shorter
values, including a typical single-segment SMS, are logged in full. Set
`TALKER_LOG_REDACT_KEYS` to a comma-separated list of field names (e.g.
`email,reference`) to replace those fields outright regardless of length,
for a host whose flow params carry something more sensitive than ordinary
conversation text. The log message string passed as the first argument (e.g.
`"flow error"`) is a fixed label, never user content, and is not subject to
this preview. Set `TALKER_LOG_VERBOSE=true` to log full, untruncated content
when debugging
locally -- do not enable it against production log output, since it defeats
the content-preview policy (phone redaction still applies).

`logger.debug` calls (a handful of high-volume, per-request sites such as raw
inbound message/speech content) are silent unless `DEBUG=true`. That flag
also unsilences the logger during tests, so it is easy to reach for locally
-- avoid setting it in a production environment, since it turns those
call sites on there too, not just in a debugger.

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
