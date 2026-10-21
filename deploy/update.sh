#!/usr/bin/env bash
# Pull the latest code and restart. Run on the Pi from the repo: ./deploy/update.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
git pull --ff-only
.venv/bin/pip install -r requirements.txt
sudo systemctl restart photoframe.service
sudo systemctl restart photoframe-kiosk.service
echo "Updated."
