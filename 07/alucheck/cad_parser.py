from __future__ import annotations

import io
import os
import pickle
import re
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any

import ezdxf
from ezdxf import bbox

from .models import CADDocument, CADMeasurement
from .utils import (
    clean_cad_text,
    normalize_cad_unit,
    normalize_text,
    parse_number,
    sha256_bytes,
)

PARSER_VERSION = 4
DEFAULT_CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache"

DIM_KIND_MAP = {
    0: "linear",
    1: "aligned",
    2: "angular",
    3: "diameter",
    4: "radius",
    5: "angular3p",
    6: "ordinate",
}


def _vec_xy(value: Any, default: tuple[float, float] = (0.0, 0.0)) -> tuple[float, float]:
    if value is None:
        return default
    try:
        return float(value.x), float(value.y)
    except Exception:
        try:
            return float(value[0]), float(value[1])
        except Exception:
            return default


def _entity_text(entity: Any) -> str:
    try:
        dxftype = entity.dxftype()
    except Exception:
        return ""
    try:
        if dxftype == "MTEXT":
            if hasattr(entity, "plain_text"):
                return clean_cad_text(entity.plain_text())
            return clean_cad_text(getattr(entity, "text", ""))
        if dxftype in {"TEXT", "ATTRIB", "ATTDEF"}:
            return clean_cad_text(getattr(entity.dxf, "text", ""))
    except Exception:
        return ""
    return ""


def _extract_label(text: str) -> str:
    """Derive a compact label from a dimension override like ``W=150.50``."""
    cleaned = clean_cad_text(text)
    if not cleaned:
        return ""
    cleaned = cleaned.replace("<>", " ")
    cleaned = re.sub(r"[Øø⌀]", " DIA ", cleaned)
    cleaned = re.sub(r"[-+]?\d+(?:\.\d+)?", " ", cleaned)
    cleaned = re.sub(
        r"\b(?:mm|cm|m|in|inch|inches|um|µm|mil|deg|degree|degrees|R)\b",
        " ",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"[=:;,/\\|()\[\]{}<>]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" -_")
    return cleaned[:40]


def _nearby_text_label(
    texts: list[tuple[str, float, float]], x: float, y: float, radius: float
) -> str:
    best: tuple[float, str] | None = None
    limit = max(radius * 3.0, 8.0)
    for text, tx, ty in texts:
        if not text:
            continue
        distance = ((tx - x) ** 2 + (ty - y) ** 2) ** 0.5
        if distance > limit:
            continue
        if not re.search(r"[A-Za-z\u4e00-\u9fff]", text):
            continue
        if best is None or distance < best[0]:
            best = (distance, text)
    if best is None:
        return ""
    label = _extract_label(best[1])
    return label or clean_cad_text(best[1])[:40]


def _parse_dimension(dim: Any, unit: str) -> CADMeasurement | None:
    try:
        dimtype = int(dim.dimtype)
    except Exception:
        dimtype = 0
    dimension_kind = DIM_KIND_MAP.get(dimtype, "dimension")

    try:
        measurement: Any = dim.get_measurement()
    except Exception:
        measurement = None

    value: float | None
    measurement_unit = unit
    if isinstance(measurement, (int, float)):
        value = float(measurement)
        if dimension_kind in {"angular", "angular3p"}:
            measurement_unit = "deg"
    else:
        value = None

    raw_text = ""
    try:
        raw_text = clean_cad_text(dim.dxf.get("text", "") or "")
    except Exception:
        try:
            raw_text = clean_cad_text(getattr(dim.dxf, "text", "") or "")
        except Exception:
            raw_text = ""

    text_value: float | None = None
    text_tampered = False
    label = ""
    if raw_text and raw_text not in {"<>"}:
        if "<>" in raw_text:
            label = _extract_label(raw_text)
        else:
            text_value = parse_number(raw_text)
            label = _extract_label(raw_text)
            if text_value is not None and value is not None:
                text_tampered = abs(text_value - value) > max(
                    0.0005, abs(value) * 1e-6
                )

    position = None
    for attr in ("text_midpoint", "defpoint", "insert", "defpoint2"):
        try:
            candidate = dim.dxf.get(attr, None)
        except Exception:
            candidate = getattr(dim.dxf, attr, None)
        if candidate is not None:
            position = candidate
            break
    x, y = _vec_xy(position)

    return CADMeasurement(
        handle=str(dim.dxf.handle),
        entity_type="DIMENSION",
        kind="dimension",
        value=value,
        unit=measurement_unit,
        label=label,
        layer=str(dim.dxf.get("layer", "0")),
        x=x,
        y=y,
        text_override=raw_text,
        text_value=text_value,
        text_tampered=text_tampered,
        dimension_kind=dimension_kind,
        source="modelspace",
        extra={
            "dimtype": dimtype,
            "measurement": value,
            "text": raw_text,
            "geometry_block": str(dim.dxf.get("geometry", "") or ""),
        },
    )


def _parse_circle(circle: Any, unit: str, texts: list[tuple[str, float, float]]) -> CADMeasurement:
    center = circle.dxf.center
    x, y = _vec_xy(center)
    radius = float(circle.dxf.radius)
    label = _nearby_text_label(texts, x, y, radius)
    return CADMeasurement(
        handle=str(circle.dxf.handle),
        entity_type="CIRCLE",
        kind="circle",
        value=radius * 2.0,
        unit=unit,
        label=label,
        layer=str(circle.dxf.get("layer", "0")),
        x=x,
        y=y,
        dimension_kind="circle",
        extra={
            "radius": radius,
            "diameter": radius * 2.0,
            "center": [x, y],
        },
    )


def _parse_arc(arc: Any, unit: str, texts: list[tuple[str, float, float]]) -> CADMeasurement:
    center = arc.dxf.center
    x, y = _vec_xy(center)
    radius = float(arc.dxf.radius)
    start_angle = float(arc.dxf.start_angle)
    end_angle = float(arc.dxf.end_angle)
    span = (end_angle - start_angle) % 360.0
    label = _nearby_text_label(texts, x, y, radius)
    return CADMeasurement(
        handle=str(arc.dxf.handle),
        entity_type="ARC",
        kind="arc",
        value=radius,
        unit=unit,
        label=label,
        layer=str(arc.dxf.get("layer", "0")),
        x=x,
        y=y,
        dimension_kind="arc",
        extra={
            "radius": radius,
            "start_angle": start_angle,
            "end_angle": end_angle,
            "angle_span": span,
            "arc_length": radius * span * 3.141592653589793 / 180.0,
        },
    )


def _document_extents(doc: Any, msp: Any) -> tuple[float, float, float, float] | None:
    try:
        ext_min = doc.header.get("$EXTMIN")
        ext_max = doc.header.get("$EXTMAX")
        if ext_min is not None and ext_max is not None:
            x1, y1 = _vec_xy(ext_min)
            x2, y2 = _vec_xy(ext_max)
            if x2 > x1 and y2 > y1:
                return (x1, y1, x2, y2)
    except Exception:
        pass
    try:
        box = bbox.extents(msp, fast=True)
        if box.has_data:
            return (float(box.extmin.x), float(box.extmin.y), float(box.extmax.x), float(box.extmax.y))
    except Exception:
        pass
    return None


def _collect_texts(msp: Any) -> list[tuple[str, float, float]]:
    texts: list[tuple[str, float, float]] = []
    for text_entity in msp.query("TEXT MTEXT ATTRIB"):
        content = _entity_text(text_entity)
        if not content:
            continue
        try:
            insert = text_entity.dxf.insert
        except Exception:
            insert = None
        x, y = _vec_xy(insert)
        texts.append((content, x, y))
    return texts


def _document_title(doc: Any, msp: Any, filename: str) -> str:
    try:
        title = normalize_text(doc.header.get("$TITLE", ""))
        if title:
            return title[:120]
    except Exception:
        pass

    ranked: list[tuple[int, str]] = []
    for text_entity in msp.query("TEXT MTEXT ATTRIB"):
        candidate = _entity_text(text_entity).strip()
        if len(candidate) < 3:
            continue
        if re.fullmatch(r"[\d\s.,<>+\-±Ø/]+", candidate):
            continue
        layer = str(text_entity.dxf.get("layer", "")).upper()
        score = 0
        if "TITLE" in layer:
            score += 10
        if re.search(r"[A-Z]{2,}[-_]?\d", candidate.upper()):
            score += 5
        if any(key in candidate.upper() for key in ("PART", "DRAWING", "PROFILE", "AL-")):
            score += 3
        if len(candidate) > 80:
            score -= 3
        ranked.append((score, candidate))
    if ranked:
        ranked.sort(key=lambda item: item[0], reverse=True)
        return ranked[0][1][:120]
    return Path(filename).stem


def _count_block_dimensions(doc: Any) -> tuple[int, list[str]]:
    count = 0
    names: list[str] = []
    try:
        for block in doc.blocks:
            if block.name.startswith("*"):
                continue
            block_count = sum(1 for entity in block if entity.dxftype() == "DIMENSION")
            if block_count:
                count += block_count
                names.append(block.name)
    except Exception:
        pass
    return count, names


def parse_dxf_bytes(
    data: bytes,
    filename: str,
    cache_dir: str | Path | None = None,
    use_cache: bool = True,
) -> CADDocument:
    if not data:
        raise ValueError("DXF 檔案是空的。")

    digest = sha256_bytes(data)
    cache_root = Path(cache_dir) if cache_dir else DEFAULT_CACHE_DIR
    cache_path = cache_root / f"cad_{digest}_v{PARSER_VERSION}.pkl"

    if use_cache:
        try:
            with cache_path.open("rb") as fp:
                cached = pickle.load(fp)
            if isinstance(cached, CADDocument) and cached.sha256 == digest:
                return cached
        except Exception:
            pass

    suffix = Path(filename).suffix.lower() or ".dxf"
    temp_path = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp:
            temp.write(data)
            temp_path = temp.name
        doc = ezdxf.readfile(temp_path)
    except ezdxf.DXFStructureError as exc:
        raise ValueError(f"DXF 結構錯誤，請確認檔案由 AutoCAD 正常匯出：{exc}") from exc
    except Exception as exc:
        raise ValueError(f"無法讀取 DXF 檔案：{exc}") from exc
    finally:
        if temp_path:
            try:
                os.unlink(temp_path)
            except OSError:
                pass

    msp = doc.modelspace()
    unit_code = 0
    try:
        unit_code = int(doc.header.get("$INSUNITS", 0) or 0)
    except Exception:
        unit_code = 0
    unit, unit_code = normalize_cad_unit(unit_code)

    texts = _collect_texts(msp)
    measurements: list[CADMeasurement] = []
    warnings: list[str] = []

    for dim in msp.query("DIMENSION"):
        parsed = _parse_dimension(dim, unit)
        if parsed is None:
            continue
        if parsed.value is None:
            warnings.append(f"標註 {parsed.handle} 無法取得幾何測量值，已略過數值比對。")
            continue
        measurements.append(parsed)

    for circle in msp.query("CIRCLE"):
        try:
            measurements.append(_parse_circle(circle, unit, texts))
        except Exception as exc:
            warnings.append(f"圓孔 {getattr(circle.dxf, 'handle', '?')} 解析失敗：{exc}")

    for arc in msp.query("ARC"):
        try:
            measurements.append(_parse_arc(arc, unit, texts))
        except Exception as exc:
            warnings.append(f"圓弧 {getattr(arc.dxf, 'handle', '?')} 解析失敗：{exc}")

    entity_counts = Counter(entity.dxftype() for entity in msp)
    layers: list[str] = []
    try:
        layers = sorted(layer.dxf.name for layer in doc.layers)
    except Exception:
        pass

    block_dim_count, block_names = _count_block_dimensions(doc)
    if block_dim_count:
        warnings.append(
            f"圖塊內另有 {block_dim_count} 個標註（{', '.join(block_names[:5])}），"
            "目前以模型空間標註為主；建議將圖塊炸開後再匯出 DXF。"
        )

    if not measurements:
        warnings.append("圖面中找不到可用的標註、圓孔或圓弧，請確認 DXF 內容。")

    document = CADDocument(
        filename=filename,
        sha256=digest,
        unit=unit,
        unit_code=unit_code,
        measurements=measurements,
        entity_counts=dict(entity_counts),
        layers=layers,
        extents=_document_extents(doc, msp),
        title=_document_title(doc, msp, filename),
        warnings=warnings,
        blocks=block_names,
    )

    if use_cache:
        try:
            cache_root.mkdir(parents=True, exist_ok=True)
            with cache_path.open("wb") as fp:
                pickle.dump(document, fp, protocol=pickle.HIGHEST_PROTOCOL)
        except Exception:
            pass

    return document


def parse_dxf_file(
    path: str | Path,
    cache_dir: str | Path | None = None,
    use_cache: bool = True,
) -> CADDocument:
    file_path = Path(path)
    data = file_path.read_bytes()
    return parse_dxf_bytes(
        data, file_path.name, cache_dir=cache_dir, use_cache=use_cache
    )


def clear_cache(cache_dir: str | Path | None = None) -> int:
    root = Path(cache_dir) if cache_dir else DEFAULT_CACHE_DIR
    removed = 0
    if not root.exists():
        return removed
    for item in root.glob("cad_*.pkl"):
        try:
            item.unlink()
            removed += 1
        except OSError:
            pass
    return removed


def load_dxf_document(path: str | Path) -> Any:
    """Utility used by the renderer when the original DXF is still available."""
    return ezdxf.readfile(str(path))


def dxf_stream_from_bytes(data: bytes) -> io.BytesIO:
    return io.BytesIO(data)
