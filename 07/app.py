from __future__ import annotations

import html
import json
from pathlib import Path

import pandas as pd
import streamlit as st

from alucheck.cad_parser import parse_dxf_bytes
from alucheck.matcher import build_stats, compare_specs
from alucheck.models import STATUS_ERROR, STATUS_FAIL, STATUS_PASS
from alucheck.render import render_annotated, render_geometry
from alucheck.report import (
    create_report,
    report_to_csv,
    report_to_html,
    report_to_json,
)
from alucheck.sample_data import build_demo_bytes, ensure_demo_files
from alucheck.specs import (
    SpecParseError,
    SpecParseResult,
    load_specs_from_bytes,
    specs_from_records,
)
from alucheck.ui_theme import APP_CSS
from alucheck.utils import format_signed, format_value, human_size, safe_filename, sha256_bytes
from alucheck.vision import compare_images

st.set_page_config(
    page_title="ALU-CHECK · 鋁業CAD精密比對",
    layout="wide",
    initial_sidebar_state="expanded",
)
st.markdown(APP_CSS, unsafe_allow_html=True)

SPEC_TYPES = ["csv", "tsv", "xlsx", "xlsm", "json", "pdf", "txt", "md"]
IMAGE_TYPES = ["png", "jpg", "jpeg", "bmp", "webp"]
DEFAULT_SETTINGS = {
    "use_cache": True,
    "vision_enabled": True,
    "shape": 0.08,
    "centroid": 0.015,
    "area": 0.92,
    "overlap": 0.75,
}


@st.cache_data(show_spinner=False)
def _demo_payload() -> dict[str, bytes]:
    return build_demo_bytes()


def _hash_json(value: object) -> str:
    return sha256_bytes(
        json.dumps(value, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
    )


def _clean_records(rows: list[dict]) -> list[dict]:
    records: list[dict] = []
    keys = ["id", "name", "target", "tolerance", "unit", "aliases", "cad_handle", "note"]
    for row in rows:
        if not any(str(row.get(key) or "").strip() for key in keys):
            continue
        records.append({key: row.get(key) for key in keys})
    return records


def _status_badge(label: str, tone: str) -> str:
    return f'<span class="status {html.escape(tone)}">{html.escape(label)}</span>'


def _metric_card(label: str, value: str, sub: str, tone: str = "") -> str:
    return (
        f'<div class="metric {html.escape(tone)}">'
        f'<div class="label">{html.escape(label)}</div>'
        f'<div class="value">{html.escape(value)}</div>'
        f'<div class="sub">{html.escape(sub)}</div>'
        f"</div>"
    )


def _metrics_html(stats: dict, vision: object | None) -> str:
    pass_rate = float(stats.get("pass_rate", 0.0))
    if pass_rate >= 90:
        rate_tone = "good"
    elif pass_rate >= 70:
        rate_tone = "warn"
    else:
        rate_tone = "bad"
    vision_text = "未啟用"
    vision_sub = "未提供參考圖"
    if vision is not None:
        vision_text = "PASS" if vision.status == STATUS_PASS else "REVIEW"
        vision_sub = f"幾何分數 {vision.score:.1f}"
    cards = [
        _metric_card("SPEC ITEMS", str(stats.get("total", 0)), "規格檢查項目", "info"),
        _metric_card("PASS", str(stats.get("pass", 0)), "尺寸合格", "good"),
        _metric_card("FAIL", str(stats.get("fail", 0)), "尺寸超差", "bad"),
        _metric_card("MISSING", str(stats.get("missing", 0)), "圖面缺漏", "warn"),
        _metric_card("PASS RATE", f"{pass_rate:.1f}%", "已檢項目合格率", rate_tone),
    ]
    if vision is not None:
        cards.append(_metric_card("VISION", vision_text, vision_sub, "good" if vision_text == "PASS" else "bad"))
    return '<div class="metric-grid">' + "".join(cards) + "</div>"


def _results_table(results: list) -> str:
    if not results:
        return '<div class="note">目前沒有可比對的規格。</div>'
    rows = []
    for result in results:
        spec = result.spec
        measurement = result.measurement
        actual = format_value(result.actual_value, spec.unit)
        if measurement and measurement.text_tampered and measurement.text_override:
            actual += f"（文字 {measurement.text_override}）"
        diff = format_signed(result.diff, spec.unit)
        handle = measurement.handle if measurement else "—"
        reasons = "；".join(result.reasons[:2]) if result.reasons else spec.note
        rows.append(
            f'<tr class="row--{html.escape(result.tone)}">'
            f'<td><div class="name">{html.escape(spec.label)}</div>'
            f'<div class="muted mono">{html.escape(spec.id or "—")}</div></td>'
            f'<td class="mono">{html.escape(format_value(spec.target, spec.unit))}</td>'
            f'<td class="mono">{html.escape(spec.tolerance_text)}</td>'
            f'<td class="mono">{html.escape(actual)}</td>'
            f'<td class="mono">{html.escape(diff)}</td>'
            f'<td>{_status_badge(result.status_label, result.tone)}</td>'
            f'<td><div class="muted">{html.escape(reasons or "—")}</div>'
            f'<div class="muted mono">{html.escape(handle)}</div></td>'
            f"</tr>"
        )
    return (
        '<table class="audit"><thead><tr>'
        "<th>規格</th><th>目標值</th><th>公差</th><th>實測</th><th>偏差</th><th>狀態</th><th>判讀</th>"
        "</tr></thead><tbody>"
        + "".join(rows)
        + "</tbody></table>"
    )


def _hero(demo: bool, actual_name: str, spec_name: str) -> None:
    mode = "DEMO DATA" if demo else "LIVE INSPECTION"
    source = html.escape(actual_name) if actual_name else "等待上傳 DXF"
    spec_display = html.escape(spec_name) if spec_name else "等待上傳規格"
    st.markdown(
        f"""
        <div class="hero">
          <div class="eyebrow">{mode} · ALU-CHECK / PRECISION INSPECTION</div>
          <h1>把圖紙上的<span>尺寸</span>，變成可追溯的判斷。</h1>
          <p>
            針對鋁擠型、散熱片與板金件，將 DXF 圖面中的實際幾何量測與客戶規格逐項比對；
            同步檢查標註文字是否被手動覆寫，並以 OpenCV 疊圖找出圖形位移與輪廓差異。
          </p>
          <div class="chips">
            <span class="chip">DXF {source}</span>
            <span class="chip">SPEC {spec_display}</span>
            <span class="chip">TOLERANCE ENGINE</span>
            <span class="chip">TEXT TAMPER AUDIT</span>
            <span class="chip">OPENCV GEOMETRY</span>
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def _sidebar() -> dict:
    st.session_state.setdefault("demo_mode", False)
    with st.sidebar:
        st.markdown(
            """
            <div class="sidebar-brand">
              <div class="logo">AC</div>
              <div>
                <div class="name">ALU-CHECK</div>
                <div class="sub">CAD PRECISION AUDIT</div>
              </div>
            </div>
            """,
            unsafe_allow_html=True,
        )
        st.markdown('<div class="sidebar-section">資料來源</div>', unsafe_allow_html=True)
        demo = bool(st.session_state.get("demo_mode"))
        if demo:
            st.success("示範案例已載入")
            if st.button("改用自有檔案", width="stretch"):
                st.session_state["demo_mode"] = False
                st.rerun()
        else:
            if st.button("載入示範案例", width="stretch", type="primary"):
                st.session_state["demo_mode"] = True
                st.rerun()

        actual_upload = st.file_uploader(
            "CAD 圖面（DXF）",
            type=["dxf"],
            disabled=demo,
            key="actual_dxf",
        )
        spec_upload = st.file_uploader(
            "客戶規格",
            type=SPEC_TYPES,
            disabled=demo,
            key="spec_file",
        )
        reference_upload = st.file_uploader(
            "理想參考圖（選填）",
            type=IMAGE_TYPES,
            disabled=demo,
            key="reference_image",
        )

        st.markdown('<div class="sidebar-section">比對設定</div>', unsafe_allow_html=True)
        use_cache = st.toggle("啟用 DXF 解析快取", value=True)
        vision_enabled = st.toggle("啟用 OpenCV 幾何比對", value=True)
        with st.expander("視覺門檻", expanded=False):
            shape = st.slider("輪廓形狀差異", 0.02, 0.30, 0.08, 0.01)
            centroid = st.slider("最大質心偏移", 0.005, 0.080, 0.015, 0.005)
            area = st.slider("輪廓面積比", 0.80, 1.00, 0.92, 0.01)
            overlap = st.slider("線條重疊率", 0.50, 1.00, 0.75, 0.01)

        st.markdown('<div class="sidebar-section">系統</div>', unsafe_allow_html=True)
        st.caption("支援 CSV / XLSX / JSON / PDF / TXT 規格；DXF 以 mm 為主要單位。")
        st.caption("所有比對在本機完成，不上傳圖面到雲端。")

        payload: dict[str, bytes] = {}
        if demo:
            payload = _demo_payload()
            try:
                ensure_demo_files()
            except OSError:
                pass
            actual_bytes = payload["actual_dxf"]
            actual_name = "demo_actual.dxf"
            spec_bytes = payload["specs_csv"]
            spec_name = "demo_specs.csv"
            reference_bytes = payload["reference_png"]
            reference_name = "demo_reference.png"
        else:
            actual_bytes = actual_upload.getvalue() if actual_upload else b""
            actual_name = actual_upload.name if actual_upload else ""
            spec_bytes = spec_upload.getvalue() if spec_upload else b""
            spec_name = spec_upload.name if spec_upload else ""
            reference_bytes = reference_upload.getvalue() if reference_upload else b""
            reference_name = reference_upload.name if reference_upload else ""

        settings = {
            "use_cache": use_cache,
            "vision_enabled": vision_enabled,
            "shape": shape,
            "centroid": centroid,
            "area": area,
            "overlap": overlap,
        }
        return {
            "demo": demo,
            "actual_bytes": actual_bytes,
            "actual_name": actual_name,
            "spec_bytes": spec_bytes,
            "spec_name": spec_name,
            "reference_bytes": reference_bytes,
            "reference_name": reference_name,
            "settings": settings,
            "payload": payload,
        }


def _effective_specs(base: SpecParseResult, spec_key: str) -> SpecParseResult:
    if (
        st.session_state.get("spec_override_key") == spec_key
        and st.session_state.get("spec_override_records")
    ):
        try:
            result = specs_from_records(
                st.session_state["spec_override_records"], source="manual-override"
            )
            result.warnings.insert(0, "已套用手動規格修正。")
            return result
        except Exception as exc:
            base.warnings.insert(0, f"手動規格修正套用失敗：{exc}")
    return base


def _analyze(
    actual_bytes: bytes,
    actual_name: str,
    specs: list,
    spec_name: str,
    reference_bytes: bytes,
    reference_name: str,
    settings: dict,
) -> dict:
    document = parse_dxf_bytes(
        actual_bytes,
        actual_name,
        use_cache=bool(settings.get("use_cache", True)),
    )
    results = compare_specs(document, specs)
    stats = build_stats(results)
    warnings: list[str] = []
    annotated_png = None
    try:
        annotated_png = render_annotated(
            actual_bytes,
            actual_name,
            results,
            title=document.title,
            dpi=150,
        )
    except Exception as exc:
        warnings.append(f"CAD 標註圖渲染失敗：{exc}")

    vision = None
    vision_geometry_png = None
    if reference_bytes and settings.get("vision_enabled", True):
        try:
            vision_geometry_png = render_geometry(actual_bytes, actual_name, dpi=150)
            vision = compare_images(
                vision_geometry_png,
                reference_bytes,
                shape_threshold=float(settings.get("shape", 0.08)),
                centroid_threshold=float(settings.get("centroid", 0.015)),
                area_threshold=float(settings.get("area", 0.92)),
                overlap_threshold=float(settings.get("overlap", 0.75)),
            )
            if vision.status == STATUS_ERROR:
                warnings.append(f"幾何比對未完成：{vision.message}")
        except Exception as exc:
            warnings.append(f"幾何比對失敗：{exc}")

    report = create_report(
        document,
        specs,
        results,
        spec_filename=spec_name or "manual",
        settings=settings,
        vision=vision,
        warnings=warnings,
        annotated_png=annotated_png,
        vision_png=vision.image_png if vision else None,
    )
    return {
        "document": document,
        "results": results,
        "stats": stats,
        "report": report,
        "vision": vision,
        "vision_geometry_png": vision_geometry_png,
    }


def _document_chips(document: object) -> str:
    chips = [
        f"UNIT {document.unit.upper()}",
        f"DIM {document.dimension_count}",
        f"MEAS {document.measurement_count}",
        f"LAYERS {len(document.layers)}",
        f"SHA {document.sha256[:10]}",
    ]
    if document.blocks:
        chips.append(f"BLOCKS {len(document.blocks)}")
    return "".join(f'<span class="chip">{html.escape(chip)}</span>' for chip in chips)


def _downloads(report: object) -> None:
    stem = safe_filename(Path(report.filename).stem)
    col1, col2, col3 = st.columns(3)
    col1.download_button(
        "下載 HTML 報告",
        report_to_html(report).encode("utf-8"),
        file_name=f"{stem}_report.html",
        mime="text/html",
        width="stretch",
    )
    col2.download_button(
        "下載 CSV 明細",
        report_to_csv(report).encode("utf-8-sig"),
        file_name=f"{stem}_report.csv",
        mime="text/csv",
        width="stretch",
    )
    col3.download_button(
        "下載 JSON",
        report_to_json(report).encode("utf-8"),
        file_name=f"{stem}_report.json",
        mime="application/json",
        width="stretch",
    )


def _spec_editor(spec_result: SpecParseResult, spec_key: str, payload: dict[str, bytes], demo: bool) -> None:
    st.markdown(
        """
        <div class="panel-title">
          <h3>規格資料 · SPECIFICATION SOURCE</h3>
          <span class="hint">可修改後重新套用</span>
        </div>
        """,
        unsafe_allow_html=True,
    )
    st.caption(f"來源：{spec_result.source or '未命名'} · 解析到 {len(spec_result.specs)} 項規格")
    for warning in spec_result.warnings:
        st.markdown(f'<div class="note warn">{html.escape(warning)}</div>', unsafe_allow_html=True)

    if not spec_result.specs:
        st.markdown('<div class="note bad">沒有解析到規格，請確認欄位名稱或檔案格式。</div>', unsafe_allow_html=True)
        return

    records = [
        {
            "id": spec.id,
            "name": spec.name,
            "target": spec.target,
            "tolerance": (
                spec.tolerance_text.replace(f" {spec.unit}", "").strip()
                if spec.tolerance_text
                else ""
            ),
            "unit": spec.unit,
            "aliases": ", ".join(spec.aliases),
            "cad_handle": spec.cad_handle or "",
            "note": spec.note,
        }
        for spec in spec_result.specs
    ]
    edited = st.data_editor(
        records,
        key=f"spec_editor_{spec_key[:12]}",
        num_rows="dynamic",
        hide_index=True,
        width="stretch",
        column_config={
            "id": st.column_config.TextColumn("ID", width="small"),
            "name": st.column_config.TextColumn("規格名稱", width="medium"),
            "target": st.column_config.NumberColumn("目標值", format="%.4f", width="small"),
            "tolerance": st.column_config.TextColumn("公差（例：0.05 或 +0.1/-0.1）", width="medium"),
            "unit": st.column_config.TextColumn("單位", width="small"),
            "aliases": st.column_config.TextColumn("別名（逗號分隔）", width="medium"),
            "cad_handle": st.column_config.TextColumn("CAD Handle", width="small"),
            "note": st.column_config.TextColumn("備註", width="large"),
        },
    )

    col1, col2, col3 = st.columns([1.2, 1.2, 2.2])
    if col1.button("套用規格修正", type="primary", width="stretch"):
        cleaned = _clean_records(edited)
        try:
            result = specs_from_records(cleaned, source="manual-override")
            if not result.specs:
                st.error("修正後沒有有效規格。")
            else:
                st.session_state["spec_override_key"] = spec_key
                st.session_state["spec_override_records"] = cleaned
                st.rerun()
        except Exception as exc:
            st.error(f"套用失敗：{exc}")
    if col2.button(
        "重設為原始規格",
        width="stretch",
        disabled=st.session_state.get("spec_override_key") != spec_key,
    ):
        st.session_state.pop("spec_override_key", None)
        st.session_state.pop("spec_override_records", None)
        st.rerun()

    st.markdown("---")
    st.markdown(
        """
        <div class="note">
          公差支援 <span class="mono">±0.05</span>、<span class="mono">+0.10/-0.05</span>、
          <span class="mono">0.05</span> 等格式。若規格有 CAD Handle，系統會優先採用該圖元；
          否則以名稱、別名、尺寸類型與數值進行全域唯一配對。
        </div>
        """,
        unsafe_allow_html=True,
    )
    if demo and payload:
        st.markdown('<div class="sidebar-section">示範素材</div>', unsafe_allow_html=True)
        down1, down2, down3 = st.columns(3)
        down1.download_button(
            "實際 DXF",
            payload.get("actual_dxf", b""),
            file_name="demo_actual.dxf",
            mime="application/dxf",
            width="stretch",
        )
        down2.download_button(
            "理想 DXF",
            payload.get("ideal_dxf", b""),
            file_name="demo_ideal.dxf",
            mime="application/dxf",
            width="stretch",
        )
        down3.download_button(
            "規格 CSV",
            payload.get("specs_csv", b""),
            file_name="demo_specs.csv",
            mime="text/csv",
            width="stretch",
        )


def _batch_tab(spec_result: SpecParseResult, settings: dict) -> None:
    st.markdown(
        """
        <div class="panel-title">
          <h3>批次分析 · BATCH INSPECTION</h3>
          <span class="hint">多張 DXF 共用同一份規格</span>
        </div>
        """,
        unsafe_allow_html=True,
    )
    files = st.file_uploader(
        "一次上傳多張 DXF",
        type=["dxf"],
        accept_multiple_files=True,
        key="batch_dxf_files",
    )
    if not files:
        st.markdown(
            '<div class="note">批次模式僅執行尺寸與文字一致性比對；幾何疊圖請使用單張工作台。</div>',
            unsafe_allow_html=True,
        )
        return
    if not spec_result.specs:
        st.warning("目前沒有可用的規格資料。")
        return
    if st.button("執行批次比對", type="primary"):
        rows: list[dict] = []
        reports: list[object] = []
        progress = st.progress(0.0, text="批次比對中…")
        for index, uploaded in enumerate(files):
            try:
                document = parse_dxf_bytes(
                    uploaded.getvalue(),
                    uploaded.name,
                    use_cache=bool(settings.get("use_cache", True)),
                )
                results = compare_specs(document, spec_result.specs)
                stats = build_stats(results)
                report = create_report(
                    document,
                    spec_result.specs,
                    results,
                    spec_filename=spec_result.source or "batch-spec",
                    settings=settings,
                )
                reports.append(report)
                rows.append(
                    {
                        "檔案": uploaded.name,
                        "圖面標題": document.title,
                        "規格數": stats["total"],
                        "合格": stats["pass"],
                        "超差": stats["fail"],
                        "缺漏": stats["missing"],
                        "合格率": f"{stats['pass_rate']:.1f}%",
                        "文字異常": stats["tamper_count"],
                        "大小": human_size(len(uploaded.getvalue())),
                        "狀態": "完成",
                        "訊息": "",
                    }
                )
            except Exception as exc:
                rows.append(
                    {
                        "檔案": uploaded.name,
                        "圖面標題": "",
                        "規格數": 0,
                        "合格": 0,
                        "超差": 0,
                        "缺漏": 0,
                        "合格率": "—",
                        "文字異常": 0,
                        "大小": human_size(len(uploaded.getvalue())),
                        "狀態": "失敗",
                        "訊息": str(exc),
                    }
                )
            progress.progress((index + 1) / len(files), text=f"批次比對中… {index + 1}/{len(files)}")
        progress.empty()
        st.session_state["batch_rows"] = rows
        st.session_state["batch_reports"] = reports

    rows = st.session_state.get("batch_rows", [])
    reports = st.session_state.get("batch_reports", [])
    if not rows:
        return
    frame = pd.DataFrame(rows)
    st.dataframe(frame, width="stretch", hide_index=True)
    if reports:
        st.download_button(
            "下載批次摘要 CSV",
            frame.to_csv(index=False).encode("utf-8-sig"),
            file_name="alucheck_batch_summary.csv",
            mime="text/csv",
        )
        index = st.selectbox(
            "選擇報告下載",
            options=list(range(len(reports))),
            format_func=lambda value: getattr(reports[value], "filename", f"report-{value}"),
        )
        report = reports[index]
        d1, d2, d3 = st.columns(3)
        d1.download_button(
            "HTML",
            report_to_html(report).encode("utf-8"),
            file_name=f"{safe_filename(Path(report.filename).stem)}_report.html",
            mime="text/html",
            width="stretch",
        )
        d2.download_button(
            "CSV",
            report_to_csv(report).encode("utf-8-sig"),
            file_name=f"{safe_filename(Path(report.filename).stem)}_report.csv",
            mime="text/csv",
            width="stretch",
        )
        d3.download_button(
            "JSON",
            report_to_json(report).encode("utf-8"),
            file_name=f"{safe_filename(Path(report.filename).stem)}_report.json",
            mime="application/json",
            width="stretch",
        )


def main() -> None:
    source = _sidebar()
    demo = source["demo"]
    actual_bytes = source["actual_bytes"]
    actual_name = source["actual_name"]
    spec_bytes = source["spec_bytes"]
    spec_name = source["spec_name"]
    reference_bytes = source["reference_bytes"]
    settings = source["settings"]
    payload = source["payload"]

    _hero(demo, actual_name, spec_name)

    if not actual_bytes:
        st.markdown(
            """
            <div class="empty">
              <div class="mark">WAITING FOR INPUT</div>
              <h3>先放入一張 DXF 圖面</h3>
              <p>
                在左側上傳 CAD 圖面與客戶規格，或載入內建示範案例。
                系統會從 DXF 的 DIMENSION、CIRCLE、ARC 等圖元重建實際尺寸，
                再與規格逐項配對。
              </p>
            </div>
            """,
            unsafe_allow_html=True,
        )
        st.stop()

    if not spec_bytes:
        st.warning("尚未上傳客戶規格。請在左側加入 CSV、XLSX、JSON、PDF 或 TXT。")
        st.stop()

    try:
        base_spec_result = load_specs_from_bytes(spec_bytes, spec_name)
    except (SpecParseError, Exception) as exc:
        st.error(f"規格解析失敗：{exc}")
        st.stop()

    spec_key = sha256_bytes(spec_bytes)
    spec_result = _effective_specs(base_spec_result, spec_key)

    if not spec_result.specs:
        st.error("規格檔案中沒有可用的檢查項目。")
        _spec_editor(spec_result, spec_key, payload, demo)
        st.stop()

    analysis_key = _hash_json(
        {
            "dxf": sha256_bytes(actual_bytes),
            "spec": spec_key,
            "reference": sha256_bytes(reference_bytes or b""),
            "settings": settings,
            "specs": [spec.as_dict() for spec in spec_result.specs],
        }
    )
    if st.session_state.get("analysis_key") != analysis_key:
        with st.spinner("解析 DXF、配對尺寸、產生標註圖…"):
            try:
                analysis = _analyze(
                    actual_bytes,
                    actual_name,
                    spec_result.specs,
                    spec_name,
                    reference_bytes,
                    source["reference_name"],
                    settings,
                )
            except Exception as exc:
                st.error(f"分析失敗：{exc}")
                st.stop()
            st.session_state["analysis"] = analysis
            st.session_state["analysis_key"] = analysis_key

    analysis = st.session_state["analysis"]
    document = analysis["document"]
    results = analysis["results"]
    stats = analysis["stats"]
    report = analysis["report"]
    vision = analysis["vision"]

    st.markdown(
        f'<div class="chips" style="margin-bottom:14px;">{_document_chips(document)}</div>',
        unsafe_allow_html=True,
    )
    st.markdown(_metrics_html(stats, vision), unsafe_allow_html=True)

    if stats.get("tamper_count"):
        st.markdown(
            f'<div class="note bad">偵測到 {stats["tamper_count"]} 個標註文字與實際幾何不一致，'
            "可能有人手動覆寫尺寸文字。請優先人工复核該標註。</div>",
            unsafe_allow_html=True,
        )
    if report.warnings:
        with st.expander(f"資料警示 · {len(report.warnings)}", expanded=False):
            for warning in report.warnings:
                st.markdown(f'<div class="note warn">{html.escape(warning)}</div>', unsafe_allow_html=True)

    tab_drawing, tab_results, tab_vision, tab_specs, tab_batch = st.tabs(
        ["01 圖面審核", "02 尺寸明細", "03 幾何疊圖", "04 規格資料", "05 批次分析"]
    )

    with tab_drawing:
        left, right = st.columns([2.0, 1.0], gap="large")
        with left:
            st.markdown(
                '<div class="panel-title"><h3>標註後的 CAD 圖面</h3><span class="hint">RED = FAIL / AMBER = TAMPER</span></div>',
                unsafe_allow_html=True,
            )
            if report.annotated_png:
                st.image(report.annotated_png, width="stretch")
            else:
                st.markdown('<div class="note bad">目前無法產生標註圖。</div>', unsafe_allow_html=True)
        with right:
            st.markdown(
                '<div class="panel-title"><h3>圖面摘要</h3><span class="hint">DOCUMENT</span></div>',
                unsafe_allow_html=True,
            )
            st.markdown(
                f"""
                <div class="panel">
                  <div class="note">標題：{html.escape(document.title or '—')}</div>
                  <div class="note">圖元：{html.escape(str(document.entity_counts.get('DIMENSION', 0)))} 個尺寸標註，
                  {html.escape(str(document.entity_counts.get('CIRCLE', 0)))} 個圓。</div>
                  <div class="note">圖層：{html.escape('、'.join(document.layers[:8]) or '—')}</div>
                  <div class="note">DXF 單位：{html.escape(document.unit)}</div>
                </div>
                """,
                unsafe_allow_html=True,
            )
            if stats.get("tamper_count"):
                st.markdown(
                    f'<div class="note bad">文字覆寫：{stats["tamper_count"]} 處</div>',
                    unsafe_allow_html=True,
                )
            if vision is not None:
                st.markdown(
                    f'<div class="note {"bad" if vision.status == STATUS_FAIL else ""}">'
                    f"幾何比對：{html.escape(vision.message)}</div>",
                    unsafe_allow_html=True,
                )

    with tab_results:
        st.markdown(_results_table(results), unsafe_allow_html=True)
        st.markdown("")
        _downloads(report)

    with tab_vision:
        st.markdown(
            '<div class="panel-title"><h3>OpenCV 幾何疊圖</h3><span class="hint">REFERENCE / CAD / DIFFERENCE</span></div>',
            unsafe_allow_html=True,
        )
        if vision is None:
            st.markdown(
                '<div class="note">未提供理想參考圖，或已在左側關閉幾何比對。'
                "上傳參考圖後可檢查孔位偏移、輪廓變形與整體比例。</div>",
                unsafe_allow_html=True,
            )
        elif vision.status == STATUS_ERROR:
            st.markdown(f'<div class="note bad">{html.escape(vision.message)}</div>', unsafe_allow_html=True)
        else:
            c1, c2, c3, c4 = st.columns(4)
            c1.metric("形狀差異", f"{vision.shape_diff:.4f}")
            c2.metric("面積比", f"{vision.area_ratio * 100:.1f}%")
            c3.metric("質心偏移", f"{vision.centroid_shift * 100:.2f}%")
            c4.metric("線條重疊", f"{vision.overlap * 100:.1f}%")
            if vision.image_png:
                st.image(vision.image_png, width="stretch")
            st.markdown(f'<div class="note">{html.escape(vision.message)}</div>', unsafe_allow_html=True)
            st.caption(
                f"門檻：形狀 ≤ {settings['shape']:.2f} · 質心 ≤ {settings['centroid'] * 100:.2f}% · "
                f"面積 ≥ {settings['area'] * 100:.0f}% · 重疊 ≥ {settings['overlap'] * 100:.0f}%"
            )

    with tab_specs:
        _spec_editor(spec_result, spec_key, payload, demo)

    with tab_batch:
        _batch_tab(spec_result, settings)

    st.markdown(
        '<div class="footer"><span>ALU-CHECK · LOCAL-FIRST CAD INSPECTION</span>'
        "<span>STREAMLIT / EZDXF / OPENCV / PYTHON</span></div>",
        unsafe_allow_html=True,
    )


if __name__ == "__main__":
    main()
