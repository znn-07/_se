# ALU-CHECK 架構說明

## 資料流

```text
DXF ──> cad_parser.parse_dxf_bytes ──> CADDocument
                                              │
客戶規格 ──> specs.load_specs_from_bytes ──> SpecItem[]
                                              │
                                              v
                                   matcher.compare_specs
                                              │
                         ┌────────────────────┼────────────────────┐
                         v                    v                    v
                  MatchResult[]         render_annotated      report.create_report
                         │                    │                    │
                         │                    v                    v
                         │              annotated_png       HTML / CSV / JSON
                         │
                         └──> vision.compare_images <── reference_png
                                      │
                                      v
                              VisionResult + overlay
```

## 模組責任

### `cad_parser.py`

- 以 `ezdxf` 讀取 DXF bytes 或檔案。
- 使用 SHA-256 與 `.cache` pickle 快取解析結果。
- 解析線性、角度、直徑、半徑、座標標註。
- 解析圓與圓弧，推導孔徑與位置。
- 讀取 DXF 單位、圖層、圖元統計、圖面範圍與標題。
- 比較幾何量測值與標註覆寫文字，產生 `text_tampered`。
- 圖塊內尺寸不展開，僅回報警示。

### `specs.py`

- 支援 CSV、TSV、XLSX、XLSM、JSON、PDF、TXT、Markdown。
- 使用欄位別名對應中英文表頭。
- 支援規則式文字抽取與可選 Ollama JSON 抽取。
- 建立 `SpecItem`，保留原始資料與來源。
- 非對稱公差保留 `tol_plus` / `tol_minus`，同時提供 `tolerance` 作為最大容許偏差。

### `matcher.py`

- 先處理明確的 `cad_handle` 指定。
- 為每項規格建立候選量測，依名稱、別名、類型與數值評分。
- 使用全域唯一配對，避免多項規格共用同一量測。
- 依單位換算後計算偏差、偏差百分比與公差判定。
- 若文字被覆寫且與幾何不一致，提升為需要複核的狀態並保留原因。
- 輸出可解釋的 `reasons` 與候選摘要，方便人工追查。

### `render.py`

- 使用 `ezdxf.addons.drawing` 與 matplotlib 產生深色標註圖。
- 將不合格、缺漏與文字異常結果標記在圖面上。
- 幾何比對模式會移除 `TEXT`、`MTEXT`、`DIMENSION`、`LEADER` 等標註，只留下輪廓線稿。
- 自動尋找常見中文字型；找不到時仍可渲染，但中文可能顯示為方框。

### `vision.py`

- 將輸入影像轉為線稿遮罩，自動判斷深色或淺色背景。
- 以內容邊界正規化到固定畫布，降低解析度與留白差異。
- 過濾過小輪廓，保留主要幾何特徵。
- 以形狀相似度、面積比、質心位移與成本函數進行唯一配對。
- 輸出 Pass / Fail、分數、指標與差異疊圖。
- 適合檢查孔位偏移、輪廓尺寸變化與整體比例差異。

### `report.py`

- 將文件摘要、規格結果、統計、視覺結果與警示整合為 `ComparisonReport`。
- HTML 報告包含內嵌圖片，適合直接寄送或存檔。
- CSV 適合匯入 Excel 或 ERP。
- JSON 保留完整結構，適合系統整合。

### `app.py`

- Streamlit 單頁工作台。
- 左側管理資料來源、快取與視覺門檻。
- 內建示範資料，無需準備檔案即可展示。
- 規格資料可即時編輯並重新套用。
- 批次頁面可一次檢查多張 DXF。
- 以輸入雜湊控制分析快取，避免每次 UI 互動都重新渲染。

## 判定狀態

| 狀態 | 意義 |
| --- | --- |
| `pass` | 實測值在公差內，且無文字異常 |
| `fail` | 實測值超出公差 |
| `missing` | 圖面找不到可對應的標註或幾何 |
| `warning` | 可配對但需要人工複核，例如文字覆寫 |
| `invalid` | 規格資料本身無法解析 |
| `error` | 解析或比對過程發生錯誤 |

## 設計取捨

- **本機優先**：避免將客戶圖面傳到外部服務；Ollama 為選用且可完全停用。
- **可解釋配對**：不只輸出合格與否，也保留候選與判定原因。
- **保守判定**：文字與幾何不一致時不直接判定合格，而是要求人工複核。
- **視覺輔助而非取代**：OpenCV 比對用於快速定位差異，最終仍應由工程人員確認。
- **快取換速度**：DXF 解析結果以檔案雜湊快取，適合重複開啟同一張圖。
