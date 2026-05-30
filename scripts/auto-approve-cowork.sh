#!/usr/bin/env bash
# auto-approve-cowork.sh
#
# Watches for Cowork's permission dialogs and auto-clicks Allow / Allow Always
# every 3 seconds. Use overnight so scheduled tasks can run unattended.
#
# PREREQUISITES
# 1. Terminal needs Accessibility permission:
#    System Settings → Privacy & Security → Accessibility → add Terminal.app
#    (or iTerm.app — whichever you run this from). Toggle it ON.
# 2. The Claude / Cowork app must be running and not minimized to the dock.
# 3. Do NOT lock the screen — when screen is locked, AppleScript can't click.
#    Disable auto-lock: System Settings → Lock Screen → Require password → Never
#    (re-enable in the morning).
#
# SECURITY
# This script clicks "Allow" / "Allow Always" / "Approve" on ANY window of the
# target app that has those buttons. If a prompt unrelated to your scheduled
# task pops up, this will accept it. Only run during overnight windows when
# you trust what the scheduled tasks will do. Kill the script after the tasks
# finish (Ctrl+C in the terminal where it's running, or `pkill -f auto-approve-cowork`).
#
# USAGE
#   chmod +x ~/Desktop/cos-app-v1/scripts/auto-approve-cowork.sh
#   ~/Desktop/cos-app-v1/scripts/auto-approve-cowork.sh
#
# To run in the background so the terminal can be closed:
#   nohup ~/Desktop/cos-app-v1/scripts/auto-approve-cowork.sh > /tmp/auto-approve.log 2>&1 &
#
# To stop it later:
#   pkill -f auto-approve-cowork

# The Cowork app likely runs under one of these process names. The script
# tries each in order until it finds one that's running. If none work, set
# APP_NAME manually below or check Activity Monitor for the exact name.
CANDIDATES=("Claude" "Cowork" "Anthropic Claude")
APP_NAME=""

for name in "${CANDIDATES[@]}"; do
  if pgrep -fi "$name" >/dev/null 2>&1; then
    APP_NAME="$name"
    break
  fi
done

if [ -z "$APP_NAME" ]; then
  echo "Could not find Cowork process. Check Activity Monitor for the exact app name,"
  echo "then edit this script and set APP_NAME at the top."
  exit 1
fi

echo "[$(date '+%H:%M:%S')] Watching $APP_NAME for permission prompts. Press Ctrl+C to stop."

while true; do
  CLICKED=$(osascript <<APPLESCRIPT 2>/dev/null
    set clickedCount to 0
    tell application "System Events"
      if exists (process "$APP_NAME") then
        tell process "$APP_NAME"
          set allWindows to every window
          repeat with w in allWindows
            try
              set buttonNames to {"Allow Always", "Allow always", "Allow", "Approve", "Yes, Allow"}
              repeat with bname in buttonNames
                try
                  set targetButtons to (every button of w whose name is bname)
                  repeat with b in targetButtons
                    click b
                    set clickedCount to clickedCount + 1
                  end repeat
                end try
                try
                  -- Some dialogs nest buttons inside groups / sheets
                  set targetButtons to (every button of (every group of w) whose name is bname)
                  repeat with b in targetButtons
                    click b
                    set clickedCount to clickedCount + 1
                  end repeat
                end try
              end repeat
            end try
          end repeat
        end tell
      end if
    end tell
    return clickedCount
APPLESCRIPT
)

  if [ -n "$CLICKED" ] && [ "$CLICKED" -gt 0 ] 2>/dev/null; then
    echo "[$(date '+%H:%M:%S')] Clicked $CLICKED approval button(s)."
  fi

  sleep 3
done
