# Security policy

## Reporting a vulnerability

If you find a security issue in `taskbounty-check` (for example, a way it could read or transmit
data outside its documented scope), please report it privately. Do not open a public issue for a
vulnerability.

- Email: security@task-bounty.com
- Subject: "taskbounty-check security report"
- Include: the version, your OS/Node version, reproduction steps, and what you observed.

We aim to acknowledge reports within 2 business days and to agree on a disclosure timeline with you.
Please give us a reasonable window to ship a fix before any public disclosure.

## Scope

`taskbounty-check` is a local scanner. By design it:

- reads only `.github/workflows/*.yml|*.yaml` and update-automation config inside the directories
  you point it at;
- makes no network requests by default;
- writes a local report only, and uploads nothing automatically.

Reports that demonstrate a break in any of those properties are the highest priority.
