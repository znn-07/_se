from __future__ import annotations

import cv2
import numpy as np

from .models import VisionResult, STATUS_FAIL, STATUS_PASS

CANVAS = 1200
DIFF_BG = (32, 18, 11)
REF_COLOR = (255, 212, 101)
CAD_COLOR = (66, 182, 245)
DIFF_COLOR = (92, 92, 255)
TEXT_COLOR = (230, 237, 247)
MUTED_COLOR = (163, 140, 125)


class VisionError(ValueError):
    pass


def _decode(data: bytes) -> np.ndarray:
    if not data:
        raise VisionError("影像資料為空。")
    array = np.frombuffer(data, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_UNCHANGED)
    if image is None:
        raise VisionError("無法解碼影像，請上傳 PNG 或 JPG。")
    return image


def _to_mask(image: np.ndarray) -> np.ndarray:
    if image.ndim == 3 and image.shape[2] == 4:
        alpha = image[:, :, 3]
        if int(alpha.min()) < 250:
            _, mask = cv2.threshold(alpha, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            return _clean_mask(mask)
        image = image[:, :, :3]

    if image.ndim == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    else:
        gray = image

    border = np.concatenate(
        [gray[0, :], gray[-1, :], gray[:, 0], gray[:, -1]]
    )
    background = float(np.median(border)) if border.size else 255.0
    if background < 128:
        _, mask = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    else:
        _, mask = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return _clean_mask(mask)


def _clean_mask(mask: np.ndarray) -> np.ndarray:
    if int(np.count_nonzero(mask)) == 0:
        return mask
    kernel = np.ones((3, 3), np.uint8)
    return cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=1)


def _normalize_mask(mask: np.ndarray, canvas: int = CANVAS) -> np.ndarray:
    points = cv2.findNonZero(mask)
    if points is None:
        raise VisionError("影像中找不到圖形內容。")
    x, y, width, height = cv2.boundingRect(points)
    if width < 2 or height < 2:
        raise VisionError("影像圖形太小，無法比對。")
    crop = mask[y : y + height, x : x + width]
    target = canvas * 0.88
    scale = min(target / float(width), target / float(height))
    new_width = max(2, int(round(width * scale)))
    new_height = max(2, int(round(height * scale)))
    resized = cv2.resize(crop, (new_width, new_height), interpolation=cv2.INTER_AREA)
    out = np.zeros((canvas, canvas), dtype=np.uint8)
    ox = (canvas - new_width) // 2
    oy = (canvas - new_height) // 2
    out[oy : oy + new_height, ox : ox + new_width] = resized
    return out


def _depths(contours: list[np.ndarray], hierarchy: np.ndarray) -> list[int]:
    depths = [0] * len(contours)
    if hierarchy is None:
        return depths
    parent = hierarchy[0][:, 3]
    for index in range(len(contours)):
        depth = 0
        current = int(parent[index])
        seen: set[int] = set()
        while current >= 0 and current not in seen:
            seen.add(current)
            depth += 1
            current = int(parent[current])
        depths[index] = depth
    return depths


def _significant_contours(mask: np.ndarray) -> list[np.ndarray]:
    contours, hierarchy = cv2.findContours(
        mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE
    )
    if not contours or hierarchy is None:
        return []
    depths = _depths(contours, hierarchy)
    total_area = float(mask.shape[0] * mask.shape[1])
    min_area = total_area * 0.00015
    fill_ratio = np.count_nonzero(mask) / total_area
    filled = fill_ratio > 0.30
    selected: list[np.ndarray] = []
    for index, contour in enumerate(contours):
        area = cv2.contourArea(contour)
        if area < min_area:
            continue
        depth = depths[index]
        if filled:
            if depth <= 1:
                selected.append(contour)
        elif depth % 2 == 0:
            selected.append(contour)
    selected.sort(key=cv2.contourArea, reverse=True)
    return selected


def _contour_stats(contour: np.ndarray) -> tuple[float, tuple[float, float]]:
    area = float(cv2.contourArea(contour))
    moments = cv2.moments(contour)
    if moments["m00"]:
        centroid = (
            moments["m10"] / moments["m00"],
            moments["m01"] / moments["m00"],
        )
    else:
        x, y, width, height = cv2.boundingRect(contour)
        centroid = (x + width / 2.0, y + height / 2.0)
    return area, centroid


def _pair_contours(
    cad_contours: list[np.ndarray],
    ref_contours: list[np.ndarray],
) -> list[dict[str, float]]:
    diagonal = float(np.hypot(CANVAS, CANVAS))
    pairs: list[dict[str, float]] = []
    for cad_index, cad_contour in enumerate(cad_contours):
        cad_area, cad_center = _contour_stats(cad_contour)
        for ref_index, ref_contour in enumerate(ref_contours):
            ref_area, ref_center = _contour_stats(ref_contour)
            shape = float(
                cv2.matchShapes(
                    cad_contour, ref_contour, cv2.CONTOURS_MATCH_I1, 0.0
                )
            )
            area_ratio = min(cad_area, ref_area) / max(cad_area, ref_area, 1.0)
            centroid = float(
                np.hypot(cad_center[0] - ref_center[0], cad_center[1] - ref_center[1])
                / diagonal
            )
            cost = centroid + shape * 0.55 + (1.0 - area_ratio) * 0.30
            pairs.append(
                {
                    "cad_index": float(cad_index),
                    "ref_index": float(ref_index),
                    "cost": cost,
                    "shape": shape,
                    "area_ratio": area_ratio,
                    "centroid": centroid,
                }
            )
    pairs.sort(key=lambda item: item["cost"])
    used_cad: set[int] = set()
    used_ref: set[int] = set()
    matched: list[dict[str, float]] = []
    for pair in pairs:
        cad_index = int(pair["cad_index"])
        ref_index = int(pair["ref_index"])
        if cad_index in used_cad or ref_index in used_ref:
            continue
        used_cad.add(cad_index)
        used_ref.add(ref_index)
        matched.append(pair)
    return matched


def _overlap_score(reference: np.ndarray, cad: np.ndarray) -> float:
    kernel = np.ones((5, 5), np.uint8)
    ref_d = cv2.dilate(reference, kernel, iterations=1) > 0
    cad_d = cv2.dilate(cad, kernel, iterations=1) > 0
    union = np.logical_or(ref_d, cad_d).sum()
    if union == 0:
        return 0.0
    intersection = np.logical_and(ref_d, cad_d).sum()
    return float(intersection) / float(union)


def _overlay(
    reference: np.ndarray,
    cad: np.ndarray,
    *,
    shape_diff: float,
    area_ratio: float,
    centroid_shift: float,
    overlap: float,
    status: str,
    contour_count: int,
) -> bytes:
    canvas = np.full((CANVAS, CANVAS, 3), DIFF_BG, dtype=np.uint8)
    ref_contours = cv2.findContours(
        reference, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE
    )[0]
    cad_contours = cv2.findContours(cad, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)[0]
    cv2.drawContours(canvas, ref_contours, -1, REF_COLOR, 2, cv2.LINE_AA)
    cv2.drawContours(canvas, cad_contours, -1, CAD_COLOR, 2, cv2.LINE_AA)

    kernel = np.ones((3, 3), np.uint8)
    ref_d = cv2.dilate(reference, kernel, iterations=1)
    cad_d = cv2.dilate(cad, kernel, iterations=1)
    difference = cv2.absdiff(ref_d, cad_d)
    difference = cv2.morphologyEx(difference, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    diff_contours = cv2.findContours(
        difference, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )[0]
    for contour in diff_contours:
        if cv2.contourArea(contour) < 80:
            continue
        x, y, width, height = cv2.boundingRect(contour)
        cv2.rectangle(
            canvas, (x - 4, y - 4), (x + width + 4, y + height + 4), DIFF_COLOR, 1
        )
    cv2.drawContours(canvas, diff_contours, -1, DIFF_COLOR, 1, cv2.LINE_AA)

    bar_height = 86
    bordered = np.full((CANVAS + bar_height, CANVAS, 3), (16, 22, 32), dtype=np.uint8)
    bordered[bar_height:, :, :] = canvas

    status_text = "PASS" if status == STATUS_PASS else "REVIEW"
    status_color = (151, 220, 61) if status == STATUS_PASS else (114, 92, 255)
    cv2.putText(
        bordered,
        "ALU-CHECK  GEOMETRY AUDIT",
        (28, 32),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.72,
        TEXT_COLOR,
        2,
        cv2.LINE_AA,
    )
    cv2.putText(
        bordered,
        status_text,
        (CANVAS - 170, 32),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.72,
        status_color,
        2,
        cv2.LINE_AA,
    )
    metrics = (
        f"SHAPE {shape_diff:.4f}    AREA {area_ratio * 100:.1f}%    "
        f"SHIFT {centroid_shift * 100:.2f}%    OVERLAP {overlap * 100:.1f}%    "
        f"CONTOURS {contour_count}"
    )
    cv2.putText(
        bordered,
        metrics,
        (28, 64),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.48,
        MUTED_COLOR,
        1,
        cv2.LINE_AA,
    )
    legend_y = bar_height + 28
    cv2.line(bordered, (28, legend_y), (62, legend_y), REF_COLOR, 2, cv2.LINE_AA)
    cv2.putText(
        bordered,
        "REFERENCE",
        (72, legend_y + 5),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.42,
        MUTED_COLOR,
        1,
        cv2.LINE_AA,
    )
    cv2.line(bordered, (188, legend_y), (222, legend_y), CAD_COLOR, 2, cv2.LINE_AA)
    cv2.putText(
        bordered,
        "CAD",
        (232, legend_y + 5),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.42,
        MUTED_COLOR,
        1,
        cv2.LINE_AA,
    )
    cv2.line(bordered, (300, legend_y), (334, legend_y), DIFF_COLOR, 2, cv2.LINE_AA)
    cv2.putText(
        bordered,
        "DIFFERENCE",
        (344, legend_y + 5),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.42,
        MUTED_COLOR,
        1,
        cv2.LINE_AA,
    )

    ok, encoded = cv2.imencode(".png", bordered)
    if not ok:
        raise VisionError("無法輸出比對影像。")
    return encoded.tobytes()


def compare_images(
    cad_image: bytes,
    reference_image: bytes,
    *,
    shape_threshold: float = 0.08,
    centroid_threshold: float = 0.015,
    area_threshold: float = 0.92,
    overlap_threshold: float = 0.75,
) -> VisionResult:
    try:
        cad_mask_raw = _to_mask(_decode(cad_image))
        ref_mask_raw = _to_mask(_decode(reference_image))
    except VisionError as exc:
        return VisionResult(status="error", message=str(exc))

    if int(np.count_nonzero(cad_mask_raw)) == 0:
        return VisionResult(status="error", message="CAD 渲染圖沒有可見線條。")
    if int(np.count_nonzero(ref_mask_raw)) == 0:
        return VisionResult(status="error", message="參考圖沒有可見線條。")

    try:
        cad_mask = _normalize_mask(cad_mask_raw)
        ref_mask = _normalize_mask(ref_mask_raw)
    except VisionError as exc:
        return VisionResult(status="error", message=str(exc))

    cad_contours = _significant_contours(cad_mask)
    ref_contours = _significant_contours(ref_mask)
    if not cad_contours or not ref_contours:
        return VisionResult(
            status="error",
            message="無法從影像中提取有效輪廓，請確認圖面線條清晰。",
        )

    pairs = _pair_contours(cad_contours, ref_contours)
    count = min(len(cad_contours), len(ref_contours))
    shape_values = [pair["shape"] for pair in pairs]
    area_values = [pair["area_ratio"] for pair in pairs]
    centroid_values = [pair["centroid"] for pair in pairs]

    shape_diff = float(np.mean(shape_values)) if shape_values else 1.0
    area_ratio = float(np.mean(area_values)) if area_values else 0.0
    centroid_shift = max(centroid_values) if centroid_values else 1.0
    overlap = _overlap_score(ref_mask, cad_mask)
    count_delta = abs(len(cad_contours) - len(ref_contours))
    count_limit = max(1, int(round(max(len(cad_contours), len(ref_contours)) * 0.10)))

    shape_ok = shape_diff <= shape_threshold
    area_ok = area_ratio >= area_threshold
    centroid_ok = centroid_shift <= centroid_threshold
    overlap_ok = overlap >= overlap_threshold
    count_ok = count_delta <= count_limit
    status = STATUS_PASS if all([shape_ok, area_ok, centroid_ok, overlap_ok, count_ok]) else STATUS_FAIL

    if status == STATUS_PASS:
        message = "幾何輪廓與參考圖一致。"
    else:
        issues = []
        if not shape_ok:
            issues.append(f"輪廓形狀差異 {shape_diff:.4f}")
        if not area_ok:
            issues.append(f"輪廓面積比 {area_ratio * 100:.1f}%")
        if not centroid_ok:
            issues.append(f"最大質心偏移 {centroid_shift * 100:.2f}%")
        if not overlap_ok:
            issues.append(f"線條重疊率 {overlap * 100:.1f}%")
        if not count_ok:
            issues.append(f"輪廓數量差異 {count_delta}")
        message = "幾何特徵異常：" + "、".join(issues) + "。"

    score = 100.0 * (
        0.42 * (1.0 - min(shape_diff / max(shape_threshold, 1e-6), 1.0))
        + 0.24 * min(area_ratio, 1.0)
        + 0.24 * (1.0 - min(centroid_shift / 0.05, 1.0))
        + 0.10 * min(overlap, 1.0)
    )
    if not count_ok:
        score *= 0.8

    try:
        overlay_png = _overlay(
            ref_mask,
            cad_mask,
            shape_diff=shape_diff,
            area_ratio=area_ratio,
            centroid_shift=centroid_shift,
            overlap=overlap,
            status=status,
            contour_count=count,
        )
    except Exception:
        overlay_png = None

    return VisionResult(
        status=status,
        score=round(score, 1),
        shape_diff=round(shape_diff, 6),
        area_ratio=round(area_ratio, 6),
        centroid_shift=round(centroid_shift, 6),
        overlap=round(overlap, 6),
        contour_count=count,
        message=message,
        image_png=overlay_png,
    )
