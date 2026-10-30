from __future__ import annotations

import csv
import io
import json
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd

from .models import SpecItem
from .utils import (
    clean_cad_text,
    normalize_text,
    normalize_unit,
    parse_measurement_value,
    parse_number,
    parse_tolerance,
)


class SpecParseError(ValueError):
    pass


@dataclass
class SpecParseResult:
    specs: list[SpecItem]
    warnings: list[str] = field(default_factory=list)
    source: str = ""
    part_name: str = ""
    used_llm: bool = False


COLUMN_ALIASES: dict[str, list[str]] = {
    "id": ["id", "編號", "項次", "序號", "item", "no", "料號", "檢查編號"],
    "name": [
        "name",
        "名稱",
        "項目",
        "規格名稱",
        "尺寸名稱",
        "feature",
        "parameter",
        "標註名稱",
        "檢查項目",
        "檢驗項目",
        "特性",
        "尺寸項目",
        "部位",
    ],
    "target": [
        "target",
        "value",
        "目標值",
        "標稱值",
        "規格值",
        "尺寸",
        "數值",
        "nominal",
        "spec value",
        "標準值",
        "要求值",
        "標稱尺寸",
        "設計值",
        "中心值",
    ],
    "tolerance": ["tolerance", "tol", "公差", "容差", "誤差", "允許公差", "公差範圍"],
    "unit": ["unit", "單位"],
    "aliases": ["alias", "aliases", "別名", "關鍵字", "keywords", "標籤", "同義詞", "代號"],
    "cad_handle": [
        "cad_handle",
        "handle",
        "圖元",
        "圖元id",
        "標註id",
        "entity",
        "entity id",
        "標註代號",
        "圖元代號",
        "dxf handle",
    ],
    "min": ["min", "最小值", "下限", "最小", "lower"],
    "max": ["max", "最大值", "上限", "最大", "upper"],
    "note": ["note", "備註", "說明", "remark", "description", "註記"],
}

CANONICAL_KEYWORDS: list[tuple[str, str, list[str]]] = [
    ("hole_diameter", "孔徑", ["孔徑", "孔直徑", "內孔", "孔洞直徑", "hole diameter", "hole dia", "hole", "borediameter"]),
    ("outer_diameter", "外徑", ["外徑", "外圓直徑", "outer diameter", "outside diameter", "od"]),
    ("diameter", "直徑", ["直徑", "diameter", "dia", "ø", "φ"]),
    ("width", "寬度", ["寬度", "總寬", "面寬", "width", "wide", "w"]),
    ("height", "高度", ["高度", "總高", "height", "tall", "h"]),
    ("length", "長度", ["長度", "總長", "length", "long", "l"]),
    ("thickness", "厚度", ["厚度", "板厚", "料厚", "thickness", "thick", "t"]),
    ("hole_pitch", "孔距", ["孔距", "孔中心距", "中心距", "間距", "pitch", "spacing", "hole spacing"]),
    ("radius", "半徑", ["半徑", "圓角", "radius", "fillet", "r角", "r"]),
    ("angle", "角度", ["角度", "倒角", "angle", "chamfer", "deg", "°"]),
    ("depth", "深度", ["深度", "depth", "deep"]),
    ("weight", "重量", ["重量", "weight", "mass"]),
]

KEYWORD_ALIASES = {
    canonical: (label, aliases) for canonical, label, aliases in CANONICAL_KEYWORDS
}


def _normalize_header(value: Any) -> str:
    text = normalize_text(value).lower()
    text = re.sub(r"[\s_\-./\\()\[\]{}:：;；,，]+", "", text)
    return text


def _cell(value: Any) -> str:
    if value is None:
        return ""
    try:
        if pd.isna(value):
            return ""
    except Exception:
        pass
    return normalize_text(value)


def _split_aliases(value: Any) -> list[str]:
    text = _cell(value)
    if not text:
        return []
    parts = re.split(r"[;,/|、，；]+", text)
    return [part.strip() for part in parts if part.strip()]


def _looks_numeric(value: Any) -> bool:
    return parse_number(value) is not None


def _build_column_map(columns: list[Any]) -> dict[str, Any]:
    normalized = {col: _normalize_header(col) for col in columns}
    mapping: dict[str, Any] = {}
    used: set[Any] = set()
    for canonical, aliases in COLUMN_ALIASES.items():
        normalized_aliases = [_normalize_header(alias) for alias in aliases]
        for col, norm in normalized.items():
            if col in used or not norm:
                continue
            if norm in normalized_aliases:
                mapping[canonical] = col
                used.add(col)
                break
    for canonical, aliases in COLUMN_ALIASES.items():
        if canonical in mapping:
            continue
        normalized_aliases = [_normalize_header(alias) for alias in aliases]
        for col, norm in normalized.items():
            if col in used or not norm:
                continue
            if any(len(alias) >= 2 and alias in norm for alias in normalized_aliases):
                mapping[canonical] = col
                used.add(col)
                break
    return mapping


def _rows_from_dataframe(df: pd.DataFrame) -> list[dict[str, Any]]:
    df = df.dropna(how="all").dropna(axis=1, how="all")
    if df.empty:
        return []
    columns = list(df.columns)
    column_map = _build_column_map(columns)
    if not column_map:
        first = df.iloc[0].tolist()
        if len(columns) >= 2 and _looks_numeric(first[1]) and not _looks_numeric(first[0]):
            column_map = {}
            if len(columns) > 0:
                column_map["name"] = columns[0]
            if len(columns) > 1:
                column_map["target"] = columns[1]
            if len(columns) > 2:
                column_map["tolerance"] = columns[2]
            if len(columns) > 3:
                column_map["unit"] = columns[3]
        else:
            for index, col in enumerate(columns):
                if index == 0:
                    column_map["name"] = col
                elif index == 1:
                    column_map["target"] = col
                elif index == 2:
                    column_map["tolerance"] = col
                elif index == 3:
                    column_map["unit"] = col
    rows: list[dict[str, Any]] = []
    for _, series in df.iterrows():
        row = {str(col): series[col] for col in columns}
        rows.append(row)
    return rows


def _specs_from_records(
    records: list[dict[str, Any]], source: str
) -> SpecParseResult:
    warnings: list[str] = []
    specs: list[SpecItem] = []
    if not records:
        return SpecParseResult([], ["檔案中沒有可用的規格列。"], source)

    columns = list(records[0].keys())
    column_map = _build_column_map(columns)
    if not column_map:
        raise SpecParseError(
            "無法辨識規格表欄位。請至少提供「名稱」與「目標值」欄位，"
            "或使用範例格式：name,target,tolerance,unit,aliases,cad_handle"
        )

    for index, row in enumerate(records, start=1):
        raw_name = _cell(row.get(column_map.get("name")))
        raw_target = _cell(row.get(column_map.get("target")))
        raw_tol = _cell(row.get(column_map.get("tolerance")))
        raw_min = _cell(row.get(column_map.get("min")))
        raw_max = _cell(row.get(column_map.get("max")))
        raw_unit = _cell(row.get(column_map.get("unit")))
        raw_aliases = _cell(row.get(column_map.get("aliases")))
        raw_handle = _cell(row.get(column_map.get("cad_handle")))
        raw_note = _cell(row.get(column_map.get("note")))
        raw_id = _cell(row.get(column_map.get("id")))

        if not any([raw_name, raw_target, raw_min, raw_max]):
            continue

        parsed_target = parse_measurement_value(raw_target)
        target = parsed_target["target"]
        tolerance = parsed_target["tolerance"]
        tol_plus = parsed_target["tol_plus"]
        tol_minus = parsed_target["tol_minus"]
        unit = normalize_unit(raw_unit or parsed_target["unit"] or "mm")

        if raw_min and raw_max:
            low = parse_number(raw_min)
            high = parse_number(raw_max)
            if low is not None and high is not None:
                target = (low + high) / 2.0
                tolerance = abs(high - low) / 2.0
                tol_plus = tolerance
                tol_minus = tolerance
                if not raw_target:
                    warnings.append(
                        f"第 {index} 列使用最小值/最大值建立規格，目標值取中點 {target:g}。"
                    )

        if raw_tol:
            parsed_tol = parse_tolerance(raw_tol)
            if parsed_tol:
                tolerance = parsed_tol["tolerance"]
                tol_plus = parsed_tol["tol_plus"]
                tol_minus = parsed_tol["tol_minus"]

        if target is None:
            warnings.append(f"第 {index} 列「{raw_name or raw_id}」沒有可解析的數值目標，已標記為無法解析。")

        if tolerance is None:
            tolerance = 0.01
        tolerance = abs(tolerance)
        tol_plus = abs(tol_plus) if tol_plus is not None else tolerance
        tol_minus = abs(tol_minus) if tol_minus is not None else tolerance

        spec_id = raw_id or f"S{index:03d}"
        name = raw_name or spec_id
        aliases = _split_aliases(raw_aliases)
        if not aliases and name != spec_id:
            aliases = [name]

        spec = SpecItem(
            id=spec_id,
            name=name,
            target=target,
            tolerance=tolerance,
            tol_plus=tol_plus,
            tol_minus=tol_minus,
            unit=unit,
            aliases=aliases,
            cad_handle=raw_handle or None,
            note=raw_note,
            raw=raw_target,
            source=source,
        )
        specs.append(spec)

    if not specs:
        warnings.append("沒有建立任何規格，請確認欄位對應與資料內容。")
    return SpecParseResult(specs, warnings, source)


def _read_text_with_fallback(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp950", "big5", "gb18030", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _read_csv(data: bytes) -> pd.DataFrame:
    last_error: Exception | None = None
    for encoding in ("utf-8-sig", "utf-8", "cp950", "big5", "gb18030", "latin-1"):
        try:
            text = data.decode(encoding)
        except UnicodeDecodeError:
            continue
        try:
            return pd.read_csv(io.StringIO(text))
        except Exception as exc:
            last_error = exc
        try:
            return pd.read_csv(io.StringIO(text), sep=None, engine="python")
        except Exception as exc:
            last_error = exc
        try:
            dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
            return pd.read_csv(io.StringIO(text), sep=dialect.delimiter)
        except Exception as exc:
            last_error = exc
    raise SpecParseError(f"CSV 解析失敗：{last_error}")


def _read_tabular(data: bytes, suffix: str) -> pd.DataFrame:
    if suffix in {".xlsx", ".xlsm", ".xls"}:
        try:
            return pd.read_excel(io.BytesIO(data))
        except Exception as exc:
            raise SpecParseError(
                f"Excel 解析失敗：{exc}。若為舊版 .xls，請另存為 .xlsx。"
            ) from exc
    if suffix in {".tsv"}:
        text = _read_text_with_fallback(data)
        return pd.read_csv(io.StringIO(text), sep="\t")
    return _read_csv(data)


def _records_from_json(data: bytes) -> tuple[list[dict[str, Any]], str]:
    text = _read_text_with_fallback(data)
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SpecParseError(f"JSON 格式錯誤：{exc}") from exc

    if isinstance(payload, dict):
        part_name = str(payload.get("part_name") or payload.get("名稱") or "").strip()
        if isinstance(payload.get("specs"), list):
            payload = payload["specs"]
        elif isinstance(payload.get("items"), list):
            payload = payload["items"]
        elif isinstance(payload.get("規格"), list):
            payload = payload["規格"]
        else:
            records = []
            for key, value in payload.items():
                if isinstance(value, dict):
                    record = {"name": key}
                    record.update(value)
                else:
                    record = {"name": key, "target": value}
                records.append(record)
            return records, part_name
    else:
        part_name = ""

    if isinstance(payload, list):
        records = []
        for item in payload:
            if isinstance(item, dict):
                records.append(dict(item))
            else:
                records.append({"name": f"規格 {len(records) + 1}", "target": item})
        return records, part_name

    raise SpecParseError("JSON 必須是規格物件陣列或 {name: value} 物件。")


def _line_tolerance(line: str) -> dict[str, float] | None:
    """Extract only an explicit tolerance phrase from free text.

    A bare number on the line is the nominal value, not the tolerance, so this
    must not fall back to simply reading the first number.
    """
    asymmetric = re.search(
        r"(?P<plus>[-+]?\d+(?:\.\d+)?)\s*/\s*[-−]?\s*(?P<minus>\d+(?:\.\d+)?)",
        line,
    )
    if asymmetric and ("+" in line or "±" in line or "公差" in line):
        plus = abs(float(asymmetric.group("plus")))
        minus = abs(float(asymmetric.group("minus")))
        return {"tolerance": max(plus, minus), "tol_plus": plus, "tol_minus": minus}

    explicit = re.search(
        r"(?:公差|容差|tolerance|tol)\s*[：:]?\s*(?:±|\+/-|\+-|正負)?\s*"
        r"(?P<tol>\d+(?:\.\d+)?)",
        line,
        flags=re.IGNORECASE,
    )
    if explicit:
        tol = abs(float(explicit.group("tol")))
        return {"tolerance": tol, "tol_plus": tol, "tol_minus": tol}

    pm = re.search(r"(?:±|\+/-|\+-|正負)\s*(?P<tol>\d+(?:\.\d+)?)", line)
    if pm:
        tol = abs(float(pm.group("tol")))
        return {"tolerance": tol, "tol_plus": tol, "tol_minus": tol}
    return None


def _keyword_for_line(line: str) -> tuple[str, str] | None:
    lowered = line.lower()
    for canonical, label, aliases in CANONICAL_KEYWORDS:
        for alias in aliases:
            if alias.lower() in lowered:
                return canonical, label
    return None


def parse_spec_text(text: str, source: str = "text") -> SpecParseResult:
    warnings: list[str] = []
    specs: list[SpecItem] = []
    seen_names: dict[str, int] = {}
    part_name = ""

    normalized = _read_text_with_fallback(text.encode("utf-8")) if isinstance(text, bytes) else text
    normalized = normalize_text(normalized)
    part_match = re.search(
        r"(?:型號|料號|品號|product\s*code|part\s*(?:no|number)|model)\s*[：:]?\s*([A-Za-z0-9][A-Za-z0-9_./-]{1,40})",
        normalized,
        flags=re.IGNORECASE,
    )
    if part_match:
        part_name = part_match.group(1).strip()

    for line_index, raw_line in enumerate(normalized.splitlines(), start=1):
        line = raw_line.strip()
        if not line or len(line) < 2:
            continue
        lowered = line.lower()
        if lowered in {"規格", "尺寸", "公差", "單位", "name", "value", "target"}:
            continue
        if not re.search(r"\d", line):
            continue

        keyword = _keyword_for_line(line)
        parsed = parse_measurement_value(line)
        target = parsed["target"]
        if target is None:
            continue

        tolerance = parsed["tolerance"]
        tol_plus = parsed["tol_plus"]
        tol_minus = parsed["tol_minus"]
        tol_from_text = _line_tolerance(line)
        if tol_from_text and tolerance is None:
            tolerance = tol_from_text["tolerance"]
            tol_plus = tol_from_text["tol_plus"]
            tol_minus = tol_from_text["tol_minus"]
        if tolerance is None:
            tolerance = 0.01
            tol_plus = tolerance
            tol_minus = tolerance

        if keyword:
            canonical, label = keyword
            name = label
            aliases = [alias for alias in KEYWORD_ALIASES[canonical][1]]
        else:
            left = re.split(r"[:=]", line, maxsplit=1)[0].strip()
            left = re.sub(r"[-+]?\d+(?:\.\d+)?", " ", left)
            left = re.sub(r"\b(?:mm|cm|m|in|inch|um|µm)\b", " ", left, flags=re.IGNORECASE)
            left = re.sub(r"\s+", " ", left).strip(" .-_")
            if len(left) < 2 or _looks_numeric(left):
                name = f"規格 {line_index}"
                aliases = []
            else:
                name = left[:40]
                aliases = [name]

        if name in seen_names:
            seen_names[name] += 1
            name = f"{name} #{seen_names[name]}"
        else:
            seen_names[name] = 1

        spec = SpecItem(
            id=f"S{len(specs) + 1:03d}",
            name=name,
            target=target,
            tolerance=abs(tolerance),
            tol_plus=abs(tol_plus) if tol_plus is not None else abs(tolerance),
            tol_minus=abs(tol_minus) if tol_minus is not None else abs(tolerance),
            unit=normalize_unit(parsed["unit"]),
            aliases=aliases,
            note=clean_cad_text(raw_line),
            raw=raw_line,
            source=source,
        )
        specs.append(spec)

    if not specs:
        warnings.append(
            "無法從文字中辨識規格。建議使用 CSV/Excel，或確認文字包含「名稱 + 數值 + 公差」。"
        )
    else:
        warnings.append(
            "文字規格採規則式萃取，可能有誤判；請在規格校正表中確認後再進行正式比對。"
        )
    return SpecParseResult(specs, warnings, source, part_name=part_name)


def _extract_pdf_text(data: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise SpecParseError("缺少 pypdf，無法解析 PDF。請先安裝 pypdf。") from exc
    try:
        reader = PdfReader(io.BytesIO(data))
        pages = []
        for page in reader.pages:
            pages.append(page.extract_text() or "")
        return "\n".join(pages)
    except Exception as exc:
        raise SpecParseError(f"PDF 文字擷取失敗：{exc}") from exc


def extract_specs_with_ollama(
    text: str,
    model: str | None = None,
    base_url: str | None = None,
    timeout: float = 90.0,
) -> SpecParseResult:
    model = model or os.environ.get("ALUCHECK_OLLAMA_MODEL", "qwen2.5")
    base_url = (base_url or os.environ.get("ALUCHECK_OLLAMA_URL", "http://localhost:11434")).rstrip("/")
    schema_prompt = (
        "你是鋁業 CAD 製圖規格分析師。請把客戶規格文字轉成 JSON。"
        "只輸出 JSON，不要 markdown。格式為："
        '{"part_name":"", "specs":[{"id":"S001","name":"寬度","target":150.5,'
        '"tolerance":0.05,"unit":"mm","aliases":["width","W"],"cad_handle":null,"note":""}]}'
        " target 與 tolerance 必須是數字，單位一律轉為 mm（角度用 deg）。"
    )
    payload = {
        "model": model,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0},
        "messages": [
            {"role": "system", "content": schema_prompt},
            {"role": "user", "content": text[:20000]},
        ],
    }
    request = urllib.request.Request(
        f"{base_url}/api/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise SpecParseError(f"Ollama 連線失敗：{exc}") from exc

    try:
        envelope = json.loads(body)
        content = envelope.get("message", {}).get("content", "")
        if not content:
            content = envelope.get("response", "")
        content = content.strip()
        content = re.sub(r"^```(?:json)?", "", content).strip()
        content = re.sub(r"```$", "", content).strip()
        payload_json = json.loads(content)
    except Exception as exc:
        raise SpecParseError(f"Ollama 回傳格式無法解析：{exc}") from exc

    part_name = str(payload_json.get("part_name", "") if isinstance(payload_json, dict) else "")
    records = payload_json.get("specs") if isinstance(payload_json, dict) else payload_json
    if not isinstance(records, list):
        raise SpecParseError("Ollama 回傳 JSON 缺少 specs 陣列。")
    parsed = _specs_from_records(records, source=f"ollama:{model}")
    parsed.part_name = part_name
    parsed.used_llm = True
    parsed.warnings.append(f"已使用本地 Ollama 模型 {model} 解析規格，請人工複核。")
    return parsed


def load_specs_from_bytes(
    data: bytes,
    filename: str,
    use_llm: bool = False,
    ollama_model: str | None = None,
    ollama_url: str | None = None,
) -> SpecParseResult:
    suffix = Path(filename).suffix.lower()
    source = filename

    if suffix in {".csv", ".tsv", ".xlsx", ".xlsm", ".xls"}:
        df = _read_tabular(data, suffix)
        records = _rows_from_dataframe(df)
        result = _specs_from_records(records, source=source)
        return result

    if suffix == ".json":
        records, part_name = _records_from_json(data)
        result = _specs_from_records(records, source=source)
        result.part_name = part_name
        return result

    if suffix == ".pdf":
        text = _extract_pdf_text(data)
        if use_llm:
            try:
                return extract_specs_with_ollama(text, model=ollama_model, base_url=ollama_url)
            except SpecParseError as exc:
                fallback = parse_spec_text(text, source=source)
                fallback.warnings.insert(0, f"LLM 解析失敗，已改用規則式解析：{exc}")
                return fallback
        return parse_spec_text(text, source=source)

    if suffix in {".txt", ".md", ".text"}:
        text = _read_text_with_fallback(data)
        if use_llm:
            try:
                return extract_specs_with_ollama(text, model=ollama_model, base_url=ollama_url)
            except SpecParseError as exc:
                fallback = parse_spec_text(text, source=source)
                fallback.warnings.insert(0, f"LLM 解析失敗，已改用規則式解析：{exc}")
                return fallback
        return parse_spec_text(text, source=source)

    text = _read_text_with_fallback(data)
    if use_llm:
        try:
            return extract_specs_with_ollama(text, model=ollama_model, base_url=ollama_url)
        except SpecParseError:
            pass
    return parse_spec_text(text, source=source)


def specs_from_records(records: list[dict[str, Any]], source: str = "manual") -> SpecParseResult:
    return _specs_from_records(records, source=source)
