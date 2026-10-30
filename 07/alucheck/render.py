from __future__ import annotations

import io
import os
import tempfile
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.figure import Figure

import ezdxf
from ezdxf.addons.drawing import Frontend, RenderContext
from ezdxf.addons.drawing.config import (
    BackgroundPolicy,
    ColorPolicy,
    Configuration,
)
from ezdxf.addons.drawing.matplotlib import MatplotlibBackend

from .models import MatchResult, STATUS_FAIL, STATUS_PASS, STATUS_WARNING
from .utils import format_value

DARK_BG = "#0b1220"
LIGHT_BG = "#ffffff"
ACCENT_BAD = "#ff5c72"
ACCENT_WARN = "#f5b642"
ACCENT_GOOD = "#3ddc97"
ACCENT_INFO = "#65d4ff"

_FONT_READY = False


def _configure_fonts() -> None:
    global _FONT_READY
    if _FONT_READY:
        return
    candidates = [
        Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts" / "msjh.ttc",
        Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts" / "msyh.ttc",
        Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts" / "simhei.ttf",
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
        Path("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"),
    ]
    for path in candidates:
        if path.exists():
            try:
                font_manager.fontManager.addfont(str(path))
                family = font_manager.FontProperties(fname=str(path)).get_name()
                matplotlib.rcParams["font.family"] = [family, "DejaVu Sans"]
                _FONT_READY = True
                return
            except Exception:
                continue
    _FONT_READY = True


def _load_doc(data: bytes, filename: str) -> Any:
    suffix = Path(filename).suffix or ".dxf"
    temp_path = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp:
            temp.write(data)
            temp_path = temp.name
        return ezdxf.readfile(temp_path)
    finally:
        if temp_path:
            try:
                os.unlink(temp_path)
            except OSError:
                pass


def _strip_annotations(doc: Any) -> None:
    msp = doc.modelspace()
    for entity_type in ("DIMENSION", "TEXT", "MTEXT", "LEADER", "MLEADER"):
        for entity in list(msp.query(entity_type)):
            try:
                msp.delete_entity(entity)
            except Exception:
                pass


def _figure_for_extents(
    extents: tuple[float, float, float, float] | None,
    base_width: float = 15.0,
) -> tuple[Figure, Any]:
    if extents:
        x1, y1, x2, y2 = extents
        width = max(abs(x2 - x1), 1e-6)
        height = max(abs(y2 - y1), 1e-6)
        aspect = height / width
        fig_height = min(13.0, max(4.5, base_width * aspect + 0.8))
    else:
        fig_height = 9.0
    fig = plt.figure(figsize=(base_width, fig_height), facecolor=DARK_BG)
    ax = fig.add_axes([0.03, 0.04, 0.94, 0.86])
    ax.set_facecolor(DARK_BG)
    ax.set_axis_off()
    return fig, ax


def _draw_doc(
    doc: Any,
    ax: Any,
    *,
    dark: bool,
    remove_annotations: bool = False,
    lineweight_scaling: float = 0.8,
) -> int:
    if remove_annotations:
        _strip_annotations(doc)
    msp = doc.modelspace()
    entity_count = len(list(msp))
    bg = DARK_BG if dark else LIGHT_BG
    config = Configuration(
        background_policy=BackgroundPolicy.CUSTOM,
        custom_bg_color=bg,
        color_policy=(
            ColorPolicy.MONOCHROME_DARK_BG if dark else ColorPolicy.BLACK
        ),
        lineweight_scaling=lineweight_scaling,
        min_lineweight=0.15,
    )
    ctx = RenderContext(doc)
    backend = MatplotlibBackend(ax)
    frontend = Frontend(ctx, backend, config=config)
    frontend.draw_layout(msp, finalize=True)
    return entity_count


def _draw_no_data(ax: Any, message: str, dark: bool = True) -> None:
    color = "#cbd5e1" if dark else "#334155"
    ax.text(
        0.5,
        0.5,
        message,
        transform=ax.transAxes,
        ha="center",
        va="center",
        fontsize=16,
        color=color,
        wrap=True,
    )


def _mark_results(
    ax: Any,
    results: list[MatchResult],
    *,
    dark: bool = True,
) -> None:
    count = 0
    for result in results:
        if result.status not in {STATUS_FAIL, STATUS_WARNING}:
            continue
        measurement = result.measurement
        if measurement is None:
            continue
        color = ACCENT_BAD if result.status == STATUS_FAIL else ACCENT_WARN
        x, y = measurement.x, measurement.y
        ax.scatter(
            [x],
            [y],
            s=220,
            facecolors="none",
            edgecolors=color,
            linewidths=2.0,
            zorder=20,
            clip_on=False,
        )
        ax.scatter(
            [x],
            [y],
            s=12,
            color=color,
            zorder=21,
            clip_on=False,
        )
        label = f"{result.spec.id} · {result.status_label}"
        if result.diff is not None:
            label += f" Δ{format_value(result.diff, measurement.unit, 2)}"
        if result.tamper:
            label += " · 文字異常"
        ax.annotate(
            label,
            xy=(x, y),
            xytext=(10, 12),
            textcoords="offset points",
            fontsize=8.5,
            color=color,
            zorder=22,
            annotation_clip=False,
            bbox=dict(
                boxstyle="round,pad=0.28",
                facecolor="#111827" if dark else "#ffffff",
                edgecolor=color,
                linewidth=0.8,
                alpha=0.92,
            ),
        )
        count += 1
    return count


def _save_figure(fig: Figure, dpi: int = 150) -> bytes:
    buffer = io.BytesIO()
    fig.savefig(
        buffer,
        format="png",
        dpi=dpi,
        facecolor=fig.get_facecolor(),
        edgecolor="none",
    )
    plt.close(fig)
    return buffer.getvalue()


def render_annotated(
    data: bytes,
    filename: str,
    results: list[MatchResult] | None = None,
    *,
    title: str | None = None,
    dpi: int = 150,
    dark: bool = True,
) -> bytes:
    _configure_fonts()
    doc = _load_doc(data, filename)
    msp = doc.modelspace()
    extents = None
    try:
        from ezdxf import bbox

        box = bbox.extents(msp, fast=True)
        if box.has_data:
            extents = (box.extmin.x, box.extmin.y, box.extmax.x, box.extmax.y)
    except Exception:
        pass

    fig, ax = _figure_for_extents(extents)
    try:
        entity_count = _draw_doc(doc, ax, dark=dark)
    except Exception:
        entity_count = 0
    if entity_count == 0:
        _draw_no_data(ax, "圖面沒有可渲染的實體", dark=dark)

    if results:
        _mark_results(ax, results, dark=dark)

    bg = DARK_BG if dark else LIGHT_BG
    fg = "#e6edf7" if dark else "#0f172a"
    muted = "#7d8ca3" if dark else "#64748b"
    if title:
        fig.text(
            0.03,
            0.965,
            title,
            color=fg,
            fontsize=12,
            fontweight="bold",
            ha="left",
            va="top",
        )
    fig.text(
        0.97,
        0.965,
        "ALU-CHECK · CAD PRECISION AUDIT",
        color=muted,
        fontsize=7.5,
        ha="right",
        va="top",
    )
    fig.patch.set_facecolor(bg)
    return _save_figure(fig, dpi=dpi)


def render_geometry(
    data: bytes,
    filename: str,
    *,
    dpi: int = 150,
    remove_annotations: bool = True,
) -> bytes:
    """Render white-background, black-line geometry for contour comparison."""
    _configure_fonts()
    doc = _load_doc(data, filename)
    if remove_annotations:
        _strip_annotations(doc)
    msp = doc.modelspace()
    extents = None
    try:
        from ezdxf import bbox

        box = bbox.extents(msp, fast=True)
        if box.has_data:
            extents = (box.extmin.x, box.extmin.y, box.extmax.x, box.extmax.y)
    except Exception:
        pass
    fig, ax = _figure_for_extents(extents, base_width=14.0)
    fig.patch.set_facecolor(LIGHT_BG)
    ax.set_facecolor(LIGHT_BG)
    try:
        entity_count = _draw_doc(doc, ax, dark=False, remove_annotations=False, lineweight_scaling=1.1)
    except Exception:
        entity_count = 0
    if entity_count == 0:
        _draw_no_data(ax, "No geometry", dark=False)
    return _save_figure(fig, dpi=dpi)


def render_spec_card_image(specs: list[Any]) -> bytes:
    """Small fallback image showing parsed specification count."""
    _configure_fonts()
    fig = plt.figure(figsize=(10, 4), facecolor=DARK_BG)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_facecolor(DARK_BG)
    ax.set_axis_off()
    ax.text(
        0.06,
        0.7,
        "ALU-CHECK",
        color=ACCENT_GOOD,
        fontsize=22,
        fontweight="bold",
    )
    ax.text(
        0.06,
        0.48,
        f"已解析 {len(specs)} 筆客戶規格",
        color="#e6edf7",
        fontsize=16,
    )
    ax.text(
        0.06,
        0.3,
        "上傳 DXF 圖檔後即可開始精密比對",
        color="#7d8ca3",
        fontsize=11,
    )
    return _save_figure(fig, dpi=120)
