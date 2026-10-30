from __future__ import annotations

APP_CSS = """
<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Noto+Sans+TC:wght@400;500;700;900&display=swap');

:root {
    --ink: #edf4ff;
    --muted: #8da0b9;
    --faint: #62748c;
    --bg: #070b12;
    --panel: #0d1420;
    --panel-2: #111a29;
    --line: rgba(141, 160, 185, 0.18);
    --line-strong: rgba(141, 160, 185, 0.32);
    --cyan: #3dd9f5;
    --cyan-soft: rgba(61, 217, 245, 0.13);
    --amber: #f5b642;
    --green: #8ee36b;
    --red: #ff6b7a;
    --violet: #a993ff;
}

html, body, [class*="css"] {
    font-family: "Noto Sans TC", "Segoe UI", sans-serif;
}

.stApp {
    background:
        radial-gradient(1200px 800px at 85% -10%, rgba(61, 217, 245, 0.09), transparent 55%),
        radial-gradient(900px 600px at -10% 110%, rgba(169, 147, 255, 0.07), transparent 55%),
        linear-gradient(180deg, #070b12 0%, #080d16 100%);
    color: var(--ink);
}

[data-testid="stHeader"] {
    background: transparent;
}

[data-testid="stSidebar"] {
    background: linear-gradient(180deg, #0a111c 0%, #080d15 100%);
    border-right: 1px solid var(--line);
}

[data-testid="stSidebar"] [data-testid="stMarkdownContainer"] p {
    color: var(--muted);
}

.block-container {
    padding-top: 2.1rem;
    padding-bottom: 3rem;
    max-width: 1480px;
}

h1, h2, h3, h4 {
    font-family: "Noto Sans TC", "Segoe UI", sans-serif;
    letter-spacing: -0.02em;
}

p, li, label, span {
    color: var(--ink);
}

.mono {
    font-family: "IBM Plex Mono", ui-monospace, monospace;
}

.hero {
    position: relative;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 22px;
    padding: 28px 32px 26px;
    margin-bottom: 18px;
    background:
        linear-gradient(135deg, rgba(61, 217, 245, 0.08), transparent 38%),
        linear-gradient(180deg, rgba(255, 255, 255, 0.035), transparent 80%),
        #0b121d;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.30);
}

.hero::after {
    content: "";
    position: absolute;
    right: -100px;
    top: -120px;
    width: 360px;
    height: 360px;
    border: 1px solid rgba(61, 217, 245, 0.18);
    border-radius: 50%;
    box-shadow: 0 0 0 28px rgba(61, 217, 245, 0.035), 0 0 0 56px rgba(61, 217, 245, 0.02);
}

.hero .eyebrow {
    font-family: "IBM Plex Mono", monospace;
    color: var(--cyan);
    letter-spacing: 0.18em;
    font-size: 11px;
    text-transform: uppercase;
}

.hero h1 {
    margin: 10px 0 8px;
    font-size: clamp(30px, 4vw, 52px);
    line-height: 1.05;
    font-weight: 900;
    color: #f7fbff;
}

.hero h1 span {
    color: var(--cyan);
}

.hero p {
    margin: 0;
    max-width: 860px;
    color: var(--muted);
    font-size: 14px;
    line-height: 1.8;
}

.hero .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 18px;
}

.chip {
    font-family: "IBM Plex Mono", monospace;
    font-size: 10px;
    letter-spacing: 0.08em;
    color: var(--muted);
    border: 1px solid var(--line);
    background: rgba(255, 255, 255, 0.025);
    border-radius: 999px;
    padding: 5px 9px;
}

.panel {
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 18px 18px 16px;
    background: linear-gradient(180deg, rgba(255,255,255,0.025), transparent 70%), var(--panel);
}

.panel-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
}

.panel-title h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
}

.panel-title .hint {
    font-family: "IBM Plex Mono", monospace;
    font-size: 10px;
    color: var(--faint);
    letter-spacing: 0.06em;
}

.metric-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 10px;
    margin: 4px 0 18px;
}

@media (max-width: 900px) {
    .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

.metric {
    border: 1px solid var(--line);
    border-radius: 15px;
    padding: 14px 15px;
    background: linear-gradient(180deg, rgba(255,255,255,0.03), transparent), #0b121c;
    min-height: 104px;
}

.metric .label {
    color: var(--faint);
    font-family: "IBM Plex Mono", monospace;
    font-size: 10px;
    letter-spacing: 0.10em;
    text-transform: uppercase;
}

.metric .value {
    margin-top: 8px;
    font-family: "IBM Plex Mono", monospace;
    font-size: 28px;
    line-height: 1;
    font-weight: 600;
    color: var(--ink);
}

.metric .sub {
    margin-top: 8px;
    font-size: 11px;
    color: var(--muted);
}

.metric.good .value { color: var(--green); }
.metric.bad .value { color: var(--red); }
.metric.warn .value { color: var(--amber); }
.metric.info .value { color: var(--cyan); }

.status {
    display: inline-block;
    font-family: "IBM Plex Mono", monospace;
    font-size: 10px;
    letter-spacing: 0.08em;
    border-radius: 999px;
    padding: 3px 8px;
    border: 1px solid transparent;
    white-space: nowrap;
}

.status.good { color: var(--green); background: rgba(142,227,107,0.10); border-color: rgba(142,227,107,0.25); }
.status.bad { color: var(--red); background: rgba(255,107,122,0.10); border-color: rgba(255,107,122,0.25); }
.status.warn { color: var(--amber); background: rgba(245,182,66,0.10); border-color: rgba(245,182,66,0.25); }
.status.muted { color: var(--muted); background: rgba(141,160,185,0.08); border-color: rgba(141,160,185,0.20); }

table.audit {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
}

table.audit th {
    text-align: left;
    color: var(--faint);
    font-family: "IBM Plex Mono", monospace;
    font-size: 9px;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    padding: 8px 10px;
    border-bottom: 1px solid var(--line-strong);
    white-space: nowrap;
}

table.audit td {
    padding: 10px;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
}

table.audit tr.row--bad td { background: rgba(255, 107, 122, 0.035); }
table.audit tr.row--warn td { background: rgba(245, 182, 66, 0.035); }

table.audit .name { font-weight: 700; }
table.audit .muted { color: var(--muted); }
table.audit .mono { font-family: "IBM Plex Mono", monospace; }

.note {
    border-left: 2px solid var(--cyan);
    padding: 8px 12px;
    margin: 7px 0;
    color: var(--muted);
    background: rgba(61, 217, 245, 0.045);
    border-radius: 0 9px 9px 0;
    font-size: 12px;
    line-height: 1.65;
}

.note.bad { border-left-color: var(--red); background: rgba(255,107,122,0.045); }
.note.warn { border-left-color: var(--amber); background: rgba(245,182,66,0.045); }

.empty {
    border: 1px dashed var(--line-strong);
    border-radius: 18px;
    padding: 54px 28px;
    text-align: center;
    background: rgba(255, 255, 255, 0.015);
}

.empty .mark {
    font-family: "IBM Plex Mono", monospace;
    color: var(--cyan);
    font-size: 11px;
    letter-spacing: 0.2em;
}

.empty h3 {
    margin: 12px 0 6px;
    font-size: 22px;
}

.empty p {
    margin: 0 auto;
    max-width: 640px;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.8;
}

.stTabs [data-baseweb="tab-list"] {
    gap: 4px;
    border-bottom: 1px solid var(--line);
}

.stTabs [data-baseweb="tab"] {
    font-family: "IBM Plex Mono", monospace;
    font-size: 11px;
    letter-spacing: 0.08em;
    color: var(--muted);
    padding: 10px 14px;
}

.stTabs [aria-selected="true"] {
    color: var(--cyan) !important;
}

.stButton > button, .stDownloadButton > button {
    border-radius: 10px;
    border: 1px solid var(--line-strong);
    background: #101a29;
    color: var(--ink);
    font-weight: 600;
    transition: 120ms ease;
}

.stButton > button:hover, .stDownloadButton > button:hover {
    border-color: var(--cyan);
    color: var(--cyan);
    background: #0d1826;
}

.stButton > button[kind="primary"] {
    background: linear-gradient(135deg, #16a8c4, #128796);
    border-color: transparent;
    color: #041016;
}

[data-testid="stFileUploaderDropzone"] {
    background: rgba(255, 255, 255, 0.02);
    border: 1px dashed var(--line-strong);
    border-radius: 14px;
}

[data-testid="stMetric"] {
    background: #0b121c;
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 12px 14px;
}

[data-testid="stDataFrame"], [data-testid="stDataEditor"] {
    border: 1px solid var(--line);
    border-radius: 14px;
    overflow: hidden;
}

.sidebar-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
}

.sidebar-brand .logo {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    font-family: "IBM Plex Mono", monospace;
    font-weight: 700;
    color: #041016;
    background: linear-gradient(135deg, var(--cyan), #7ce9ff);
    box-shadow: 0 0 28px rgba(61, 217, 245, 0.25);
}

.sidebar-brand .name {
    font-weight: 800;
    line-height: 1.1;
}

.sidebar-brand .sub {
    font-family: "IBM Plex Mono", monospace;
    font-size: 9px;
    color: var(--faint);
    letter-spacing: 0.10em;
}

.sidebar-section {
    margin: 18px 0 6px;
    color: var(--faint);
    font-family: "IBM Plex Mono", monospace;
    font-size: 9px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
}

.footer {
    margin-top: 30px;
    padding-top: 16px;
    border-top: 1px solid var(--line);
    color: var(--faint);
    font-family: "IBM Plex Mono", monospace;
    font-size: 9px;
    letter-spacing: 0.06em;
    display: flex;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
}
</style>
"""
