use crate::error::AppError;
use chrono::NaiveDate;

pub const BOARD_NAME_MAX: usize = 60;
pub const COLUMN_TITLE_MAX: usize = 40;
pub const TASK_TITLE_MAX: usize = 120;
pub const TASK_DESCRIPTION_MAX: usize = 2000;
pub const TASK_LABEL_MAX: usize = 24;
pub const TASK_LABELS_MAX: usize = 8;

pub fn required_text(value: &str, field_name: &str, max_chars: usize) -> Result<String, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::bad_request(format!("{field_name}不能是空白")));
    }
    if trimmed.chars().count() > max_chars {
        return Err(AppError::bad_request(format!(
            "{field_name}不可超過 {max_chars} 個字元"
        )));
    }
    Ok(trimmed.to_string())
}

pub fn optional_text(
    value: Option<&str>,
    field_name: &str,
    max_chars: usize,
) -> Result<String, AppError> {
    let value = value.unwrap_or_default().trim();
    if value.chars().count() > max_chars {
        return Err(AppError::bad_request(format!(
            "{field_name}不可超過 {max_chars} 個字元"
        )));
    }
    Ok(value.to_string())
}

pub fn priority(value: Option<&str>) -> Result<String, AppError> {
    let value = value.unwrap_or("medium").trim().to_lowercase();
    match value.as_str() {
        "low" | "medium" | "high" => Ok(value),
        _ => Err(AppError::bad_request("優先順序必須是 low、medium 或 high")),
    }
}

pub fn due_date(value: Option<&str>) -> Result<Option<String>, AppError> {
    let value = value.unwrap_or_default().trim();
    if value.is_empty() {
        return Ok(None);
    }

    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| AppError::bad_request("截止日期必須是 YYYY-MM-DD 格式"))?;
    Ok(Some(value.to_string()))
}

pub fn labels(values: Option<&[String]>) -> Result<Vec<String>, AppError> {
    let mut labels: Vec<String> = Vec::new();

    for value in values.unwrap_or_default() {
        let label = value.trim();
        if label.is_empty() {
            continue;
        }
        if label.chars().count() > TASK_LABEL_MAX {
            return Err(AppError::bad_request(format!(
                "標籤不可超過 {TASK_LABEL_MAX} 個字元"
            )));
        }
        if !labels
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(label))
        {
            labels.push(label.to_string());
        }
    }

    if labels.len() > TASK_LABELS_MAX {
        return Err(AppError::bad_request(format!(
            "任務最多只能有 {TASK_LABELS_MAX} 個標籤"
        )));
    }

    Ok(labels)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_and_accepts_valid_board_names() {
        assert_eq!(
            required_text("  產品衝刺  ", "看板名稱", BOARD_NAME_MAX).unwrap(),
            "產品衝刺"
        );
    }

    #[test]
    fn rejects_blank_or_too_long_board_names() {
        assert!(required_text("   ", "看板名稱", BOARD_NAME_MAX).is_err());
        assert!(
            required_text(&"字".repeat(BOARD_NAME_MAX + 1), "看板名稱", BOARD_NAME_MAX).is_err()
        );
    }

    #[test]
    fn priority_defaults_to_medium_and_rejects_unknown_values() {
        assert_eq!(priority(None).unwrap(), "medium");
        assert_eq!(priority(Some(" HIGH ")).unwrap(), "high");
        assert!(priority(Some("urgent")).is_err());
    }

    #[test]
    fn due_date_allows_empty_value_and_validates_format() {
        assert_eq!(due_date(None).unwrap(), None);
        assert_eq!(due_date(Some("   ")).unwrap(), None);
        assert_eq!(
            due_date(Some("2026-12-31")).unwrap(),
            Some("2026-12-31".to_string())
        );
        assert!(due_date(Some("2026-02-30")).is_err());
        assert!(due_date(Some("31/12/2026")).is_err());
    }

    #[test]
    fn labels_are_trimmed_deduplicated_and_limited() {
        assert_eq!(
            labels(Some(&[
                " Bug ".to_string(),
                "bug".to_string(),
                "".to_string(),
                "Design".to_string()
            ]))
            .unwrap(),
            vec!["Bug", "Design"]
        );
        assert!(labels(Some(&["x".repeat(TASK_LABEL_MAX + 1)])).is_err());
        assert!(labels(Some(
            &(0..=TASK_LABELS_MAX)
                .map(|index| format!("label-{index}"))
                .collect::<Vec<_>>()
        ))
        .is_err());
    }

    #[test]
    fn optional_text_respects_character_limit() {
        assert_eq!(
            optional_text(Some("  說明  "), "描述", TASK_DESCRIPTION_MAX).unwrap(),
            "說明"
        );
        assert!(optional_text(
            Some(&"a".repeat(TASK_DESCRIPTION_MAX + 1)),
            "描述",
            TASK_DESCRIPTION_MAX
        )
        .is_err());
    }
}
