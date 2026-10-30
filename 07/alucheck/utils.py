from __future__ import annotations

import hashlib
import math
import re
from pathlib import Path
from typing import Any

FULLWIDTH_TRANS = str.maketrans(
    {
        "０": "0",
        "１": "1",
        "２": "2",
        "３": "3",
        "４": "4",
        "５": "5",
        "６": "6",
        "７": "7",
        "８": "8",
        "９": "9",
        "．": ".",
        "，": ",",
        "＋": "+",
        "－": "-",
        "−": "-",
        "±": "±",
        "～": "~",
        "：": ":",
        "；": ";",
        "　": " ",
        "Φ": "Ø",
        "φ": "Ø",
        "⌀": "Ø",
    }
)

UNIT_FACTORS_MM = {
    "mm": 1.0,
    "millimeter": 1.0,
    "millimetre": 1.0,
    "毫米": 1.0,
    "cm": 10.0,
    "centimeter": 10.0,
    "公分": 10.0,
    "厘米": 10.0,
    "m": 1000.0,
    "meter": 1000.0,
    "公尺": 1000.0,
    "米": 1000.0,
    "in": 25.4,
    "inch": 25.4,
    "inches": 25.4,
    "英寸": 25.4,
    "µm": 0.001,
    "um": 0.001,
    "micron": 0.001,
    "微米": 0.001,
}

CAD_UNIT_NAMES = {
    0: "unitless",
    1: "inch",
    2: "ft",
    3: "mile",
    4: "mm",
    5: "cm",
    6: "m",
    7: "km",
    8: "µin",
    9: "mil",
    10: "yd",
    11: "angstrom",
    12: "nm",
    13: "µm",
    14: "dm",
}

NUMBER_RE = re.compile(r"[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?")
RANGE_RE = re.compile(
    r"(?P<low>[-+]?\d+(?:\.\d+)?)\s*(?:~|to|至|到)\s*(?P<high>[-+]?\d+(?:\.\d+)?)",
    re.IGNORECASE,
)
PLUS_MINUS_RE = re.compile(
    r"(?P<target>[-+]?\d+(?:\.\d+)?)\s*(?:±|\+/-|\+-|正負)\s*(?P<tol>\d+(?:\.\d+)?)",
    re.IGNORECASE,
)
ASYM_RE = re.compile(
    r"(?P<target>[-+]?\d+(?:\.\d+)?)\s*\+\s*(?P<plus>\d+(?:\.\d+)?)\s*/\s*[-−]\s*(?P<minus>\d+(?:\.\d+)?)",
    re.IGNORECASE,
)
ASYM_SPACE_RE = re.compile(
    r"(?P<target>[-+]?\d+(?:\.\d+)?)\s*\+\s*(?P<plus>\d+(?:\.\d+)?)\s+[-−]\s*(?P<minus>\d+(?:\.\d+)?)",
    re.IGNORECASE,
)
ASYM_TOL_RE = re.compile(
    r"\+\s*(?P<plus>\d+(?:\.\d+)?)\s*/\s*[-−]\s*(?P<minus>\d+(?:\.\d+)?)",
    re.IGNORECASE,
)
ASYM_TOL_SPACE_RE = re.compile(
    r"\+\s*(?P<plus>\d+(?:\.\d+)?)\s+[-−]\s*(?P<minus>\d+(?:\.\d+)?)",
    re.IGNORECASE,
)
UNIT_RE = re.compile(
    r"(?P<unit>mm|cm|m|in|inch|inches|um|µm|mil|°|deg(?:ree)?s?|毫米|公分|公尺|英寸|微米)",
    re.IGNORECASE,
)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def normalize_text(text: Any) -> str:
    if text is None:
        return ""
    return str(text).translate(FULLWIDTH_TRANS).strip()


def clean_cad_text(text: Any) -> str:
    """Remove common DXF/MText formatting codes for display and label parsing."""
    raw = normalize_text(text)
    if not raw:
        return ""
    raw = re.sub(r"\\[A-Za-z][^;\\]*;", " ", raw)
    raw = raw.replace("\\P", " ").replace("\\~", " ")
    raw = raw.replace("{", " ").replace("}", " ")
    raw = re.sub(r"\\[\\{}]", "", raw)
    raw = re.sub(r"\s+", " ", raw)
    return raw.strip()


def parse_number(text: Any, default: float | None = None) -> float | None:
    value = normalize_text(text)
    if not value:
        return default
    match = NUMBER_RE.search(value)
    if not match:
        return default
    try:
        number = float(match.group(0))
    except ValueError:
        return default
    if not math.isfinite(number):
        return default
    return number


def detect_unit(text: Any, default: str = "mm") -> str:
    value = normalize_text(text)
    match = UNIT_RE.search(value)
    if not match:
        return default
    unit = match.group("unit").lower()
    if unit in {"°", "deg", "degree", "degrees"}:
        return "deg"
    return unit


def to_mm(value: float, unit: str) -> float:
    return value * UNIT_FACTORS_MM.get(normalize_text(unit).lower(), 1.0)


def convert_value(value: float, from_unit: str, to_unit: str) -> float:
    from_unit = normalize_text(from_unit).lower()
    to_unit = normalize_text(to_unit).lower()
    if from_unit == to_unit or from_unit == "deg" or to_unit == "deg":
        return value
    return to_mm(value, from_unit) / UNIT_FACTORS_MM.get(to_unit, 1.0)


def normalize_unit(unit: str | None, default: str = "mm") -> str:
    if not unit:
        return default
    value = normalize_text(unit).lower()
    aliases = {
        "millimeter": "mm",
        "millimetre": "mm",
        "毫米": "mm",
        "centimeter": "cm",
        "公分": "cm",
        "厘米": "cm",
        "meter": "m",
        "公尺": "m",
        "米": "m",
        "inch": "in",
        "inches": "in",
        "英寸": "in",
        "um": "µm",
        "微米": "µm",
        "degree": "deg",
        "degrees": "deg",
        "°": "deg",
    }
    return aliases.get(value, value)


def normalize_cad_unit(code: int) -> tuple[str, int]:
    name = CAD_UNIT_NAMES.get(int(code), "mm")
    if name not in UNIT_FACTORS_MM and name != "unitless":
        return name, int(code)
    if name == "unitless":
        return "mm", 4
    return name, int(code)


def parse_measurement_value(raw: Any) -> dict[str, Any]:
    """Parse human friendly dimensional notation.

    Returns a dict with target, tolerance, tol_plus, tol_minus, unit and cleaned.
    Supports ``150.5 ±0.05``, ``12.5 +0.1/-0.02``, ``120.00~120.10`` and
    plain numeric values. Range notation becomes a symmetric tolerance around
    the midpoint.
    """
    text = normalize_text(raw)
    if not text:
        return {
            "target": None,
            "tolerance": None,
            "tol_plus": None,
            "tol_minus": None,
            "unit": "mm",
            "cleaned": "",
        }

    unit = detect_unit(text, default="mm")
    result: dict[str, Any] = {
        "target": None,
        "tolerance": None,
        "tol_plus": None,
        "tol_minus": None,
        "unit": unit,
        "cleaned": text,
    }

    range_match = RANGE_RE.search(text)
    if range_match:
        low = float(range_match.group("low"))
        high = float(range_match.group("high"))
        result["target"] = round((low + high) / 2.0, 9)
        result["tolerance"] = round(abs(high - low) / 2.0, 9)
        result["tol_plus"] = result["tolerance"]
        result["tol_minus"] = result["tolerance"]
        return result

    asym_match = ASYM_RE.search(text) or ASYM_SPACE_RE.search(text)
    if asym_match:
        result["target"] = float(asym_match.group("target"))
        plus = abs(float(asym_match.group("plus")))
        minus = abs(float(asym_match.group("minus")))
        result["tol_plus"] = plus
        result["tol_minus"] = minus
        result["tolerance"] = max(plus, minus)
        return result

    pm_match = PLUS_MINUS_RE.search(text)
    if pm_match:
        result["target"] = float(pm_match.group("target"))
        tol = abs(float(pm_match.group("tol")))
        result["tolerance"] = tol
        result["tol_plus"] = tol
        result["tol_minus"] = tol
        return result

    result["target"] = parse_number(text)
    return result


def parse_tolerance(raw: Any) -> dict[str, float] | None:
    text = normalize_text(raw)
    if not text:
        return None
    asym_match = ASYM_TOL_RE.search(text) or ASYM_TOL_SPACE_RE.search(text)
    if asym_match:
        plus = abs(float(asym_match.group("plus")))
        minus = abs(float(asym_match.group("minus")))
        return {"tolerance": max(plus, minus), "tol_plus": plus, "tol_minus": minus}
    pm_match = PLUS_MINUS_RE.search(text)
    if pm_match:
        tol = abs(float(pm_match.group("tol")))
        return {"tolerance": tol, "tol_plus": tol, "tol_minus": tol}
    number = parse_number(text)
    if number is None:
        return None
    tol = abs(number)
    return {"tolerance": tol, "tol_plus": tol, "tol_minus": tol}


def format_value(value: float | None, unit: str = "mm", digits: int = 3) -> str:
    if value is None:
        return "—"
    if not math.isfinite(value):
        return "—"
    text = f"{value:.{digits}f}".rstrip("0").rstrip(".")
    if text in {"-0", ""}:
        text = "0"
    return f"{text} {unit}".strip() if unit else text


def format_signed(value: float | None, unit: str = "mm", digits: int = 3) -> str:
    if value is None:
        return "—"
    sign = "+" if value > 0 else ""
    return f"{sign}{format_value(value, unit, digits)}"


def safe_filename(name: str, fallback: str = "drawing") -> str:
    stem = Path(str(name or fallback)).name
    stem = re.sub(r"[^\w.\-\u4e00-\u9fff]+", "_", stem, flags=re.UNICODE)
    stem = stem.strip("._ ")
    return stem or fallback


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def human_size(size: int | float) -> str:
    value = float(size)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024.0
    return f"{value:.1f} GB"
