from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alucheck.sample_data import ensure_demo_files


def main() -> None:
    paths = ensure_demo_files()
    for label, path in paths.items():
        print(f"{label:14s} {path}")


if __name__ == "__main__":
    main()
