from __future__ import annotations

import base64
import csv
import html
import io
import json
import pickle
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .matcher import build_stats, document_summary
from .models import (
    ComparisonReport,
    MatchResult,
    SpecItem,
    STATUS_FAIL,
    STATUS_MISSING,
    STATUS_PASS,
    STATUS_WARNING,
    VisionResult,
    utc_now_iso,
)
from .utils import format_signed, format_value, safe_filename


@dataclass
class ReportArtifacts:
    run_dir: Path
    html_path: Path | None = None
    json_path: Path | None = None
    csv_path: Path | None = None
    pickle_path: Path | None = None
    drawing_path: Path | None = None
    vision_path: Path | None = None
    files: list[Path] = field(default_factory=list)


def create_report(
    document: Any,
    specs: list[SpecItem],
    results: list[MatchResult],
    *,
    spec_filename: str,
    settings: dict[str, Any] | None = None,
    vision: VisionResult | None = None,
    warnings: list[str] | None = None,
    annotated_png: bytes | None = None,
    vision_png: bytes | None = None,
) -> ComparisonReport:
    stats = build_stats(results)
    doc_summary = document_summary(document)
    all_warnings = list(dict.fromkeys([*document.warnings, *(warnings or [])]))
    return ComparisonReport(
        filename=document.filename,
        spec_filename=spec_filename,
        created_at=utc_now_iso(),
        results=results,
        stats=stats,
        document_summary=doc_summary,
        vision=vision,
        settings=settings or {},
        warnings=all_warnings,
        annotated_png=annotated_png,
        vision_png=vision_png or (vision.image_png if vision else None),
    )


def report_to_json(report: ComparisonReport, indent: int = 2) -> str:
    return json.dumps(report.as_dict(include_bytes=False), ensure_ascii=False, indent=indent)


def report_to_csv(report: ComparisonReport) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(
        [
            "規格編號",
            "規格名稱",
            "目標值",
            "單位",
            "公差",
            "CAD Handle",
            "CAD 圖元",
            "CAD 標註文字",
            "實測值",
            "偏差",
            "偏差%",
            "狀態",
            "文字異常",
            "判斷原因",
        ]
    )
    for result in report.results:
        measurement = result.measurement
        writer.writerow(
            [
                result.spec.id,
                result.spec.name,
                "" if result.spec.target is None else f"{result.spec.target:g}",
                result.spec.unit,
                result.spec.tolerance_text,
                measurement.handle if measurement else "",
                measurement.display_label if measurement else "",
                measurement.text_override if measurement else "",
                "" if result.actual_value is None else f"{result.actual_value:g}",
                "" if result.diff is None else f"{result.diff:g}",
                "" if result.deviation_pct is None else f"{result.deviation_pct:g}",
                result.status_label,
                "是" if result.tamper else "否",
                " / ".join(result.reasons),
            ]
        )
    return buffer.getvalue()


def _b64_png(data: bytes | None) -> str:
    if not data:
        return ""
    return "data:image/png;base64," + base64.b64encode(data).decode("ascii")


def _status_class(result: MatchResult) -> str:
    return result.tone


def _row_reasons(result: MatchResult) -> str:
    if not result.reasons:
        return ""
    return "<br>".join(html.escape(reason) for reason in result.reasons)


def _metric_card(label: str, value: str, tone: str, hint: str = "") -> str:
    hint_html = f"<small>{html.escape(hint)}</small>" if hint else ""
    return (
        f'<div class="metric metric--{tone}">'
        f"<span>{html.escape(label)}</span>"
        f"<strong>{html.escape(value)}</strong>"
        f"{hint_html}"
        "</div>"
    )


def report_to_html(report: ComparisonReport) -> str:
    stats = report.stats
    vision = report.vision
    overall = report.overall_status
    overall_label = report.overall_label
    overall_tone = report.overall_tone
    created = report.created_at.replace("T", " ")[:19]
    doc = report.document_summary

    cards = "".join(
        [
            _metric_card("規格總數", str(stats.get("total", 0)), "neutral", "SPECS"),
            _metric_card("合格", str(stats.get("pass", 0)), "good", "PASS"),
            _metric_card("超差", str(stats.get("fail", 0)), "bad", "FAIL"),
            _metric_card("缺漏 / 需複核", f"{stats.get('missing', 0)} / {stats.get('warning', 0)}", "warn", "MISSING"),
            _metric_card("通過率", f"{stats.get('pass_rate', 0):.1f}%", "info", f"CHECKED {stats.get('checked', 0)}"),
            _metric_card("文字異常", str(stats.get("tamper_count", 0)), "bad" if stats.get("tamper_count") else "neutral", "TAMPER"),
        ]
    )

    rows: list[str] = []
    for result in report.results:
        measurement = result.measurement
        actual = (
            format_value(result.actual_value, measurement.unit)
            if measurement
            else "—"
        )
        diff = format_value(result.diff, measurement.unit, 3) if result.diff is not None else "—"
        handle = html.escape(measurement.handle) if measurement else "—"
        label = html.escape(measurement.display_label) if measurement else "—"
        tamper = '<span class="flag">文字覆寫</span>' if result.tamper else ""
        rows.append(
            f'<tr class="row--{_status_class(result)}">'
            f'<td class="mono">{html.escape(result.spec.id)}</td>'
            f"<td><strong>{html.escape(result.spec.name)}</strong>"
            f'<div class="muted">{html.escape(result.spec.note)[:90]}</div></td>'
            f'<td class="num">{html.escape(format_value(result.spec.target, result.spec.unit))}'
            f'<div class="muted">{html.escape(result.spec.tolerance_text)}</div></td>'
            f'<td class="num">{html.escape(actual)}<div class="muted">{html.escape(label)} · {handle}</div></td>'
            f'<td class="num">{html.escape(diff)}</td>'
            f'<td><span class="pill pill--{_status_class(result)}">{html.escape(result.status_label)}</span>{tamper}</td>'
            f'<td class="reasons">{_row_reasons(result)}</td>'
            "</tr>"
        )

    drawing_html = ""
    if report.annotated_png:
        drawing_html = (
            '<section class="panel"><div class="panel-head"><h2>CAD 圖面標註</h2>'
            '<span class="muted">紅框 = 超差 / 黃框 = 需複核 / 文字異常會額外標記</span></div>'
            f'<img class="drawing" src="{_b64_png(report.annotated_png)}" alt="CAD annotated drawing"></section>'
        )

    vision_html = ""
    if vision:
        vision_image = ""
        if report.vision_png:
            vision_image = (
                f'<img class="drawing" src="{_b64_png(report.vision_png)}" alt="Geometry comparison">'
            )
        vision_rows = "".join(
            [
                f"<div><span>形狀差異</span><strong>{vision.shape_diff:.4f}</strong></div>",
                f"<div><span>面積比</span><strong>{vision.area_ratio * 100:.1f}%</strong></div>",
                f"<div><span>最大質心偏移</span><strong>{vision.centroid_shift * 100:.2f}%</strong></div>",
                f"<div><span>線條重疊率</span><strong>{vision.overlap * 100:.1f}%</strong></div>",
                f"<div><span>輪廓數</span><strong>{vision.contour_count}</strong></div>",
            ]
        )
        vision_html = (
            '<section class="panel"><div class="panel-head"><h2>幾何視覺防呆</h2>'
            f'<span class="pill pill--{vision.tone}">{html.escape(vision.status_label)}</span></div>'
            f'<p class="muted">{html.escape(vision.message)}</p>'
            f'<div class="vision-grid">{vision_rows}</div>{vision_image}</section>'
        )

    warnings_html = ""
    if report.warnings:
        warnings_html = (
            '<section class="panel"><div class="panel-head"><h2>解析提醒</h2></div><ul class="warnings">'
            + "".join(f"<li>{html.escape(w)}</li>" for w in report.warnings)
            + "</ul></section>"
        )

    settings = report.settings or {}
    settings_html = "".join(
        f"<div><span>{html.escape(str(key))}</span><strong>{html.escape(str(value))}</strong></div>"
        for key, value in settings.items()
    )

    html_doc = f"""<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ALU-CHECK 比對報告 · {html.escape(report.filename)}</title>
<style>
:root {{
  color-scheme: dark;
  --bg: #080d17;
  --panel: #0e1626;
  --panel-2: #111c2f;
  --line: #21304a;
  --text: #e6edf7;
  --muted: #7d8ca3;
  --good: #3ddc97;
  --bad: #ff5c72;
  --warn: #f5b642;
  --info: #65d4ff;
}}
* {{ box-sizing: border-box; }}
body {{
  margin: 0; background:
    radial-gradient(1000px 600px at 10% -10%, rgba(101,212,255,.10), transparent 60%),
    radial-gradient(800px 500px at 95% 0%, rgba(245,182,66,.09), transparent 55%),
    var(--bg);
  color: var(--text);
  font-family: "Segoe UI", "Microsoft JhengHei", "Noto Sans TC", sans-serif;
  line-height: 1.55;
}}
.wrap {{ max-width: 1280px; margin: 0 auto; padding: 42px 28px 70px; }}
header.top {{ display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; }}
.brand {{ display: flex; gap: 16px; align-items: center; }}
.logo {{
  width: 52px; height: 52px; border-radius: 15px; display: grid; place-items: center;
  background: linear-gradient(145deg, #f5b642, #ffd77a 45%, #65d4ff);
  color: #0a1220; font-weight: 900; font-size: 18px; letter-spacing: -.04em;
  box-shadow: 0 10px 40px rgba(245,182,66,.22);
}}
h1 {{ margin: 0; font-size: 25px; letter-spacing: -.02em; }}
.sub {{ color: var(--muted); font-size: 13px; margin-top: 3px; }}
.meta {{ text-align: right; color: var(--muted); font-size: 12px; }}
.meta strong {{ color: var(--text); font-weight: 600; }}
.banner {{
  margin: 30px 0 18px; padding: 22px 26px; border-radius: 20px;
  border: 1px solid var(--line); background: linear-gradient(120deg, var(--panel), var(--panel-2));
  display: flex; justify-content: space-between; gap: 24px; align-items: center;
  border-left: 5px solid var(--{overall_tone});
}}
.banner h2 {{ margin: 0 0 4px; font-size: 27px; color: var(--{overall_tone}); }}
.banner p {{ margin: 0; color: var(--muted); font-size: 13px; }}
.big-rate {{ font-size: 42px; font-weight: 800; letter-spacing: -.04em; color: var(--{overall_tone}); }}
.big-rate small {{ display: block; font-size: 11px; color: var(--muted); letter-spacing: .12em; font-weight: 500; }}
.metrics {{ display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; margin-bottom: 20px; }}
.metric {{
  padding: 16px 17px; border: 1px solid var(--line); border-radius: 16px;
  background: rgba(14,22,38,.78); position: relative; overflow: hidden;
}}
.metric::after {{ content:""; position:absolute; inset:0 auto 0 0; width:3px; background: var(--{overall_tone}); opacity:.7; }}
.metric span {{ display:block; font-size: 11px; color: var(--muted); letter-spacing: .08em; }}
.metric strong {{ display:block; font-size: 25px; margin: 4px 0 0; letter-spacing: -.03em; }}
.metric small {{ color: var(--muted); font-size: 9px; letter-spacing: .14em; }}
.metric--good strong {{ color: var(--good); }}
.metric--bad strong {{ color: var(--bad); }}
.metric--warn strong {{ color: var(--warn); }}
.metric--info strong {{ color: var(--info); }}
.panel {{
  border: 1px solid var(--line); border-radius: 20px; background: rgba(14,22,38,.8);
  padding: 20px; margin: 18px 0; overflow: hidden;
}}
.panel-head {{ display:flex; justify-content:space-between; gap:16px; align-items:baseline; margin-bottom: 12px; }}
.panel h2 {{ margin: 0; font-size: 16px; letter-spacing: .01em; }}
.muted {{ color: var(--muted); font-size: 12px; }}
table {{ width: 100%; border-collapse: collapse; font-size: 12px; }}
th {{ text-align: left; color: var(--muted); font-weight: 600; font-size: 10px; letter-spacing: .08em; padding: 10px 9px; border-bottom: 1px solid var(--line); white-space: nowrap; }}
td {{ padding: 12px 9px; border-bottom: 1px solid rgba(33,48,74,.55); vertical-align: top; }}
tr:last-child td {{ border-bottom: 0; }}
tr.row--bad td:first-child {{ box-shadow: inset 3px 0 0 var(--bad); }}
tr.row--warn td:first-child {{ box-shadow: inset 3px 0 0 var(--warn); }}
tr.row--good td:first-child {{ box-shadow: inset 3px 0 0 rgba(61,220,151,.55); }}
.mono {{ font-family: "Cascadia Code", Consolas, monospace; color: var(--info); white-space: nowrap; }}
.num {{ white-space: nowrap; font-variant-numeric: tabular-nums; }}
.reasons {{ min-width: 260px; color: #b9c7da; }}
.pill {{ display:inline-block; padding: 3px 9px; border-radius: 99px; font-size: 10px; font-weight: 700; letter-spacing: .04em; white-space: nowrap; }}
.pill--good {{ color: #06251a; background: var(--good); }}
.pill--bad {{ color: #2b060c; background: var(--bad); }}
.pill--warn {{ color: #2a1b02; background: var(--warn); }}
.pill--muted {{ color: #1b2433; background: #9aa8ba; }}
.flag {{ display:inline-block; margin-left:5px; padding:2px 6px; border:1px solid rgba(255,92,114,.5); color:var(--bad); border-radius:5px; font-size:9px; }}
.drawing {{ width: 100%; border-radius: 14px; border: 1px solid var(--line); margin-top: 10px; background: #0b1220; }}
.vision-grid {{ display:grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin: 12px 0; }}
.vision-grid div {{ background: var(--panel-2); border:1px solid var(--line); border-radius:12px; padding:10px 12px; }}
.vision-grid span {{ display:block; color:var(--muted); font-size:10px; }}
.vision-grid strong {{ display:block; margin-top:2px; font-size:16px; }}
.warnings {{ margin: 4px 0 0; padding-left: 20px; color: #c4d0e0; font-size: 12px; }}
.warnings li {{ margin: 6px 0; }}
.info-grid {{ display:grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }}
.info-grid div {{ padding: 10px 12px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 12px; }}
.info-grid span {{ display:block; color:var(--muted); font-size:10px; }}
.info-grid strong {{ display:block; margin-top:2px; font-size:13px; word-break: break-all; }}
footer {{ margin-top: 34px; padding-top: 18px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11px; display:flex; justify-content:space-between; gap: 18px; }}
@media (max-width: 980px) {{
  .metrics {{ grid-template-columns: repeat(3, 1fr); }}
  .vision-grid, .info-grid {{ grid-template-columns: repeat(2, 1fr); }}
  .banner {{ flex-direction: column; align-items: flex-start; }}
}}
@media print {{
  body {{ background: #fff; color: #111; }}
  .wrap {{ padding: 10mm; max-width: none; }}
  .panel, .metric, .banner {{ background: #fff; border-color: #ccc; }}
  .muted, .sub, .meta, .reasons, .info-grid span {{ color: #555; }}
  .pill {{ border: 1px solid #999; }}
}}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div class="brand">
      <div class="logo">AC</div>
      <div>
        <h1>ALU-CHECK 精密圖紙比對報告</h1>
        <div class="sub">鋁業 CAD 規格 · 公差 · 幾何視覺雙重驗證</div>
      </div>
    </div>
    <div class="meta">
      <div>圖檔 <strong>{html.escape(report.filename)}</strong></div>
      <div>規格 <strong>{html.escape(report.spec_filename)}</strong></div>
      <div>{html.escape(created)}</div>
    </div>
  </header>

  <div class="banner">
    <div>
      <h2>{html.escape(overall_label)}</h2>
      <p>依 {stats.get('total', 0)} 筆規格檢查，{stats.get('pass', 0)} 筆合格、{stats.get('fail', 0)} 筆超差、{stats.get('missing', 0)} 筆缺漏、{stats.get('warning', 0)} 筆需複核。</p>
    </div>
    <div class="big-rate">{stats.get('pass_rate', 0):.1f}%<small>PASS RATE</small></div>
  </div>

  <div class="metrics">{cards}</div>

  {drawing_html}
  {vision_html}

  <section class="panel">
    <div class="panel-head"><h2>規格比對明細</h2><span class="muted">點開原因可追溯每一筆判斷</span></div>
    <table>
      <thead><tr><th>ID</th><th>規格</th><th>目標 / 公差</th><th>CAD 實測</th><th>偏差</th><th>狀態</th><th>判斷原因</th></tr></thead>
      <tbody>{''.join(rows)}</tbody>
    </table>
  </section>

  <section class="panel">
    <div class="panel-head"><h2>圖檔與執行資訊</h2></div>
    <div class="info-grid">
      <div><span>圖面標題</span><strong>{html.escape(str(doc.get('title', '—')))}</strong></div>
      <div><span>圖面單位</span><strong>{html.escape(str(doc.get('unit', '—')))}</strong></div>
      <div><span>標註數量</span><strong>{doc.get('dimension_count', 0)}</strong></div>
      <div><span>可測量特徵</span><strong>{doc.get('measurement_count', 0)}</strong></div>
      <div><span>圖層數量</span><strong>{len(doc.get('layers') or [])}</strong></div>
      <div><span>檔案指紋</span><strong>{html.escape(str(doc.get('sha256', '—')))}</strong></div>
      <div><span>最差偏差</span><strong>{format_value(stats.get('worst_deviation'), 'mm')}</strong></div>
      <div><span>文字異常</span><strong>{stats.get('tamper_count', 0)} 筆</strong></div>
    </div>
    {f'<div class="muted" style="margin-top:10px">執行設定：{settings_html}</div>' if settings_html else ''}
  </section>

  {warnings_html}

  <footer>
    <span>ALU-CHECK · 本報告由自動化比對產生，最終判定仍建議由工程師複核。</span>
    <span>Report generated {html.escape(created)}</span>
  </footer>
</div>
</body>
</html>"""
    return html_doc


def save_report_artifacts(
    report: ComparisonReport,
    output_root: str | Path = "runs",
) -> ReportArtifacts:
    root = Path(output_root)
    stamp = report.created_at.replace(":", "").replace("-", "")[:15]
    run_name = f"{stamp}_{safe_filename(Path(report.filename).stem)}"
    run_dir = root / run_name
    run_dir.mkdir(parents=True, exist_ok=True)

    artifacts = ReportArtifacts(run_dir=run_dir)
    html_text = report_to_html(report)
    artifacts.html_path = run_dir / "report.html"
    artifacts.html_path.write_text(html_text, encoding="utf-8")

    artifacts.json_path = run_dir / "report.json"
    artifacts.json_path.write_text(report_to_json(report), encoding="utf-8")

    artifacts.csv_path = run_dir / "report.csv"
    artifacts.csv_path.write_text(report_to_csv(report), encoding="utf-8-sig")

    artifacts.pickle_path = run_dir / "report.pkl"
    with artifacts.pickle_path.open("wb") as fp:
        pickle.dump(report, fp, protocol=pickle.HIGHEST_PROTOCOL)

    if report.annotated_png:
        artifacts.drawing_path = run_dir / "annotated.png"
        artifacts.drawing_path.write_bytes(report.annotated_png)
    if report.vision_png:
        artifacts.vision_path = run_dir / "geometry_diff.png"
        artifacts.vision_path.write_bytes(report.vision_png)

    artifacts.files = [
        path
        for path in [
            artifacts.html_path,
            artifacts.json_path,
            artifacts.csv_path,
            artifacts.pickle_path,
            artifacts.drawing_path,
            artifacts.vision_path,
        ]
        if path
    ]
    return artifacts


def load_report_pickle(path: str | Path) -> ComparisonReport:
    with Path(path).open("rb") as fp:
        report = pickle.load(fp)
    if not isinstance(report, ComparisonReport):
        raise ValueError("檔案不是 ALU-CHECK 報告。")
    return report
