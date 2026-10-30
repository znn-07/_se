# ALU-CHECK · 鋁業 CAD 精密比對系統

ALU-CHECK 是一套以本機運算為主的 DXF 圖面檢查工具，針對鋁擠型、散熱片、板金與機構件，將 CAD 圖面中的實際幾何量測與客戶規格逐項比對。除了尺寸公差，系統也會檢查標註文字是否被手動覆寫，並用 OpenCV 疊圖找出孔位偏移、輪廓變形與比例差異。

## 核心能力

- DXF 解析：讀取 `DIMENSION`、`CIRCLE`、`ARC`、`LINE` 等圖元，支援 mm / cm / m / inch 單位換算。
- 規格匯入：CSV、TSV、XLSX、JSON、PDF、TXT、Markdown。
- 尺寸配對：名稱、別名、尺寸類型、數值與 CAD Handle 加權配對，避免重複佔用同一量測。
- 公差判定：支援 `±0.05`、`+0.10/-0.05`、`0.05`、上下限與範圍。
- 文字竄改檢查：比對 DXF 幾何值與標註覆寫文字；例如實際厚度 3.80 mm、文字卻寫 `T=4.00`。
- 視覺比對：將 CAD 幾何渲染為乾淨線稿，與理想參考圖做輪廓形狀、面積、質心與重疊率比較。
- 報告輸出：互動式 Streamlit 儀表板、HTML、CSV、JSON，以及批次摘要。
- 本機優先：圖面與規格預設不離開本機；Ollama 規格抽取為選用功能。

## 快速開始

建議使用 Python 3.11 以上；本專案已在 Python 3.14 驗證。

```powershell
cd C:\Users\user\Desktop\_se\_se\07
python -m pip install -r requirements.txt
streamlit run app.py
```

```
python -m streamlit run app.py
```

開啟瀏覽器後，左側點擊「載入示範案例」即可看到完整流程。示範資料包含：

- `examples/demo_actual.dxf`：實際圖面，厚度幾何 3.80 mm，但文字被覆寫成 `T=4.00`。
- `examples/demo_ideal.dxf`：理想幾何，其中一孔位置與實際圖不同。
- `examples/demo_specs.csv`：客戶規格，包含一個未標註的角度項目。
- `examples/demo_reference.png`：由理想 DXF 產生的參考線稿。

也可以重新產生示範檔：

```powershell
python scripts\make_demo.py
```

## 批次命令列

無需啟動 Streamlit，直接對資料夾內所有 DXF 執行尺寸比對：

```powershell
python scripts\batch_check.py examples --spec examples\demo_specs.csv --out reports --html
```

輸出內容：

- `reports/*_report.csv`
- `reports/*_report.json`
- `reports/*_report.html`（加上 `--html`）
- `reports/batch_summary.csv`

## 規格檔格式

CSV / XLSX 最小可用欄位為 `name` 與 `target`，其餘欄位可省略。

| 欄位 | 說明 | 範例 |
| --- | --- | --- |
| `id` | 規格編號 | `S001` |
| `name` | 規格名稱 | `寬度` |
| `target` | 目標值 | `150.5` |
| `tolerance` | 公差 | `0.05`、`±0.05`、`+0.10/-0.05` |
| `unit` | 單位 | `mm`、`deg` |
| `aliases` | 別名，逗號分隔 | `width,W,總寬` |
| `cad_handle` | 指定 DXF 圖元 Handle | `92` |
| `note` | 備註 | `板件總寬` |

也支援中文欄名，例如 `規格名稱`、`目標值`、`公差`、`單位`、`別名`、`圖元`。

純文字規格可使用：

```text
寬度 150.5 ±0.05 mm
厚度 4.0 +0.10/-0.05
孔徑 Ø12.5 ±0.02
```

## 比對邏輯

1. 解析 DXF 圖元，取得實際數值、圖元類型、圖層、位置與標註文字。
2. 優先採用規格指定的 CAD Handle。
3. 其餘規格建立候選清單，依名稱／別名、類型、數值接近度評分。
4. 使用全域貪婪配對，確保一個 CAD 量測只會被一項規格使用。
5. 依規格單位換算後檢查上下公差。
6. 若標註文字與幾何值不一致，標記為文字異常並要求人工複核。
7. 幾何比對會先移除文字與標註，再將實際線稿與參考圖正規化後比較輪廓。

## 專案結構

```text
07/
  app.py                     Streamlit 工作台
  alucheck/
    cad_parser.py            DXF 解析、快取、文字竄改檢查
    matcher.py               規格配對、公差判定、統計
    models.py                共用資料模型
    render.py                CAD 標註圖與乾淨線稿渲染
    report.py                HTML / CSV / JSON 報告
    sample_data.py           示範 DXF、規格、參考圖
    specs.py                 多格式規格解析與 Ollama 選用抽取
    ui_theme.py              深色工業風介面樣式
    utils.py                 數值、單位、公差與格式化工具
    vision.py                OpenCV 輪廓比對與差異疊圖
  examples/                  示範資料
  scripts/                   示範產生器與批次 CLI
  tests/                     pytest 測試
  docs/                      架構與限制說明
```

## 測試

```powershell
python -m pytest -q
```

目前測試涵蓋：

- 公差與單位解析
- CSV 與純文字規格解析
- DXF 尺寸抽取與文字竄改偵測
- 規格配對、缺漏與統計
- OpenCV 位移孔偵測與相同影像比對
- HTML / CSV / JSON 報告輸出

## 已知限制

- 掃描式 PDF 不會自動 OCR；目前 PDF 依賴可抽取的文字層。
- 圖塊內的尺寸標註會提示人工檢查，尚未展開為獨立量測。
- 視覺比對要求參考圖與 CAD 線稿的視角、方向與比例大致一致。
- 文字異常代表「幾何與標註文字不一致」，不直接推斷為惡意竄改。
- GD&T 幾何公差、表面粗糙度與材料規格尚未語意化判定。
- DXF 3D 實體與複雜剖面目前以 2D 投影幾何為主。

## 後續方向

- 圖塊尺寸展開與多視圖自動分區。
- OCR 掃描 PDF 與圖面標註辨識。
- GD&T 規則引擎與客戶格式報表模板。
- 與 ERP / MES 的料號與檢驗紀錄整合。
- 多張圖面的基準特徵對齊與統計製程分析。
