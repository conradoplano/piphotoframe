import argparse
import logging
from pathlib import Path

import uvicorn

from .app import create_app
from .settings import Settings


def main() -> None:
    parser = argparse.ArgumentParser(prog="photoframe", description="Photo frame server")
    parser.add_argument("--data-dir", type=Path, help="where config and photos are stored")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int)
    parser.add_argument("--dev", action="store_true",
                        help="local development: mock hardware, ./data, port 8080")
    parser.add_argument("--mock", action="store_true",
                        help="use simulated backlight, light sensor and Wi-Fi")
    parser.add_argument("--log-level", default="info")
    args = parser.parse_args()

    logging.basicConfig(level=args.log_level.upper(),
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    settings = Settings(
        data_dir=args.data_dir or (Path("data") if args.dev else Path("/var/lib/photoframe")),
        port=args.port or (8080 if args.dev else 80),
        mock=args.mock or args.dev,
        dev=args.dev,
    )
    uvicorn.run(create_app(settings), host=args.host, port=settings.port,
                log_level=args.log_level.lower())


if __name__ == "__main__":
    main()
