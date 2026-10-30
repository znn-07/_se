from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alucheck.cad_parser import parse_dxf_bytes
from alucheck.matcher import build_stats, compare_specs
from alucheck.report import create_report, report_to_csv, report_to_html, report_to_json
from alucheck.specs import load_specs_from_bytes
from alucheck.utils import safe_filename


def _collect_dxf(paths: list[str]) -> list[Path]:
    files: list[Path] = []
    for raw in paths:
        path = Path(raw)
        if path.is_dir():
            files.extend(sorted(path.glob("*.dxf")))
            files.extend(sorted(path.glob("*.DXF")))
        elif path.is_file() and path.suffix.lower() == ".dxf":
            files.append(path)
    return list(dict.fromkeys(files))


def main() -> None:
    parser = argparse.ArgumentParser(description="ALU-CHECK headless batch inspection")
    parser.add_argument("dxf", nargs="+", help="DXF file(s) or folder(s)")
    parser.add_argument("--spec", required=True, help="Customer specification file")
    parser.add_argument("--out", default="reports", help="Output folder")
    parser.add_argument("--no-cache", action="store_true", help="Disable DXF parse cache")
    parser.add_argument("--html", action="store_true", help="Write per-file HTML reports")
    args = parser.parse_args()

    spec_path = Path(args.spec)
    spec_result = load_specs_from_bytes(spec_path.read_bytes(), spec_path.name)
    if not spec_result.specs:
        raise SystemExit("No usable specification items were parsed.")

    files = _collect_dxf(args.dxf)
    if not files:
        raise SystemExit("No DXF files found.")

    output = Path(args.out)
    output.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, object]] = []

    for path in files:
        try:
            document = parse_dxf_bytes(
                path.read_bytes(),
                path.name,
                use_cache=not args.no_cache,
            )
            results = compare_specs(document, spec_result.specs)
            stats = build_stats(results)
            report = create_report(
                document,
                spec_result.specs,
                results,
                spec_filename=spec_path.name,
            )
            stem = safe_filename(path.stem)
            (output / f"{stem}_report.csv").write_text(
                report_to_csv(report), encoding="utf-8-sig"
            )
            (output / f"{stem}_report.json").write_text(
                report_to_json(report), encoding="utf-8"
            )
            if args.html:
                (output / f"{stem}_report.html").write_text(
                    report_to_html(report), encoding="utf-8"
                )
            rows.append(
                {
                    "file": path.name,
                    "title": document.title,
                    "total": stats["total"],
                    "pass": stats["pass"],
                    "fail": stats["fail"],
                    "missing": stats["missing"],
                    "pass_rate": stats["pass_rate"],
                    "tamper": stats["tamper_count"],
                    "status": "ok",
                    "message": "",
                }
            )
            print(
                f"{path.name:40s} pass={stats['pass']:2d} fail={stats['fail']:2d} "
                f"missing={stats['missing']:2d} tamper={stats['tamper_count']:2d}"
            )
        except Exception as exc:
            rows.append(
                {
                    "file": path.name,
                    "title": "",
                    "total": 0,
                    "pass": 0,
                    "fail": 0,
                    "missing": 0,
                    "pass_rate": 0,
                    "tamper": 0,
                    "status": "error",
                    "message": str(exc),
                }
            )
            print(f"{path.name:40s} ERROR {exc}", file=sys.stderr)

    summary = output / "batch_summary.csv"
    with summary.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"\nSummary: {summary}")


if __name__ == "__main__":
    main()
