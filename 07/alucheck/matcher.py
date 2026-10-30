from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any

from .models import (
    CADDocument,
    CADMeasurement,
    MatchResult,
    SpecItem,
    STATUS_FAIL,
    STATUS_INVALID,
    STATUS_MISSING,
    STATUS_PASS,
    STATUS_WARNING,
)
from .utils import convert_value, format_value, normalize_text, normalize_unit

DIAMETER_WORDS = {
    "孔徑",
    "孔",
    "直徑",
    "外徑",
    "內徑",
    "孔洞",
    "圓孔",
    "diameter",
    "dia",
    "ø",
    "φ",
    "hole",
    "circle",
    "bore",
}
RADIUS_WORDS = {"半徑", "圓角", "r角", "radius", "fillet"}
ANGLE_WORDS = {"角度", "倒角", "angle", "deg", "°", "chamfer"}
LINEAR_WORDS = {
    "寬度",
    "寬",
    "高度",
    "高",
    "長度",
    "長",
    "厚度",
    "厚",
    "孔距",
    "中心距",
    "間距",
    "距離",
    "深度",
    "width",
    "height",
    "length",
    "thickness",
    "pitch",
    "spacing",
    "distance",
    "depth",
    "wide",
    "thick",
    "long",
    "tall",
}
CHINESE_SINGLE = {"寬", "高", "長", "厚", "孔", "徑", "角", "深"}


@dataclass
class Candidate:
    measurement: CADMeasurement
    score: float
    diff: float | None
    actual: float | None
    expected: float | None
    label_score: float
    type_score: float
    numeric_score: float
    reasons: list[str]
    note: str = ""


def _norm(value: str) -> str:
    text = normalize_text(value).lower()
    text = re.sub(r"[\s_\-./\\()\[\]{}:：;；,，=+±<>|]+", "", text)
    return text


def _tokens(spec: SpecItem) -> list[str]:
    values = [spec.name, spec.id, *spec.aliases]
    tokens: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = normalize_text(value)
        if not text:
            continue
        candidates = [text]
        candidates.extend(re.split(r"[\s/|,;、]+", text))
        for candidate in candidates:
            token = candidate.strip()
            if not token:
                continue
            key = token.lower()
            if key in seen:
                continue
            seen.add(key)
            tokens.append(token)
    tokens.sort(key=len, reverse=True)
    return tokens


def _spec_hints(spec: SpecItem) -> set[str]:
    text = " ".join(
        [spec.name, spec.note, spec.raw, *spec.aliases]
    ).lower()
    hints: set[str] = set()
    if any(word in text for word in DIAMETER_WORDS):
        hints.add("diameter")
        hints.add("hole")
    if any(word in text for word in RADIUS_WORDS):
        hints.add("radius")
    if any(word in text for word in ANGLE_WORDS):
        hints.add("angle")
    if any(word in text for word in LINEAR_WORDS):
        hints.add("linear")
    return hints


def _measurement_kinds(measurement: CADMeasurement) -> set[str]:
    kind = (measurement.dimension_kind or measurement.kind or "").lower()
    if kind == "diameter":
        return {"diameter", "hole", "circle"}
    if kind == "radius":
        return {"radius", "arc", "circle"}
    if kind in {"angular", "angular3p"}:
        return {"angle"}
    if kind in {"linear", "aligned"}:
        return {"linear"}
    if kind == "circle":
        return {"diameter", "hole", "circle"}
    if kind == "arc":
        return {"radius", "arc"}
    return {"linear"}


def _label_text(measurement: CADMeasurement) -> str:
    parts = [measurement.label, measurement.text_override]
    return " ".join(part for part in parts if part)


def _label_score(spec: SpecItem, measurement: CADMeasurement) -> tuple[float, list[str]]:
    label = normalize_text(_label_text(measurement))
    if not label:
        return 0.0, []
    label_norm = _norm(label)
    label_tokens = {
        token for token in re.split(r"[\s_\-./\\()\[\]{}:：;；,，=+±<>|]+", label) if token
    }
    label_tokens_norm = {_norm(token) for token in label_tokens}
    reasons: list[str] = []

    for token in _tokens(spec):
        token_norm = _norm(token)
        if not token_norm:
            continue
        if len(token_norm) >= 2:
            if token_norm == label_norm:
                return 40.0, [f"標註文字直接對應「{token}」"]
            if token_norm in label_norm or label_norm in token_norm:
                reasons.append(f"標註文字包含關鍵字「{token}」")
                return 36.0, reasons
        elif len(token_norm) == 1:
            if token in CHINESE_SINGLE and token in label:
                return 34.0, [f"標註文字包含「{token}」"]
            if token_norm in label_tokens_norm:
                return 34.0, [f"標註代號「{token}」完全吻合"]
    return 0.0, []


def _type_score(spec: SpecItem, measurement: CADMeasurement) -> tuple[float, list[str]]:
    hints = _spec_hints(spec)
    kinds = _measurement_kinds(measurement)
    if not hints:
        return 5.0, []
    if hints & kinds:
        return 20.0, [f"圖元類型符合（{measurement.display_kind}）"]
    if "linear" in hints and "linear" in kinds:
        return 18.0, ["線性尺寸類型符合"]
    return 0.0, []


def _actual_for_spec(
    spec: SpecItem, measurement: CADMeasurement
) -> tuple[float | None, list[str]]:
    if measurement.value is None:
        return None, []
    actual = float(measurement.value)
    reasons: list[str] = []
    kind = (measurement.dimension_kind or measurement.kind or "").lower()
    hints = _spec_hints(spec)
    if "diameter" in hints or "hole" in hints:
        if kind == "radius":
            actual *= 2.0
            reasons.append("半徑標註已換算為直徑")
    elif "radius" in hints:
        if kind == "circle":
            actual /= 2.0
            reasons.append("圓孔直徑已換算為半徑")
    return actual, reasons


def _numeric_score(
    actual: float | None, expected: float | None, tolerance: float
) -> tuple[float, float | None]:
    if actual is None or expected is None:
        return 0.0, None
    diff = abs(actual - expected)
    tolerance = max(abs(tolerance), 1e-9)
    if diff <= tolerance:
        return 25.0, diff
    if expected != 0:
        ratio = diff / abs(expected)
        if ratio <= 0.005:
            return 18.0, diff
        if ratio <= 0.02:
            return 12.0, diff
        if ratio <= 0.05:
            return 8.0, diff
    if diff <= 2.0:
        return 8.0, diff
    return 0.0, diff


def _expected_in_unit(
    spec: SpecItem, measurement_unit: str
) -> tuple[float | None, float, float, float]:
    if spec.target is None:
        return None, 0.0, 0.0, 0.0
    spec_unit = normalize_unit(spec.unit)
    target_unit = normalize_unit(measurement_unit)
    if spec_unit == "deg" or target_unit == "deg":
        expected = spec.target
        plus = spec.effective_plus
        minus = spec.effective_minus
    else:
        expected = convert_value(spec.target, spec_unit, target_unit)
        plus = convert_value(spec.effective_plus, spec_unit, target_unit)
        minus = convert_value(spec.effective_minus, spec_unit, target_unit)
    tolerance = max(plus, minus)
    return expected, plus, minus, tolerance


def _build_candidates(
    spec: SpecItem,
    measurements: list[CADMeasurement],
    min_score: float = 22.0,
) -> list[Candidate]:
    candidates: list[Candidate] = []
    hints = _spec_hints(spec)
    type_match_count = sum(
        1
        for measurement in measurements
        if hints and hints & _measurement_kinds(measurement)
    )
    for measurement in measurements:
        if measurement.value is None:
            continue
        actual, conversion_notes = _actual_for_spec(spec, measurement)
        if actual is None:
            continue
        expected, plus, minus, tolerance = _expected_in_unit(spec, measurement.unit)
        label_score, label_reasons = _label_score(spec, measurement)
        type_score, type_reasons = _type_score(spec, measurement)
        numeric_score, diff = _numeric_score(actual, expected, tolerance)
        reasons = [*label_reasons, *type_reasons, *conversion_notes]

        # A type-only guess is unsafe when the value is nowhere near the target.
        if label_score <= 0 and numeric_score < 8 and type_score <= 5:
            continue
        if (
            label_score <= 0
            and type_score >= 10
            and numeric_score < 8
            and type_match_count > 1
        ):
            continue

        score = 10.0 + label_score + type_score + numeric_score
        if measurement.is_dimension:
            score += 2.0
        if score < min_score:
            continue
        if diff is not None:
            score += min(4.0, max(0.0, 2.0 - diff))
        note = ""
        if expected is not None and diff is not None and diff > max(plus, minus):
            note = (
                f"預期 {format_value(expected, measurement.unit)}，"
                f"實際 {format_value(actual, measurement.unit)}"
            )
        candidates.append(
            Candidate(
                measurement=measurement,
                score=round(score, 3),
                diff=diff,
                actual=actual,
                expected=expected,
                label_score=label_score,
                type_score=type_score,
                numeric_score=numeric_score,
                reasons=reasons,
                note=note,
            )
        )

    candidates.sort(
        key=lambda c: (
            -c.score,
            c.diff if c.diff is not None else float("inf"),
            c.measurement.handle,
        )
    )
    return candidates


def _reasons_for_pass(
    spec: SpecItem, candidate: Candidate, plus: float, minus: float
) -> list[str]:
    reasons = list(candidate.reasons)
    measurement = candidate.measurement
    unit = measurement.unit
    if candidate.expected is not None:
        reasons.append(
            f"目標 {format_value(candidate.expected, unit)}，"
            f"實測 {format_value(candidate.actual, unit)}，"
            f"偏差 {format_value(candidate.diff, unit)}"
        )
        if abs(plus - minus) > 1e-12:
            reasons.append(
                f"容許區間 {format_value(candidate.expected - minus, unit)} ~ "
                f"{format_value(candidate.expected + plus, unit)}"
            )
    if measurement.text_override:
        reasons.append(f"標註文字：{measurement.text_override}")
    return reasons


def _evaluate_candidate(
    spec: SpecItem, candidate: Candidate
) -> MatchResult:
    measurement = candidate.measurement
    expected, plus, minus, tolerance = _expected_in_unit(spec, measurement.unit)
    actual = candidate.actual
    diff = candidate.diff
    reasons = list(candidate.reasons)
    tamper = measurement.text_tampered

    if expected is None or actual is None:
        return MatchResult(
            spec=spec,
            measurement=measurement,
            status=STATUS_INVALID,
            diff=diff,
            tolerance_used=tolerance,
            score=candidate.score,
            reasons=["規格目標值無法解析為數字。"],
            candidates=[],
        )

    lower = expected - minus
    upper = expected + plus
    passed = lower - 1e-9 <= actual <= upper + 1e-9
    deviation_pct = (abs(diff) / abs(expected) * 100.0) if expected not in (0, None) else None

    if passed:
        reasons.extend(_reasons_for_pass(spec, candidate, plus, minus))
        status = STATUS_PASS
        if tamper:
            status = STATUS_WARNING
            text_value = measurement.text_value
            reasons.insert(
                0,
                "幾何實際值在公差內，但標註文字與幾何測量值不一致"
                f"（文字 {format_value(text_value, measurement.unit)} / "
                f"幾何 {format_value(actual, measurement.unit)}），疑似手動覆寫。",
            )
    else:
        status = STATUS_FAIL
        reasons.insert(
            0,
            f"實測 {format_value(actual, measurement.unit)} 超出容許區間 "
            f"{format_value(lower, measurement.unit)} ~ {format_value(upper, measurement.unit)}。",
        )
        if tamper:
            text_value = measurement.text_value
            text_target_ok = text_value is not None and lower - 1e-9 <= text_value <= upper + 1e-9
            if text_target_ok:
                reasons.insert(
                    0,
                    "高風險：標註文字顯示合格，但幾何實際值超差，疑似手動修改標註文字掩蓋錯誤。",
                )
            else:
                reasons.insert(
                    0,
                    f"標註文字（{format_value(text_value, measurement.unit)}）與幾何實際值"
                    f"（{format_value(actual, measurement.unit)}）不一致。",
                )
        if measurement.text_override:
            reasons.append(f"標註文字：{measurement.text_override}")

    return MatchResult(
        spec=spec,
        measurement=measurement,
        status=status,
        diff=abs(diff) if diff is not None else None,
        deviation_pct=deviation_pct,
        tolerance_used=tolerance,
        score=candidate.score,
        reasons=reasons,
        candidates=[],
        tamper=tamper,
    )


def _candidate_summary(candidate: Candidate) -> str:
    measurement = candidate.measurement
    return (
        f"{measurement.handle} · {measurement.display_label} · "
        f"{format_value(candidate.actual, measurement.unit)} · score {candidate.score:.1f}"
    )


def compare_specs(
    document: CADDocument,
    specs: list[SpecItem],
    settings: dict[str, Any] | None = None,
) -> list[MatchResult]:
    settings = settings or {}
    min_score = float(settings.get("min_candidate_score", 22.0))
    measurements = [m for m in document.measurements if m.value is not None]
    results: list[MatchResult | None] = [None] * len(specs)
    assigned: dict[str, int] = {}

    # 1) Explicit handles are locked first so a named label can never steal them.
    for index, spec in enumerate(specs):
        if not spec.cad_handle:
            continue
        handle = str(spec.cad_handle).strip().upper()
        match = next(
            (m for m in measurements if str(m.handle).upper() == handle), None
        )
        if match is None:
            results[index] = MatchResult(
                spec=spec,
                measurement=None,
                status=STATUS_MISSING,
                reasons=[f"找不到指定的 CAD 圖元 Handle：{spec.cad_handle}。"],
            )
            continue
        if handle in assigned:
            results[index] = MatchResult(
                spec=spec,
                measurement=match,
                status=STATUS_WARNING,
                reasons=[
                    f"Handle {handle} 已由規格 {specs[assigned[handle]].id} 使用，"
                    "同一圖元被多筆規格引用。"
                ],
            )
            continue
        actual, conversion_notes = _actual_for_spec(spec, match)
        expected, plus, minus, tolerance = _expected_in_unit(spec, match.unit)
        diff = abs(actual - expected) if actual is not None and expected is not None else None
        candidate = Candidate(
            measurement=match,
            score=100.0,
            diff=diff,
            actual=actual,
            expected=expected,
            label_score=0.0,
            type_score=0.0,
            numeric_score=0.0,
            reasons=[f"使用指定 Handle {handle}", *conversion_notes],
        )
        assigned[handle] = index
        results[index] = _evaluate_candidate(spec, candidate)

    # 2) Global greedy assignment for everything else.
    pairs: list[tuple[float, int, Candidate]] = []
    candidate_cache: dict[int, list[Candidate]] = {}
    for index, spec in enumerate(specs):
        if results[index] is not None:
            continue
        if spec.target is None:
            results[index] = MatchResult(
                spec=spec,
                measurement=None,
                status=STATUS_INVALID,
                reasons=["規格目標值無法解析為數字，無法比對。"],
            )
            continue
        candidates = _build_candidates(spec, measurements, min_score=min_score)
        candidate_cache[index] = candidates
        for candidate in candidates:
            pairs.append((candidate.score, index, candidate))

    pairs.sort(
        key=lambda item: (
            -item[0],
            item[2].diff if item[2].diff is not None else float("inf"),
            item[1],
            item[2].measurement.handle,
        )
    )

    for score, index, candidate in pairs:
        if results[index] is not None:
            continue
        handle = str(candidate.measurement.handle).upper()
        if handle in assigned:
            continue
        assigned[handle] = index
        result = _evaluate_candidate(specs[index], candidate)
        result.candidates = [
            _candidate_summary(c) for c in candidate_cache.get(index, [])[:3]
        ]
        results[index] = result

    # 3) Remaining specs are missing; include near-miss candidates for diagnosis.
    for index, spec in enumerate(specs):
        if results[index] is not None:
            continue
        candidates = candidate_cache.get(index, [])
        reasons = ["圖面中找不到可對應的標註或幾何特徵。"]
        if candidates:
            reasons.append(
                "最接近的候選已被其他規格使用，或分數低於門檻："
                + "；".join(_candidate_summary(c) for c in candidates[:2])
            )
        results[index] = MatchResult(
            spec=spec,
            measurement=None,
            status=STATUS_MISSING,
            reasons=reasons,
            candidates=[_candidate_summary(c) for c in candidates[:3]],
        )

    final = [result for result in results if result is not None]
    return final


def build_stats(results: list[MatchResult]) -> dict[str, Any]:
    total = len(results)
    counts = {
        STATUS_PASS: 0,
        STATUS_FAIL: 0,
        STATUS_MISSING: 0,
        STATUS_WARNING: 0,
        STATUS_INVALID: 0,
    }
    for result in results:
        counts[result.status] = counts.get(result.status, 0) + 1
    checked = total - counts.get(STATUS_INVALID, 0)
    pass_rate = (counts[STATUS_PASS] / checked * 100.0) if checked else 0.0
    deviations = [r.deviation_pct for r in results if r.deviation_pct is not None]
    tamper_count = sum(1 for result in results if result.tamper)
    worst = max((r.diff or 0.0 for r in results if r.status == STATUS_FAIL), default=0.0)
    return {
        "total": total,
        "checked": checked,
        "pass": counts[STATUS_PASS],
        "fail": counts[STATUS_FAIL],
        "missing": counts[STATUS_MISSING],
        "warning": counts[STATUS_WARNING],
        "invalid": counts[STATUS_INVALID],
        "pass_rate": round(pass_rate, 1),
        "tamper_count": tamper_count,
        "worst_deviation": worst,
        "max_deviation_pct": round(max(deviations), 3) if deviations else 0.0,
    }


def document_summary(document: CADDocument) -> dict[str, Any]:
    return {
        "filename": document.filename,
        "title": document.title,
        "sha256": document.sha256[:16],
        "unit": document.unit,
        "dimension_count": document.dimension_count,
        "measurement_count": document.measurement_count,
        "entity_counts": dict(document.entity_counts),
        "layers": document.layers,
        "extents": list(document.extents) if document.extents else None,
        "warnings": list(document.warnings),
    }
