# Photo frame

A digital photo frame for a Raspberry Pi 4 with the Waveshare 10.1" DSI touch display (800×1280, portrait).

- Shows photos from one or more **Synology Photos shared albums**, synced once a day.
- Clock in the bottom-left corner and weather in the bottom-right, using Open-Meteo (no API key needed). The layout follows the number of cities:
  - **one city**: large clock, date, current weather and an optional 3-day forecast
  - **two or three cities**: the first city as above, with the others smaller below it (local time and current weather each)
- Swipe left or right to change photos. Long-press (about 1 second) to show a QR code that opens the settings page.
- Short videos in the albums are not shown like photos: swiping to the next photo first plays one of them (muted, at most one per minute by default), then shows the next photo. Optionally they also play between photos in the automatic slideshow.
- Screen brightness follows the room light (BH1750 or VEML7700 sensor). The screen can turn off in a dark room or on a night schedule; a touch wakes it for a minute.
- If no Wi-Fi is configured, the frame shows a network list and an on-screen keyboard. If the connection drops, the slideshow keeps running from the local cache until the next daily sync.
- Settings page for phones and computers at `http://photoframe.local/` or `http://<frame-ip>/`. From there you can also install updates, restart the frame or shut it down.

## Hardware

| Part | Notes |
|---|---|
| Raspberry Pi 4 Model B | 2 GB is enough |
| Waveshare 10.1-DSI-TOUCH-A | connects to the Pi's DSI port with the 15-pin ribbon from the box |
| Power supply, 5.1 V / 3 A, USB-C | e.g. the official Raspberry Pi supply; a weak supply is the most common cause of SD card corruption |
| microSD card, 32 GB, A1 or A2 | a known brand; about 5,000 photos take 3–4 GB |
| BH1750 light sensor (GY-302 module) | about €3; a VEML7700 also works and is detected automatically |
| 4 female-to-female jumper wires | to connect the sensor |
| Heatsinks (optional) | keep the Pi cool with the browser running all day |

### Wiring the light sensor (I2C on the GPIO header)

Shut the Pi down before connecting or moving wires.

| Sensor pin | Pi pin |
|---|---|
| VCC | pin 1 (3.3 V) — not 5 V |
| GND | pin 9 (pin 6 also works if the display isn't using it) |
| SDA (may be labelled **DAT**) | pin 3 (GPIO2) |
| SCL | pin 5 (GPIO3) |
| ADDR (BH1750) | ground (e.g. pin 14), so the address is always 0x23 |

Pin 1 is the corner pin at the SD-card end of the header, on the row facing the middle of the board. If the sensor's header pins came loose in the bag, they must be soldered: pins only pushed through the board don't make reliable contact.

Mount the sensor so it faces the room and doesn't pick up light from the screen, for example on the top edge of the frame, pointing forward.

## Installing on the Pi

1. Flash **Raspberry Pi OS Lite (64-bit)** with Raspberry Pi Imager. In the Imager settings, set:
   - hostname `photoframe`
   - your username and password
   - Wi-Fi network and **Wi-Fi country** (the network is optional, because the frame can do the setup on screen)
   - time zone
   - SSH enabled
2. Connect with `ssh <username>@photoframe.local`, then get the code:
   ```sh
   sudo apt update && sudo apt install -y git
   git clone https://github.com/conradoplano/piphotoframe.git ~/photoframe
   ```
   For a private repository, git asks for a username and password: use a GitHub personal access token as the password.
3. Install and reboot (about 10–15 minutes):
   ```sh
   cd ~/photoframe
   sudo ./deploy/install.sh
   # optional settings: sudo WIFI_COUNTRY=DE TZ_NAME=Europe/Berlin FRAME_HOSTNAME=photoframe ./deploy/install.sh
   sudo reboot
   ```
4. Open `http://photoframe.local/` (or scan the QR code on the frame) and add your albums and cities.

What the installer sets up:
- Chromium in kiosk mode inside the `cage` Wayland compositor, on tty1, with an invisible mouse cursor
- the display overlay `vc4-kms-dsi-waveshare-panel-v2,10_1_inch_a` in `config.txt`
- I2C for the light sensor
- write access to the backlight (udev rule)
- permission to change Wi-Fi, restart and shut down (polkit rule)
- two systemd services: `photoframe` (the server, on port 80) and `photoframe-kiosk` (the display)

Running `install.sh` again is safe; it reapplies everything.

### Updating

On the settings page, go to **System → Check for updates**, then **Install update**. The frame:
1. pulls the latest commit from GitHub (`git pull --ff-only`)
2. updates the Python packages
3. restarts itself; systemd brings it back within seconds

The frame screen then reloads by itself. Over SSH, `./deploy/update.sh` does the same.

- Changes to files under `deploy/` (the installer, services, cursor) only take effect after running `sudo ./deploy/install.sh` again.
- If the GitHub repository is **private**, the Pi needs read access to fetch updates. Use one of:
  - a deploy key: `ssh-keygen` on the Pi, add the public key under the repo's *Settings → Deploy keys*, then `git remote set-url origin git@github.com:conradoplano/piphotoframe.git`
  - a saved personal access token: `git config credential.helper store`, followed by one `git pull` where you enter the token
- The update only works if the code on the Pi hasn't been edited locally, because the pull refuses to overwrite local changes.

### Turning it off

Use **System → Shut down** on the settings page (or `sudo shutdown now` over SSH). Wait until the screen is dark and the green LED on the Pi stops blinking, then unplug it. The Pi 4 has no power button: to turn it on again, plug the power back in.

### Troubleshooting

- **Logs:** `journalctl -u photoframe -f` (server) and `journalctl -u photoframe-kiosk -f` (display).
- **Light sensor not found** (the settings page says "no sensor"): run `sudo i2cdetect -y 1`. A BH1750 shows up at `23` (or `5c` with ADDR high), a VEML7700 at `10`. An empty grid means a wiring problem: check the pins, swapped SDA/SCL, unsoldered header pins, or try another sensor. Once it appears, the frame picks it up within a minute.
- **Screen stays dark after a touch at night:** check **Darkest room** brightness; a few percent can look the same as off on this panel.
- **Brightness doesn't change:** run `ls /sys/class/backlight/`. It should list one device. The settings page shows which backlight was found.
- **Picture rotated:** uncomment `FRAME_ROTATE=90` in `/etc/systemd/system/photoframe-kiosk.service` (also try 270), then run `sudo systemctl daemon-reload && sudo systemctl restart photoframe-kiosk`.
- **Mouse pointer visible in the middle of the screen:** run `sudo ./deploy/install.sh` again; it installs the invisible cursor.

## Synology album links

In Synology Photos, open the album → **Share** → turn on the public share link and copy it. It looks like
`https://nas.example.com:5001/mo/sharing/AbCdEf123`. Password-protected links work too: enter the password under the album on the settings page. The frame downloads Synology's 1280 px thumbnails rather than the originals, which is fast and enough for this screen.

For videos, the frame downloads the 720p H.264 version that Synology Photos creates itself (videos without it yet are picked up at a later sync), which the Pi plays smoothly. Videos longer than one minute are never downloaded; longer than the configured clip length, they are either played only from the beginning or skipped (settings page → Slideshow → Short videos).

The frame has to be able to reach the NAS at that address from your home network. If your router doesn't support reaching its own public address from inside the network ("NAT loopback"), use a local address in the link instead, such as `https://192.168.1.10:5001/mo/sharing/…`. In that case, also turn off **Verify the NAS's HTTPS certificate** under System, because the certificate won't match that address.

## Security

The settings page has no login: anyone on your home network can change the settings, restart or shut down the frame. Don't expose port 80 of the frame to the internet.

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

Album sync and weather are real in dev mode, so you can test with your own albums. Restart, shut down and installing updates are simulated or disabled, so they never touch your PC or working copy. Changes to `.html`, `.js` and `.css` files show after reloading the page; changes to Python files need a server restart.

The frame uses the Inter font, which is slightly wider than the fonts on most PCs, so check layout changes on the real screen too.

## Layout

```
photoframe/
  app.py         HTTP API + pages
  config.py      settings (stored as JSON) and their defaults
  synology.py    Synology Photos share-link client
  sync.py        daily sync, download, keeps the cache when offline
  library.py     local photo cache and per-fit-mode renders
  render.py      composes each photo at 800×1280 (blurred background / crop / black bars)
  weather.py     Open-Meteo forecast + city search
  brightness.py  lux → backlight curve, dark-room / night switch-off, touch wake
  hardware.py    BH1750 / VEML7700 / sysfs backlight drivers (+ simulated ones)
  network.py     NetworkManager (nmcli) Wi-Fi status / scan / connect
  updater.py     update from GitHub via the settings page
  web/           frame.html (kiosk), config.html (settings), preview.html (dev)
deploy/          install script, systemd units, polkit/udev/PAM rules, kiosk launcher, invisible cursor
tests/           unit tests (pytest)
```
