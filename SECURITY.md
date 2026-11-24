# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately by either:

- using GitHub's **Report a vulnerability** (private advisory) button on this repository's Security tab, or
- emailing `jimmy@supahelp.app`.

Include what you found, how to reproduce it, and the version or commit. We aim to acknowledge reports within 5 business days.
This is a small team; there is no bug bounty.

## Scope

In scope: this repository (the desktop app and `packages/contracts`), including how it stores credentials, handles
approvals, and talks to the hosted service. Out of scope: the hosted Supahelp service and website (report to the same
contact and we will route it), and third-party tools and AI providers.

## Never commit secrets

The app embeds only public values (see [Build configuration](docs/architecture.md#build-configuration)). If you find a real secret in this repository or its
history, report it privately so it can be rotated.
