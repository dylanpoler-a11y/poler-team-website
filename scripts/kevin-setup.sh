#!/bin/bash
# ============================================
# Kevin's Auto-Sync Setup for poler-team-website
# Run once after cloning: bash scripts/kevin-setup.sh
# ============================================

set -e

echo "🏠 Setting up Poler Team Website auto-sync..."

# Get the repo root (where this script lives)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "📂 Repo path: $REPO_DIR"

# Verify we're in the right repo
if [ ! -f "$REPO_DIR/index.html" ] || [ ! -f "$REPO_DIR/CLAUDE.md" ]; then
    echo "❌ Error: This doesn't look like the poler-team-website repo."
    exit 1
fi

# Check git is configured
if ! git -C "$REPO_DIR" remote -v | grep -q "poler-team-website"; then
    echo "❌ Error: Git remote doesn't point to poler-team-website."
    exit 1
fi

PLIST_NAME="com.polerteam.autosync"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"

# Unload existing plist if present
if launchctl list | grep -q "$PLIST_NAME" 2>/dev/null; then
    echo "♻️  Unloading existing auto-sync..."
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi

# Detect git path
GIT_PATH=$(which git)
GIT_DIR=$(dirname "$GIT_PATH")

echo "🔧 Git found at: $GIT_PATH"

# Create the plist
cat > "$PLIST_PATH" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-c</string>
        <string>
REPO="${REPO_DIR}"
cd "\$REPO" || exit 0
[ "\$(git branch --show-current)" = "main" ] || exit 0

# Auto-push local changes
if ! git diff --quiet HEAD 2>/dev/null || ! git diff --cached --quiet HEAD 2>/dev/null; then
  CHANGED=\$(git diff --name-only HEAD 2>/dev/null | head -5 | tr '\n' ', ')
  STAGED=\$(git diff --cached --name-only 2>/dev/null | head -5 | tr '\n' ', ')
  FILES="\${CHANGED}\${STAGED}"
  git add -u
  SUMMARY=\$(git diff --cached --stat 2>/dev/null | tail -1)
  git commit -m "Auto-sync: \${SUMMARY}" --no-verify 2>/dev/null
  if git push origin main --quiet 2>/dev/null; then
    osascript -e "display notification \"Auto-pushed: \${FILES}\" with title \"Poler Website Pushed\" sound name \"Blow\""
  fi
fi

# Auto-pull remote changes
git fetch origin main --quiet 2>/dev/null || exit 0
LOCAL=\$(git rev-parse main 2>/dev/null)
REMOTE=\$(git rev-parse origin/main 2>/dev/null)
[ "\$LOCAL" = "\$REMOTE" ] &amp;&amp; exit 0
COUNT=\$(git rev-list "\$LOCAL".."\$REMOTE" --count 2>/dev/null)
git pull origin main --ff-only --quiet 2>/dev/null || exit 0
MSG=\$(git log -1 --pretty=format:"%s" 2>/dev/null)
WHO=\$(git log -1 --pretty=format:"%an" 2>/dev/null)
osascript -e "display notification \"\$COUNT commit(s) by \$WHO: \$MSG\" with title \"Poler Website Updated\" sound name \"Glass\""
        </string>
    </array>
    <key>StartInterval</key>
    <integer>120</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/polerteam-autosync.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/polerteam-autosync.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${GIT_DIR}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
PLIST

# Load the plist
launchctl load "$PLIST_PATH"

echo ""
echo "✅ Auto-sync is now active!"
echo "   - Checks every 2 minutes"
echo "   - Auto-commits & pushes your local changes"
echo "   - Auto-pulls Kevin's & Dylan's changes"
echo "   - macOS notifications on sync events"
echo ""
echo "📋 Commands:"
echo "   Check status:  launchctl list | grep polerteam"
echo "   View logs:     tail -f /tmp/polerteam-autosync.log"
echo "   Stop sync:     launchctl unload ~/Library/LaunchAgents/com.polerteam.autosync.plist"
echo "   Restart sync:  launchctl unload ~/Library/LaunchAgents/com.polerteam.autosync.plist && launchctl load ~/Library/LaunchAgents/com.polerteam.autosync.plist"
echo ""
echo "⚠️  NOTE: The hero video (sunny-isles-drone.mp4) is NOT in git (585MB)."
echo "   Ask Dylan to AirDrop it to you, then place it in the repo root."
