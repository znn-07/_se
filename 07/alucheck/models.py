from __future__ import annotations

from dataclasses import dataclass, field, fields, is_dataclass
from datetime import datetime, timezone
from typing import Any


STATUS_PASS = "pass"
STATUS_FAIL = "fail"
STATUS_MISSING = "missing"
STATUS_WARNING = "warning"
STATUS_INVALID = "invalid"
STATUS_ERROR = "error"

STATUS_LABELS = {
    STATUS_PASS: "合格",
    STATUS_FAIL: "超差",
    STATUS_MISSING: "缺漏",
    STATUS_WARNING: "需複核",
    STATUS_INVALID: "無法解析",
    STATUS_ERROR: "錯誤",
}

STATUS_TONES = {
    STATUS_PASS: "good",
    STATUS_FAIL: "bad",
    STATUS_MISSING: "warn",
    STATUS_WARNING: "warn",
    STATUS_INVALID: "muted",
    STATUS_ERROR: "bad",
}

DIMENSION_KIND_LABELS = {
    "linear": "線性標註",
    "aligned": "對齊標註",
    "angular": "角度標註",
    "angular3p": "三點角度",
    "diameter": "直徑標註",
    "radius": "半徑標註",
    "ordinate": "座標標註",
    "circle": "圓孔",
    "arc": "圓弧",
    "dimension": "標註",
    "line": "線段",
}


@dataclass
class SpecItem:
    id: str
    name: str
    target: float | None
    tolerance: float = 0.01
    tol_plus: float | None = None
    tol_minus: float | None = None
    unit: str = "mm"
    aliases: list[str] = field(default_factory=list)
    cad_handle: str | None = None
    note: str = ""
    raw: str = ""
    source: str = "manual"

    @property
    def has_target(self) -> bool:
        return self.target is not None

    @property
    def effective_plus(self) -> float:
        if self.tol_plus is not None:
            return abs(self.tol_plus)
        return abs(self.tolerance)

    @property
    def effective_minus(self) -> float:
        if self.tol_minus is not None:
            return abs(self.tol_minus)
        return abs(self.tolerance)

    @property
    def label(self) -> str:
        return self.name or self.id or "未命名規格"

    @property
    def tolerance_text(self) -> str:
        plus = self.effective_plus
        minus = self.effective_minus
        if abs(plus - minus) < 1e-12:
            return f"±{plus:g} {self.unit}".strip()
        return f"+{plus:g}/-{minus:g} {self.unit}".strip()

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "target": self.target,
            "tolerance": self.tolerance,
            "tol_plus": self.tol_plus,
            "tol_minus": self.tol_minus,
            "unit": self.unit,
            "aliases": list(self.aliases),
            "cad_handle": self.cad_handle,
            "note": self.note,
            "raw": self.raw,
            "source": self.source,
        }


@dataclass
class CADMeasurement:
    handle: str
    entity_type: str
    kind: str
    value: float | None
    unit: str = "mm"
    label: str = ""
    layer: str = ""
    x: float = 0.0
    y: float = 0.0
    text_override: str = ""
    text_value: float | None = None
    text_tampered: bool = False
    dimension_kind: str = ""
    source: str = "modelspace"
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def display_kind(self) -> str:
        return DIMENSION_KIND_LABELS.get(
            self.dimension_kind or self.kind, self.dimension_kind or self.kind
        )

    @property
    def is_dimension(self) -> bool:
        return self.entity_type.upper() == "DIMENSION"

    @property
    def display_label(self) -> str:
        if self.label:
            return self.label
        if self.text_override and self.text_override not in {"<>", ""}:
            return self.text_override
        return f"{self.display_kind} {self.handle}"

    def as_dict(self) -> dict[str, Any]:
        return {
            "handle": self.handle,
            "entity_type": self.entity_type,
            "kind": self.kind,
            "value": self.value,
            "unit": self.unit,
            "label": self.label,
            "layer": self.layer,
            "x": self.x,
            "y": self.y,
            "text_override": self.text_override,
            "text_value": self.text_value,
            "text_tampered": self.text_tampered,
            "dimension_kind": self.dimension_kind,
            "source": self.source,
            "extra": dict(self.extra),
        }


@dataclass
class CADDocument:
    filename: str
    sha256: str
    unit: str = "mm"
    unit_code: int = 4
    measurements: list[CADMeasurement] = field(default_factory=list)
    entity_counts: dict[str, int] = field(default_factory=dict)
    layers: list[str] = field(default_factory=list)
    extents: tuple[float, float, float, float] | None = None
    title: str = ""
    warnings: list[str] = field(default_factory=list)
    blocks: list[str] = field(default_factory=list)

    @property
    def dimension_count(self) -> int:
        return sum(1 for m in self.measurements if m.is_dimension)

    @property
    def measurement_count(self) -> int:
        return len(self.measurements)

    def as_dict(self) -> dict[str, Any]:
        return {
            "filename": self.filename,
            "sha256": self.sha256,
            "unit": self.unit,
            "unit_code": self.unit_code,
            "measurements": [m.as_dict() for m in self.measurements],
            "entity_counts": dict(self.entity_counts),
            "layers": list(self.layers),
            "extents": list(self.extents) if self.extents else None,
            "title": self.title,
            "warnings": list(self.warnings),
            "blocks": list(self.blocks),
        }


@dataclass
class MatchResult:
    spec: SpecItem
    measurement: CADMeasurement | None
    status: str
    diff: float | None = None
    deviation_pct: float | None = None
    tolerance_used: float | None = None
    score: float = 0.0
    reasons: list[str] = field(default_factory=list)
    candidates: list[str] = field(default_factory=list)
    tamper: bool = False

    @property
    def status_label(self) -> str:
        return STATUS_LABELS.get(self.status, self.status)

    @property
    def tone(self) -> str:
        return STATUS_TONES.get(self.status, "muted")

    @property
    def actual_value(self) -> float | None:
        return self.measurement.value if self.measurement else None

    @property
    def passed(self) -> bool:
        return self.status == STATUS_PASS

    def as_dict(self) -> dict[str, Any]:
        return {
            "spec": self.spec.as_dict(),
            "measurement": self.measurement.as_dict() if self.measurement else None,
            "status": self.status,
            "status_label": self.status_label,
            "diff": self.diff,
            "deviation_pct": self.deviation_pct,
            "tolerance_used": self.tolerance_used,
            "score": self.score,
            "reasons": list(self.reasons),
            "candidates": list(self.candidates),
            "tamper": self.tamper,
        }


@dataclass
class VisionResult:
    status: str = STATUS_ERROR
    score: float = 0.0
    shape_diff: float = 0.0
    area_ratio: float = 0.0
    centroid_shift: float = 0.0
    overlap: float = 0.0
    contour_count: int = 0
    message: str = ""
    image_png: bytes | None = None

    @property
    def status_label(self) -> str:
        return STATUS_LABELS.get(self.status, self.status)

    @property
    def tone(self) -> str:
        return STATUS_TONES.get(self.status, "muted")

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "status_label": self.status_label,
            "score": self.score,
            "shape_diff": self.shape_diff,
            "area_ratio": self.area_ratio,
            "centroid_shift": self.centroid_shift,
            "overlap": self.overlap,
            "contour_count": self.contour_count,
            "message": self.message,
        }


@dataclass
class ComparisonReport:
    filename: str
    spec_filename: str
    created_at: str
    results: list[MatchResult]
    stats: dict[str, Any]
    document_summary: dict[str, Any]
    vision: VisionResult | None = None
    settings: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    annotated_png: bytes | None = None
    vision_png: bytes | None = None

    @property
    def overall_status(self) -> str:
        if any(r.status in {STATUS_FAIL, STATUS_INVALID} for r in self.results):
            return STATUS_FAIL
        if any(r.status in {STATUS_MISSING, STATUS_WARNING} for r in self.results):
            return STATUS_WARNING
        if self.vision and self.vision.status not in {STATUS_PASS, STATUS_ERROR}:
            return STATUS_WARNING
        return STATUS_PASS

    @property
    def overall_label(self) -> str:
        return {
            STATUS_PASS: "全數合格",
            STATUS_FAIL: "發現超差",
            STATUS_WARNING: "需要複核",
        }.get(self.overall_status, "待確認")

    @property
    def overall_tone(self) -> str:
        return STATUS_TONES.get(self.overall_status, "muted")

    def as_dict(self, include_bytes: bool = False) -> dict[str, Any]:
        data = {
            "filename": self.filename,
            "spec_filename": self.spec_filename,
            "created_at": self.created_at,
            "overall_status": self.overall_status,
            "overall_label": self.overall_label,
            "results": [r.as_dict() for r in self.results],
            "stats": dict(self.stats),
            "document_summary": dict(self.document_summary),
            "vision": self.vision.as_dict() if self.vision else None,
            "settings": dict(self.settings),
            "warnings": list(self.warnings),
        }
        if include_bytes:
            data["annotated_png"] = self.annotated_png
            data["vision_png"] = self.vision_png
        return data


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def dataclass_to_dict(value: Any) -> Any:
    """Best-effort JSON friendly conversion for nested dataclasses."""
    if is_dataclass(value) and not isinstance(value, type):
        result: dict[str, Any] = {}
        for item in fields(value):
            if item.name.endswith("_png"):
                continue
            result[item.name] = dataclass_to_dict(getattr(value, item.name))
        return result
    if isinstance(value, dict):
        return {str(k): dataclass_to_dict(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [dataclass_to_dict(v) for v in value]
    return value
