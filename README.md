# Photo frame

A digital photo frame for a Raspberry Pi 4 with the Waveshare 10.1" DSI touch display (800×1280, portrait).

- Shows photos from one or more **Synology Photos shared albums**, synced once a day.
- Clock in the bottom-left corner and weather in the bottom-right, using Open-Meteo (no API key needed). Two layouts:
  - **one city**: current weather plus a 3-day forecast
  - **three cities**: city name, local time and current weather on one line each
- Swipe left or right to change photos. Long-press to show a QR code that opens the settings page.
- Screen brightness follows the room light (BH1750 or VEML7700 sensor). There is also an optional night schedule that turns the screen off.
- If no Wi-Fi is configured, the frame shows a network list and an on-screen keyboard. If the connection drops, the slideshow keeps running from the local cache until the next daily sync.
- Settings page for phones and computers at `http://<frame-ip>/` (no login).

## Hardware

| Part | Notes |
|---|---|
| Raspberry Pi 4 Model B | 2 GB is enough |
| Waveshare 10.1-DSI-TOUCH-A | DSI ribbon to the Pi's DSI port |
| BH1750 light sensor (GY-302 module) | about €3; a VEML7700 also works and is detected automatically |
| microSD card, 16 GB or more | about 5,000 photos ≈ 2–3 GB |

### Wiring the light sensor (I2C on the GPIO header)

| Sensor | Pi pin |
|---|---|
| VCC | pin 1 (3.3 V) |
| GND | pin 6 |
| SDA | pin 3 (GPIO2) |
| SCL | pin 5 (GPIO3) |
| ADDR (BH1750) | leave unconnected |

Mount the sensor so it faces the room and doesn't pick up light from the screen, for example on the top edge of the frame, pointing forward.

## Installing on the Pi

1. Flash **Raspberry Pi OS Lite (64-bit)** with Raspberry Pi Imager. In the Imager settings, set:
   - hostname `photoframe`
   - your username and password
   - **Wi-Fi country** (Wi-Fi itself is optional, because the frame can do the setup on screen)
   - time zone
   - SSH enabled
2. Copy this folder to the Pi, for example `git clone <your repo> ~/photoframe`, or `scp -r` it.
3. Install and reboot:
   ```sh
   cd ~/photoframe
   sudo ./deploy/install.sh          # optional: WIFI_COUNTRY=CH TZ_NAME=Europe/Zurich sudo -E ./deploy/install.sh
   sudo reboot
   ```
4. Open `http://photoframe.local/` (or the address shown on the frame) and add your albums and cities.

### Updating

On the settings page, go to **System → Check for updates**, then **Install update**. The frame:
1. pulls the latest commit from GitHub (`git pull --ff-only`)
2. updates the Python packages
3. restarts itself; systemd brings it back within seconds

The frame screen then reloads by itself. Over SSH, `./deploy/update.sh` does the same.

If the GitHub repository is **private**, the Pi needs read access to fetch updates. Use one of:
- a deploy key: `ssh-keygen` on the Pi, add the public key under the repo's *Settings → Deploy keys*, then `git remote set-url origin git@github.com:conradoplano/piphotoframe.git`
- a saved personal access token: `git config credential.helper store`, followed by one `git pull` where you enter the token

The update only works if the code on the Pi hasn't been edited locally, because the pull refuses to overwrite local changes.

What the installer sets up:
- Chromium in kiosk mode inside the `cage` Wayland compositor, on tty1
- the display overlay `vc4-kms-dsi-waveshare-panel-v2,10_1_inch_a` in `config.txt`
- I2C for the light sensor
- write access to the backlight (udev rule)
- permission to change Wi-Fi and reboot (polkit rule)
- two systemd services: `photoframe` (the server, on port 80) and `photoframe-kiosk` (the display)

### Troubleshooting

- **Picture rotated:** uncomment `FRAME_ROTATE=90` in `/etc/systemd/system/photoframe-kiosk.service` (also try 270), then run `sudo systemctl daemon-reload && sudo systemctl restart photoframe-kiosk`.
- **Logs:** `journalctl -u photoframe -f` (server) and `journalctl -u photoframe-kiosk -f` (display).
- **Sensor not found:** run `i2cdetect -y 1`. A BH1750 should show up at `23` and a VEML7700 at `10`.
- **Brightness doesn't change:** run `ls /sys/class/backlight/`. It should list one device. The settings page shows which backlight was found.

## Synology album links

In Synology Photos, open the album → **Share** → turn on the public share link and copy it. It looks like
`https://nas.example.com:5001/mo/sharing/AbCdEf123`. Password-protected links work too: enter the password under the album on the settings page. The frame downloads Synology's 1280 px thumbnails rather than the originals, which is fast and enough for this screen. Videos are skipped.

The frame has to be able to reach the NAS at that address from your home network. If your router doesn't support reaching its own public address from inside the network ("NAT loopback"), use a local address in the link instead, such as `https://192.168.1.10:5001/mo/sharing/…`. In that case, also turn off **Verify the NAS's HTTPS certificate** under System, because the certificate won't match that address.

## Developing and testing on a PC

Everything except the real display, sensor and Wi-Fi runs on Windows, macOS or Linux, with simulated hardware:

```powershell
python -m venv .venv
.venv\Scripts\pip install -r requirements-dev.txt
.venv\Scripts\python -m photoframe --dev        # data in ./data, port 8080
.venv\Scripts\python -m pytest
```

- http://localhost:8080/preview shows the frame at its real layout, scaled down. It has controls for:
  - a room-light slider, which drives the simulated backlight dimming
  - dropping Wi-Fi, or starting as a new frame with no saved networks
- http://localhost:8080/ is the settings page.
- http://localhost:8080/frame is the frame page itself. Keyboard shortcuts: `←` `→` change photos, `q` shows the QR code, `w` opens Wi-Fi setup.

Album sync and weather are real in dev mode, so you can test with your own albums.

## Layout

```
photoframe/
  app.py         HTTP API + pages
  synology.py    Synology Photos share-link client
  sync.py        daily sync, download, keeps the cache when offline
  library.py     local photo cache and per-fit-mode renders
  render.py      composes each photo at 800×1280 (blurred background / crop / black bars)
  weather.py     Open-Meteo forecast + city search
  brightness.py  lux → backlight curve, night schedule
  hardware.py    BH1750 / VEML7700 / sysfs backlight drivers (+ simulated ones)
  network.py     NetworkManager (nmcli) Wi-Fi status / scan / connect
  web/           frame.html (kiosk), config.html (settings), preview.html (dev)
deploy/          install script, systemd units, polkit/udev/PAM rules, kiosk launcher
```
