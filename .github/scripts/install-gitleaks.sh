#!/usr/bin/env bash
# Install a pinned gitleaks release and verify its checksum before use.
set -euo pipefail
VERSION="8.30.1"
SHA256="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
tmp="$(mktemp -d)"
curl -sSfL -o "$tmp/gitleaks.tar.gz" \
  "https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/gitleaks_${VERSION}_linux_x64.tar.gz"
echo "${SHA256}  $tmp/gitleaks.tar.gz" | sha256sum -c -
tar -xzf "$tmp/gitleaks.tar.gz" -C "$tmp" gitleaks
install -m 0755 "$tmp/gitleaks" /usr/local/bin/gitleaks
gitleaks version
