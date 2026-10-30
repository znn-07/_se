from __future__ import annotations

from pathlib import Path
from typing import Any

import ezdxf
from ezdxf import units

from .render import render_geometry

DEMO_DIR = Path(__file__).resolve().parent.parent / "examples"

SPEC_CSV = """id,name,target,tolerance,unit,aliases,cad_handle,note
S001,寬度,150.5,0.05,mm,"width,W,總寬","","板件總寬"
S002,高度,90.0,0.05,mm,"height,H,總高","","板件總高"
S003,厚度,4.0,0.05,mm,"thickness,T,板厚","","側視圖板厚；圖面文字疑似被覆寫"
S004,孔徑,12.5,0.02,mm,"hole_diameter,DIA,孔徑,直徑","","四孔孔徑"
S005,孔距,90.0,0.10,mm,"pitch,P,孔距,中心距","","左右孔中心距"
S006,倒角角度,45.0,0.5,deg,"angle,倒角,chamfer","","未標註時應警示"
"""


def _add_title(msp: Any, title: str) -> None:
    msp.add_text(
        title,
        height=4.0,
        dxfattribs={"layer": "TITLE"},
    ).set_placement((8, 102))


def _add_plate(msp: Any, *, side_thickness: float, holes: list[tuple[float, float]]) -> None:
    msp.add_lwpolyline(
        [(0, 0), (150.5, 0), (150.5, 90), (0, 90)],
        close=True,
        dxfattribs={"layer": "OUTLINE"},
    )
    for x, y in holes:
        msp.add_circle(
            (x, y),
            radius=6.25,
            dxfattribs={"layer": "HOLES"},
        )
    # Side / section view used to carry the material thickness callout.
    msp.add_lwpolyline(
        [(0, -45), (150.5, -45), (150.5, -45 + side_thickness), (0, -45 + side_thickness)],
        close=True,
        dxfattribs={"layer": "SIDE_VIEW"},
    )
    msp.add_text(
        "SIDE VIEW",
        height=3.0,
        dxfattribs={"layer": "NOTES"},
    ).set_placement((0, -55))


def _set_dim_text(dim_entity: Any, text: str) -> None:
    dim_entity.dxf.text = text


def _build_actual_doc() -> ezdxf.document.Drawing:
    doc = ezdxf.new("R2010", setup=True)
    doc.units = units.MM
    msp = doc.modelspace()
    holes = [(25, 25), (25, 65), (115, 65), (95, 25)]
    _add_plate(msp, side_thickness=3.8, holes=holes)
    _add_title(msp, "AL-992 HEAT SINK PROFILE")

    width = msp.add_linear_dim(
        base=(0, -12), p1=(0, 0), p2=(150.5, 0), dimstyle="EZDXF"
    )
    width.render()
    _set_dim_text(width.dimension, "W=150.50")

    height = msp.add_linear_dim(
        base=(162, 0),
        p1=(150.5, 0),
        p2=(150.5, 90),
        angle=90,
        dimstyle="EZDXF",
    )
    height.render()
    _set_dim_text(height.dimension, "H=90.00")

    pitch = msp.add_linear_dim(
        base=(25, 76),
        p1=(25, 65),
        p2=(115, 65),
        dimstyle="EZDXF",
    )
    pitch.render()
    _set_dim_text(pitch.dimension, "P=90.00")

    diameter = msp.add_diameter_dim(
        center=(25, 25), radius=6.25, angle=45, dimstyle="EZDXF"
    )
    diameter.render()
    _set_dim_text(diameter.dimension, "DIA=12.50")

    thickness = msp.add_linear_dim(
        base=(-24, -45),
        p1=(0, -45),
        p2=(0, -41.2),
        angle=90,
        dimstyle="EZDXF",
    )
    thickness.render()
    # Intentionally inconsistent: geometry says 3.80, text claims 4.00.
    _set_dim_text(thickness.dimension, "T=4.00")
    return doc


def _build_ideal_doc() -> ezdxf.document.Drawing:
    doc = ezdxf.new("R2010", setup=True)
    doc.units = units.MM
    msp = doc.modelspace()
    holes = [(25, 25), (25, 65), (115, 65), (115, 25)]
    _add_plate(msp, side_thickness=4.0, holes=holes)
    return doc


def build_demo_bytes() -> dict[str, bytes]:
    actual = _build_actual_doc()
    ideal = _build_ideal_doc()
    actual_buffer = _save_to_bytes(actual)
    ideal_buffer = _save_to_bytes(ideal)
    reference_png = render_geometry(ideal_buffer, "demo_ideal.dxf", dpi=150)
    return {
        "actual_dxf": actual_buffer,
        "ideal_dxf": ideal_buffer,
        "specs_csv": SPEC_CSV.encode("utf-8-sig"),
        "reference_png": reference_png,
    }


def _save_to_bytes(doc: ezdxf.document.Drawing) -> bytes:
    import io

    buffer = io.StringIO()
    doc.write(buffer)
    return buffer.getvalue().encode("utf-8")


def ensure_demo_files(base_dir: str | Path | None = None) -> dict[str, Path]:
    target = Path(base_dir) if base_dir else DEMO_DIR
    target.mkdir(parents=True, exist_ok=True)
    paths = {
        "actual_dxf": target / "demo_actual.dxf",
        "ideal_dxf": target / "demo_ideal.dxf",
        "specs_csv": target / "demo_specs.csv",
        "reference_png": target / "demo_reference.png",
    }
    if all(path.exists() for path in paths.values()):
        return paths

    payload = build_demo_bytes()
    paths["actual_dxf"].write_bytes(payload["actual_dxf"])
    paths["ideal_dxf"].write_bytes(payload["ideal_dxf"])
    paths["specs_csv"].write_bytes(payload["specs_csv"])
    paths["reference_png"].write_bytes(payload["reference_png"])
    return paths


def get_demo_payload() -> dict[str, bytes]:
    payload = build_demo_bytes()
    return payload
