#!/usr/bin/env bash
# Claude Code Stop hook: when UI files changed, the turn cannot end while the screen is broken.
#
# Setup, in your project:
#   1. copy this file to .claude/hooks/look-before-done.sh and make it executable
#   2. set "baseUrl" in agent-eyes.config.json
#   3. list the screens worth checking in agent-eyes.checks.json (the --plan format), e.g.
#        [{"route": "/orders", "widths": ["1440", "390"]},
#         {"name": "panel", "route": "/orders", "actions": ["click:text=Details"], "frames": true, "measure": "#details"}]
#   4. in .claude/settings.json:
#        { "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": ".claude/hooks/look-before-done.sh" } ] } ] } }

# Only uncommitted changes to UI files trigger the look. Adjust the extensions to your stack.
git diff --name-only HEAD | grep -qE '\.(tsx|jsx|vue|svelte|css|scss|html)$' || exit 0

out=$(agent-eyes --plan agent-eyes.checks.json --strict 2>&1)
[ $? -eq 1 ] || exit 0     # 1 = something is wrong on screen (or the dev server is down); otherwise let the turn end
echo "$out" >&2
exit 2                     # exit 2 sends Claude back to work, with the findings as its next input
