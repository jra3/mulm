#!/bin/bash
set -euo pipefail

# Only run in remote (Claude Code on the web) sessions; locally the user
# manages their own node_modules.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Install npm dependencies so lint, tests, and the dev server work.
# Skip Husky's prepare hook (it's a no-op without git hooks dir setup) and
# Playwright browser download (only needed for E2E, large, slow).
HUSKY=0 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund

# Tests and the app import "@/config.json"; create a stub from the sample
# if one doesn't already exist so type-checking and tests can resolve it.
if [ ! -f src/config.json ] && [ -f src/config.sample.json ]; then
  cp src/config.sample.json src/config.json
fi
