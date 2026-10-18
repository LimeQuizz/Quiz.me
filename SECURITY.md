# Security Policy

## Supported versions

Quiz.me is pre-1.0. Security fixes go into `main` and the latest released
minor version.

| Version | Supported |
|---------|-----------|
| `main` (images tagged with the git sha and `latest`) | Yes |
| Latest `0.x` release | Yes |
| Older releases | No; upgrade to the latest release |

## Reporting a vulnerability

Please do not open a public issue, discussion, or pull request for a
security problem.

Use GitHub's private vulnerability reporting: open the repository's
**Security** tab and choose **Report a vulnerability**. Include:

- what an attacker can do and what they need (for example, a signed-in
  account);
- steps or a proof of concept against a local docker-compose instance;
- the version or commit you tested.

Please test only against your own instance. Do not test against other
people's deployments, and do not access or modify other users' data.

## What to expect

- Acknowledgement within 3 working days.
- An initial assessment and severity within 10 working days.
- A fix, or a plan with a timeline, for confirmed issues. We will coordinate
  a disclosure date with you and credit you in the advisory unless you
  prefer otherwise.

## Scope

In scope: the code in this repository, the published images and Helm chart,
and the reference deployment files. Out of scope: individual operators'
deployments and configuration (report those to the operator), denial of
service by volume, and findings that need a compromised device or account.

[docs/threat-model.md](docs/threat-model.md) describes what Quiz.me does and
does not defend against.

## Verifying releases

Release images are signed with cosign keyless signing. See
[docs/deploy.md](docs/deploy.md#verify-before-deploying).
