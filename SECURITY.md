# Security Policy

## Supported versions

The latest published release on npm is supported with security updates. Please
make sure you are on the newest version before reporting an issue:

```bash
npm view typescript-gateway version
```

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately using GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability):

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Describe the issue, including a minimal reproduction and the affected
   version(s).

You can expect an initial acknowledgement within a few days. Once a fix is
ready, a patched release is published and the advisory is disclosed, with credit
to the reporter unless you prefer to stay anonymous.

## Scope

This is a reverse proxy / API gateway. Reports we care about most:

- Authentication or authorization bypass (JWT, API keys).
- Request smuggling, header injection, or header confusion.
- SSRF or upstream-credential leakage (static tokens, HMAC signing).
- Path traversal or router-matching bypasses.
- Denial of service reachable from a single unauthenticated request.

## Threat model notes

- The gateway is designed to be the **sole holder** of upstream credentials
  (static tokens and HMAC secrets); those must never be exposed to callers.
- Secrets in configuration support environment interpolation (`${VAR}`). Never
  commit real secrets; keep them in your environment or secret manager.

## Dependencies

The project ships **zero runtime dependencies**, which keeps the supply-chain
surface minimal. If you believe a transitive (dev-only) dependency is the
problem, note that in your report.
