from dataclasses import dataclass
from pathlib import Path

# Native resolution of the Waveshare 10.1" DSI panel in portrait orientation.
SCREEN_SIZE = (800, 1280)


@dataclass
class Settings:
    data_dir: Path
    port: int = 80
    mock: bool = False
    dev: bool = False
    screen_size: tuple[int, int] = SCREEN_SIZE
