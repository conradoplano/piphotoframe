"""Backlight and ambient light sensor drivers (with simulated versions for development)."""

from __future__ import annotations

import logging
import time
from pathlib import Path

log = logging.getLogger(__name__)

I2C_BUS = 1  # GPIO2 (SDA, pin 3) / GPIO3 (SCL, pin 5)


# ---- light sensors --------------------------------------------------------

class LightSensor:
    name = "sensor"

    def read_lux(self) -> float:
        raise NotImplementedError


class BH1750(LightSensor):
    """BH1750 / GY-302 module. ADDR pin low or floating = 0x23, high = 0x5C."""

    name = "BH1750"
    CONTINUOUS_HIGH_RES = 0x10

    def __init__(self, bus: int = I2C_BUS, address: int = 0x23):
        from smbus2 import SMBus
        self.address = address
        self.bus = SMBus(bus)
        self.bus.write_byte(address, self.CONTINUOUS_HIGH_RES)
        time.sleep(0.2)
        self.read_lux()

    def read_lux(self) -> float:
        from smbus2 import i2c_msg
        msg = i2c_msg.read(self.address, 2)
        self.bus.i2c_rdwr(msg)
        hi, lo = list(msg)
        return ((hi << 8) | lo) / 1.2


class VEML7700(LightSensor):
    """VEML7700 module at 0x10. Gain x2, 100 ms integration: 0.0288 lux/count, max ~1900 lux."""

    name = "VEML7700"
    ADDRESS = 0x10
    RESOLUTION = 0.0288

    def __init__(self, bus: int = I2C_BUS):
        from smbus2 import SMBus
        self.bus = SMBus(bus)
        self.bus.write_word_data(self.ADDRESS, 0x00, 0x0800)  # ALS_GAIN=x2, IT=100ms, power on
        time.sleep(0.2)
        self.read_lux()

    def read_lux(self) -> float:
        return self.bus.read_word_data(self.ADDRESS, 0x04) * self.RESOLUTION


class MockSensor(LightSensor):
    name = "simulated"

    def __init__(self, lux: float = 150.0):
        self.lux = lux

    def read_lux(self) -> float:
        return self.lux


def detect_sensor() -> LightSensor | None:
    if not Path(f"/dev/i2c-{I2C_BUS}").exists():
        return None
    for factory in (BH1750, lambda: BH1750(address=0x5C), VEML7700):
        try:
            sensor = factory()
            log.info("Light sensor found: %s", sensor.name)
            return sensor
        except Exception:
            continue
    return None


# ---- backlight ------------------------------------------------------------

class Backlight:
    name = "backlight"

    def set_percent(self, pct: float) -> None:
        raise NotImplementedError

    def set_power(self, on: bool) -> None:
        raise NotImplementedError


class SysfsBacklight(Backlight):
    def __init__(self, path: Path):
        self.path = path
        self.name = path.name
        self.max = int((path / "max_brightness").read_text().strip())
        self._last: int | None = None
        self._power: bool | None = None

    @classmethod
    def find(cls) -> "SysfsBacklight | None":
        for p in sorted(Path("/sys/class/backlight").glob("*")):
            try:
                return cls(p)
            except Exception as e:
                log.warning("Backlight %s unusable: %s", p, e)
        return None

    def set_percent(self, pct: float) -> None:
        value = max(1, min(self.max, round(self.max * pct / 100)))
        if value != self._last:
            (self.path / "brightness").write_text(str(value))
            self._last = value

    def set_power(self, on: bool) -> None:
        if on == self._power:
            return
        self._power = on
        bl_power = self.path / "bl_power"
        if bl_power.exists():
            bl_power.write_text("0" if on else "4")
        elif not on:
            (self.path / "brightness").write_text("0")
            self._last = 0


class MockBacklight(Backlight):
    name = "simulated"

    def __init__(self):
        self.percent = 100.0
        self.on = True

    def set_percent(self, pct: float) -> None:
        self.percent = pct

    def set_power(self, on: bool) -> None:
        self.on = on
