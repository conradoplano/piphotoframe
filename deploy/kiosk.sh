#!/bin/sh
# Runs inside cage: waits for the server, then shows the frame page full screen.
URL="${FRAME_URL:-http://127.0.0.1:80/frame}"

if [ -n "${FRAME_ROTATE:-}" ] && command -v wlr-randr >/dev/null; then
  OUTPUT=$(wlr-randr | awk 'NR==1 {print $1}')
  wlr-randr --output "$OUTPUT" --transform "$FRAME_ROTATE"
fi

until curl -fs -o /dev/null "$URL"; do sleep 1; done

CHROMIUM=$(command -v chromium || command -v chromium-browser)
PROFILE="$HOME/.cache/photoframe-chromium"
# a crashed/killed session must not show a "restore pages?" bubble
rm -rf "$PROFILE/Default/Sessions" 2>/dev/null

exec "$CHROMIUM" \
  --kiosk "$URL" \
  --ozone-platform=wayland \
  --user-data-dir="$PROFILE" \
  --noerrdialogs --disable-infobars --no-first-run \
  --disable-session-crashed-bubble --disable-features=Translate,TranslateUI \
  --overscroll-history-navigation=0 --disable-pinch \
  --check-for-update-interval=31536000 --password-store=basic \
  --autoplay-policy=no-user-gesture-required
