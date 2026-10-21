from datetime import datetime, time

import pytest
from PIL import Image

from photoframe.brightness import compute_target, night_active
from photoframe.config import Brightness, Config, Night
from photoframe.network import split_terse
from photoframe.render import compose
from photoframe.sync import next_daily
from photoframe.synology import _to_photo, parse_share_url


@pytest.mark.parametrize("url, origin, prefix, passphrase", [
    ("https://nas.bayley-plano.com:5001/mo/sharing/2vj7QJMT7", "https://nas.bayley-plano.com:5001", "", "2vj7QJMT7"),
    ("https://nas.local/photo/mo/sharing/EkPUCJLDI", "https://nas.local", "/photo", "EkPUCJLDI"),
    ("http://192.168.1.5:5000/photo/sharing/abc/", "http://192.168.1.5:5000", "/photo", "abc"),
])
def test_parse_share_url(url, origin, prefix, passphrase):
    ref = parse_share_url(url)
    assert (ref.origin, ref.prefix, ref.passphrase) == (origin, prefix, passphrase)


@pytest.mark.parametrize("url", ["nas/mo/sharing/x", "https://nas/photo/", "https://nas/mo/sharing/"])
def test_parse_share_url_rejects(url):
    with pytest.raises(ValueError):
        parse_share_url(url)


def test_config_rejects_bad_album():
    with pytest.raises(ValueError):
        Config.model_validate({"albums": [{"url": "https://example.com/"}]})


def test_to_photo():
    item = {"id": 7, "filename": "a.jpg", "time": 100, "type": "photo",
            "additional": {"thumbnail": {"cache_key": "7_1", "unit_id": 7, "xl": "ready", "m": "ready"},
                           "resolution": {"width": 4000, "height": 3000}}}
    p = _to_photo(item)
    assert p.unit_id == 7 and p.size == "xl" and p.cache_key == "7_1"
    assert _to_photo({**item, "type": "video"}) is None
    assert _to_photo({**item, "additional": {"thumbnail": {"cache_key": "7_1", "xl": "broken", "m": "broken"}}}) is None


def test_brightness_curve():
    b = Brightness(min_pct=10, max_pct=100, dark_lux=1, bright_lux=1000)
    assert compute_target(b, 0) == 10
    assert compute_target(b, 5000) == 100
    assert compute_target(b, 31.62) == pytest.approx(55, abs=0.5)  # log midpoint
    assert compute_target(b, None) == b.manual_pct
    assert compute_target(Brightness(auto=False, manual_pct=42), 500) == 42


def test_night_window():
    n = Night(enabled=True, start="23:00", end="07:00")
    assert night_active(n, time(23, 30)) and night_active(n, time(6, 59))
    assert not night_active(n, time(7, 0)) and not night_active(n, time(12, 0))
    day = Night(enabled=True, start="13:00", end="14:00")
    assert night_active(day, time(13, 15)) and not night_active(day, time(14, 1))
    assert not night_active(Night(enabled=False), time(23, 30))


def test_next_daily():
    now = datetime(2026, 10, 21, 12, 0)
    assert next_daily("03:00", now) == datetime(2026, 10, 22, 3, 0)
    assert next_daily("18:30", now) == datetime(2026, 10, 21, 18, 30)


def test_split_terse():
    assert split_terse(r"*:My\:Net:80:WPA2") == ["*", "My:Net", "80", "WPA2"]


@pytest.mark.parametrize("mode", ["blur", "cover", "contain"])
@pytest.mark.parametrize("size", [(1600, 1200), (900, 1400), (1200, 1200)])
def test_compose_fills_screen(mode, size):
    out = compose(Image.new("RGB", size, (200, 50, 50)), mode, (800, 1280))
    assert out.size == (800, 1280)
