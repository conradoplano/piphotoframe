#!/usr/bin/env bash
# Installs the photo frame on Raspberry Pi OS Lite (64-bit). Run from the repo:
#   sudo ./deploy/install.sh
# Optional environment variables:
#   WIFI_COUNTRY=CH   two-letter country code for Wi-Fi regulations (needed if not set in Raspberry Pi Imager)
#   FRAME_HOSTNAME=photoframe   set the hostname (the frame is then reachable as http://photoframe.local)
#   TZ_NAME=Europe/Zurich   time zone used for the daily sync time and the night schedule
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Please run with sudo: sudo $0" >&2
  exit 1
fi

KIOSK_USER="${SUDO_USER:-}"
if [[ -z "$KIOSK_USER" || "$KIOSK_USER" == "root" ]]; then
  echo "Run this with sudo from your normal user account (not as root)." >&2
  exit 1
fi
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR=/var/lib/photoframe
BOOT_CONFIG=/boot/firmware/config.txt
[[ -f $BOOT_CONFIG ]] || BOOT_CONFIG=/boot/config.txt

echo "==> Installing packages"
apt-get update
apt-get install -y --no-install-recommends \
  python3-venv python3-pip cage wlr-randr curl i2c-tools network-manager avahi-daemon \
  fonts-inter fonts-dejavu-core
if apt-cache show chromium >/dev/null 2>&1; then
  apt-get install -y --no-install-recommends chromium
else
  apt-get install -y --no-install-recommends chromium-browser
fi

echo "==> Enabling I2C (light sensor)"
raspi-config nonint do_i2c 0 || true

if [[ -n "${WIFI_COUNTRY:-}" ]]; then
  echo "==> Setting Wi-Fi country to $WIFI_COUNTRY"
  raspi-config nonint do_wifi_country "$WIFI_COUNTRY" || true
fi
rfkill unblock wifi || true

if [[ -n "${TZ_NAME:-}" ]]; then
  timedatectl set-timezone "$TZ_NAME"
fi

if [[ -n "${FRAME_HOSTNAME:-}" ]]; then
  echo "==> Setting hostname to $FRAME_HOSTNAME"
  raspi-config nonint do_hostname "$FRAME_HOSTNAME" || hostnamectl set-hostname "$FRAME_HOSTNAME"
fi

echo "==> Configuring the Waveshare 10.1\" DSI display ($BOOT_CONFIG)"
if ! grep -q "vc4-kms-dsi-waveshare-panel" "$BOOT_CONFIG"; then
  cat >> "$BOOT_CONFIG" <<'EOF'

# --- photoframe: Waveshare 10.1-DSI-TOUCH-A ---
[all]
dtoverlay=vc4-kms-v3d
dtoverlay=vc4-kms-dsi-waveshare-panel-v2,10_1_inch_a
disable_splash=1
EOF
else
  echo "    (display overlay already present, leaving config.txt alone)"
fi

echo "==> Python environment"
sudo -u "$KIOSK_USER" python3 -m venv "$REPO_DIR/.venv"
sudo -u "$KIOSK_USER" "$REPO_DIR/.venv/bin/pip" install --upgrade pip
sudo -u "$KIOSK_USER" "$REPO_DIR/.venv/bin/pip" install -r "$REPO_DIR/requirements.txt"

echo "==> Data directory $DATA_DIR"
install -d -o "$KIOSK_USER" -g "$KIOSK_USER" "$DATA_DIR"

echo "==> Permissions for $KIOSK_USER (display, touch, I2C, backlight, Wi-Fi, reboot)"
usermod -aG video,render,input,i2c,netdev "$KIOSK_USER"
install -m 644 "$REPO_DIR/deploy/99-photoframe-backlight.rules" /etc/udev/rules.d/
sed "s/@USER@/$KIOSK_USER/g" "$REPO_DIR/deploy/50-photoframe.rules" > /etc/polkit-1/rules.d/50-photoframe.rules
install -m 644 "$REPO_DIR/deploy/pam-photoframe-kiosk" /etc/pam.d/photoframe-kiosk
udevadm control --reload-rules && udevadm trigger --subsystem-match=backlight || true

echo "==> Invisible mouse cursor for the kiosk"
rm -rf /usr/share/icons/photoframe-blank  # location used by an earlier version
python3 "$REPO_DIR/deploy/blank_cursor.py" /usr/share/photoframe/icons/default

echo "==> systemd services"
for unit in photoframe.service photoframe-kiosk.service; do
  sed -e "s|@USER@|$KIOSK_USER|g" -e "s|@REPO@|$REPO_DIR|g" -e "s|@DATA@|$DATA_DIR|g" \
    "$REPO_DIR/deploy/$unit" > "/etc/systemd/system/$unit"
done
chmod +x "$REPO_DIR/deploy/kiosk.sh" "$REPO_DIR/deploy/update.sh"
systemctl daemon-reload
systemctl disable getty@tty1.service || true
systemctl set-default graphical.target
systemctl enable photoframe.service photoframe-kiosk.service

echo
echo "Done. Reboot to start the frame:  sudo reboot"
echo "Settings page afterwards: http://$(hostname).local/  (or the IP address shown on the frame)"
