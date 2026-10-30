from __future__ import annotations

import json

import pytest

from alucheck.cad_parser import parse_dxf_bytes
from alucheck.matcher import build_stats, compare_specs
from alucheck.models import STATUS_FAIL, STATUS_MISSING, STATUS_PASS
from alucheck.render import render_geometry
from alucheck.report import create_report, report_to_csv, report_to_html, report_to_json
from alucheck.sample_data import build_demo_bytes
from alucheck.specs import load_specs_from_bytes, parse_spec_text
from alucheck.utils import convert_value, parse_measurement_value, parse_tolerance
from alucheck.vision import compare_images


@pytest.fixture(scope="module")
def payload() -> dict[str, bytes]:
    return build_demo_bytes()


@pytest.fixture(scope="module")
def parsed(payload: dict[str, bytes]):
    return parse_dxf_bytes(payload["actual_dxf"], "demo_actual.dxf", use_cache=False)


@pytest.fixture(scope="module")
def specs(payload: dict[str, bytes]):
    return load_specs_from_bytes(payload["specs_csv"], "demo_specs.csv").specs


@pytest.fixture(scope="module")
def results(parsed, specs):
    return compare_specs(parsed, specs)


def test_utils_parse_tolerance_and_units() -> None:
    tolerance = parse_tolerance("+0.10/-0.05")
    assert tolerance is not None
    assert tolerance["tol_plus"] == pytest.approx(0.1)
    assert tolerance["tol_minus"] == pytest.approx(0.05)
    assert tolerance["tolerance"] == pytest.approx(0.1)
    symmetric = parse_tolerance("±0.05")
    assert symmetric is not None
    assert symmetric["tol_plus"] == pytest.approx(0.05)
    assert symmetric["tol_minus"] == pytest.approx(0.05)
    assert convert_value(1.0, "in", "mm") == pytest.approx(25.4)
    measurement = parse_measurement_value("Ø12.5 ±0.05 mm")
    assert measurement["target"] == pytest.approx(12.5)
    assert measurement["unit"] == "mm"
    assert measurement["tol_plus"] == pytest.approx(0.05)


def test_specs_csv_parsing(payload: dict[str, bytes]) -> None:
    parse_result = load_specs_from_bytes(payload["specs_csv"], "demo_specs.csv")
    assert len(parse_result.specs) == 6
    by_id = {spec.id: spec for spec in parse_result.specs}
    assert by_id["S001"].target == pytest.approx(150.5)
    assert by_id["S003"].tolerance == pytest.approx(0.05)
    assert "thickness" in by_id["S003"].aliases


def test_specs_text_parsing() -> None:
    text = """
    寬度 150.5 ±0.05 mm
    厚度 4.0 +0.10/-0.05
    孔徑 Ø12.5 ±0.02
    """
    parse_result = parse_spec_text(text, source="inline-test")
    assert parse_result.specs
    by_name = {spec.name: spec for spec in parse_result.specs}
    assert by_name["寬度"].target == pytest.approx(150.5)
    thickness = by_name["厚度"]
    assert thickness.target == pytest.approx(4.0)
    assert thickness.effective_plus == pytest.approx(0.1)
    assert thickness.effective_minus == pytest.approx(0.05)


def test_dxf_parsing_extracts_dimensions_and_tamper(parsed) -> None:
    assert parsed.title == "AL-992 HEAT SINK PROFILE"
    assert parsed.unit == "mm"
    assert parsed.dimension_count == 5
    assert parsed.measurement_count == 9
    by_label = {measurement.label: measurement for measurement in parsed.measurements if measurement.label}
    assert by_label["W"].value == pytest.approx(150.5)
    assert by_label["H"].value == pytest.approx(90.0)
    assert by_label["P"].value == pytest.approx(90.0)
    assert by_label["DIA"].value == pytest.approx(12.5)
    thickness = by_label["T"]
    assert thickness.value == pytest.approx(3.8)
    assert thickness.text_override == "T=4.00"
    assert thickness.text_value == pytest.approx(4.0)
    assert thickness.text_tampered is True


def test_matcher_statuses_tamper_and_stats(results) -> None:
    by_id = {result.spec.id: result for result in results}
    assert by_id["S001"].status == STATUS_PASS
    assert by_id["S002"].status == STATUS_PASS
    assert by_id["S003"].status == STATUS_FAIL
    assert by_id["S003"].tamper is True
    assert by_id["S004"].status == STATUS_PASS
    assert by_id["S005"].status == STATUS_PASS
    assert by_id["S006"].status == STATUS_MISSING

    stats = build_stats(results)
    assert stats["total"] == 6
    assert stats["pass"] == 4
    assert stats["fail"] == 1
    assert stats["missing"] == 1
    assert stats["tamper_count"] == 1
    assert stats["pass_rate"] == pytest.approx(66.7)


def test_vision_detects_shifted_hole(payload: dict[str, bytes]) -> None:
    actual_geometry = render_geometry(payload["actual_dxf"], "demo_actual.dxf")
    comparison = compare_images(actual_geometry, payload["reference_png"])
    assert comparison.status == STATUS_FAIL
    assert comparison.centroid_shift > 0.03
    assert comparison.image_png
    assert "質心偏移" in comparison.message


def test_vision_identical_images_pass(payload: dict[str, bytes]) -> None:
    comparison = compare_images(payload["reference_png"], payload["reference_png"])
    assert comparison.status == STATUS_PASS
    assert comparison.score == pytest.approx(100.0)
    assert comparison.overlap == pytest.approx(1.0)


def test_report_exports(parsed, specs, results, payload: dict[str, bytes]) -> None:
    vision = compare_images(
        render_geometry(payload["actual_dxf"], "demo_actual.dxf"),
        payload["reference_png"],
    )
    report = create_report(
        parsed,
        specs,
        results,
        spec_filename="demo_specs.csv",
        vision=vision,
        annotated_png=b"fake-png",
        vision_png=vision.image_png,
    )
    html_report = report_to_html(report)
    assert "ALU-CHECK" in html_report
    assert "demo_actual.dxf" in html_report

    csv_report = report_to_csv(report)
    assert "S003" in csv_report
    assert "超差" in csv_report

    data = json.loads(report_to_json(report))
    assert data["filename"] == "demo_actual.dxf"
    assert data["stats"]["pass"] == 4
    assert data["vision"]["status"] == STATUS_FAIL
