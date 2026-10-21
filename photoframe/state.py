import time
from dataclasses import dataclass, field


@dataclass
class RuntimeState:
    """Live, non-persisted status shared between the background services and the API."""

    started: float = field(default_factory=time.monotonic)
    # network
    wifi_available: bool = True
    online: bool = False
    ssid: str | None = None
    has_saved_wifi: bool = False
    offline_at_sync: bool = False  # the daily sync found no network
    wifi_dismissed: bool = False   # user tapped "Back to photos" on the Wi-Fi screen
    needs_wifi: bool = False
    # display
    sensor: str | None = None
    lux: float | None = None
    brightness_pct: float = 100.0
    screen_on: bool = True
    wake_until: float = 0.0  # wall-clock time until which a touch keeps the screen on
