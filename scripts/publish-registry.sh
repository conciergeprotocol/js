#!/usr/bin/env bash
# Lists server.json in the MCP registry. The registry checks npm for the version, and a new release can take several minutes to appear there.
set -euo pipefail

os=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
curl -fsSL "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_${os}_${arch}.tar.gz" | tar xz mcp-publisher
./mcp-publisher login github-oidc
for attempt in $(seq 1 20); do
  if ./mcp-publisher publish; then
    exit 0
  fi
  echo "npm has not shown this version yet (${attempt}). Waiting."
  sleep 30
done
exit 1
