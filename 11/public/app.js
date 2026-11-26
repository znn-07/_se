const $ = (id) => document.getElementById(id);

const ALL_METRIC = 'all';
const METRIC_ORDER = ['temperature', 'humidity', 'voltage', 'signal'];
const COUNTIES = [
  '臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市',
  '基隆市', '新竹市', '嘉義市',
  '新竹縣', '苗栗縣', '彰化縣', '南投縣', '雲林縣', '嘉義縣',
  '屏東縣', '宜蘭縣', '花蓮縣', '臺東縣', '澎湖縣', '金門縣', '連江縣',
];
const PAGE_SIZE = 10;
const MULTI_COLORS = {
  temperature: '#ffb454',
  humidity: '#5ce1d6',
  voltage: '#a78bfa',
  signal: '#ff8fa3',
};
const GAUGE_RANGES = {
  temperature: { min: 0, max: 40 },
  humidity: { min: 0, max: 100 },
  voltage: { min: 3.0, max: 4.2 },
  signal: { min: -110, max: -40 },
};
const GAUGE_TONES = {
  cold: { color: '#38bdf8', soft: 'rgba(56, 189, 248, .28)' },
  green: { color: '#34d399', soft: 'rgba(52, 211, 153, .28)' },
  warm: { color: '#fb923c', soft: 'rgba(251, 146, 60, .30)' },
  yellow: { color: '#fbbf24', soft: 'rgba(251, 191, 36, .30)' },
  red: { color: '#fb7185', soft: 'rgba(251, 113, 133, .32)' },
};
const GAUGE_THRESHOLDS = {
  humidity: { value: 70, margin: 10, high: true },
  voltage: { value: 11.5, margin: 0.5, high: false },
  signal: { value: -80, margin: 10, high: false },
};

const state = {
  data: null,
  metric: ALL_METRIC,
  tableSearch: '',
  tableCounty: '',
  tablePage: 1,
  autoSelectStation: true,
  series: [],
  seriesDevice: '',
  live: true,
  busy: false,
  clockTimer: null,
  pollTimer: null,
};

function selectedRegion() {
  return $('countySelect').value;
}

function selectedDevice() {
  return $('stationSelect').value;
}

function metricOf(button) {
  return button === 'rssi' ? 'signal' : button;
}

function buttonOf(metric) {
  return metric === 'signal' ? 'rssi' : metric;
}

function gaugePercent(value, range) {
  const percent = ((value - range.min) / (range.max - range.min)) * 100;
  return Math.min(100, Math.max(0, percent));
}

function gaugeTone(metric, value) {
  if (metric === 'temperature') {
    if (value < 18) return GAUGE_TONES.cold;
    if (value > 28) return GAUGE_TONES.warm;
    return GAUGE_TONES.green;
  }

  const rule = GAUGE_THRESHOLDS[metric];
  if (!rule) return GAUGE_TONES.green;
  if (rule.high) {
    if (value > rule.value) return GAUGE_TONES.red;
    if (value > rule.value - rule.margin) return GAUGE_TONES.yellow;
  } else {
    if (value < rule.value) return GAUGE_TONES.red;
    if (value < rule.value + rule.margin) return GAUGE_TONES.yellow;
  }
  return GAUGE_TONES.green;
}

function scopedStats() {
  const region = selectedRegion();
  const device = selectedDevice();
  return (state.data?.stats ?? []).filter((item) =>
    (!region || item.region === region) && (!device || item.device === device));
}

function syncExportLink() {
  $('exportBtn').href = `/api/export?format=csv&region=${encodeURIComponent(selectedRegion())}`;
}

function populateCountySelects() {
  for (const id of ['countySelect', 'tableCounty']) {
    const select = $(id);
    select.replaceChildren(new Option('全部縣市', ''));
    for (const county of COUNTIES) select.add(new Option(county, county));
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function fmt(value, digits = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : '--';
}

function utcParts(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return {
    time: `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`,
    date: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`,
  };
}

function measurementDate(iso) {
  return utcParts(iso)?.date ?? '—';
}

const THEME_KEY = 'telemetry-hub-theme';

function keyOf(device, metric) {
  return `${device}::${metric}`;
}

function chartColors() {
  const style = getComputedStyle(document.documentElement);
  const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  return {
    grid: read('--chart-grid', 'rgba(92, 225, 214, .07)'),
    line: read('--chart-line', '#5ce1d6'),
    fillTop: read('--chart-fill-top', 'rgba(92, 225, 214, .26)'),
    fillBottom: read('--chart-fill-bottom', 'rgba(92, 225, 214, 0)'),
    point: read('--chart-point', '#5ce1d6'),
    last: read('--chart-last', '#ffb454'),
    secondary: read('--chart-secondary', '#a78bfa'),
    threshold: read('--chart-threshold', 'rgba(255, 107, 107, .6)'),
    anomaly: read('--chart-anomaly', '#ff6b6b'),
    axis: read('--chart-axis', 'rgba(120, 144, 158, .8)'),
  };
}

function storedTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

function applyTheme(theme) {
  const light = theme === 'light';
  document.documentElement.dataset.theme = theme;
  const button = $('themeBtn');
  const label = light ? '切換深色主題' : '切換淺色主題';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = light
    ? '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="4" stroke="currentColor" stroke-width="1.4"/><path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.5 1.5M14.5 14.5 16 16M16 4l-1.5 1.5M5.5 14.5 4 16" stroke="currentColor" stroke-width="1.4"/></svg>'
    : '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M15.5 12.5A6.5 6.5 0 0 1 7.5 4.5a6.5 6.5 0 1 0 8 8Z" stroke="currentColor" stroke-width="1.4"/></svg>';
}

function initTheme() {
  const stored = storedTheme();
  const preferred = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  applyTheme(stored === 'light' || stored === 'dark' ? stored : preferred);

  $('themeBtn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
    applyTheme(next);
    drawChart();
  });
}

function showToast(message, isError = false) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.toggle('is-error', isError);
  toast.classList.add('is-visible');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
}

function showError(message) {
  const banner = $('errorBanner');
  banner.textContent = `${message} · 請確認 D1 migration 已套用（npm run db:local / db:remote）`;
  banner.hidden = false;
  $('connectionPill').classList.add('is-error');
  $('connectionText').textContent = 'API 錯誤';
}

function clearError() {
  $('errorBanner').hidden = true;
  $('connectionPill').classList.remove('is-error');
  $('connectionText').textContent = state.live ? '即時連線' : '已暫停';
}

function renderKpis(data) {
  $('kpiTotal').textContent = data.total ?? 0;
  $('kpiDevices').textContent = data.devices ?? 0;
  $('kpiAlerts').textContent = data.alerts?.length ?? 0;

  const last = utcParts(data.lastSeen);
  $('kpiLast').textContent = last ? last.time : '--:--';
  $('kpiLastDate').textContent = last ? `${last.date} UTC` : '尚無資料';

  const latest = data.stats?.[0];
  $('heroValue').textContent = latest ? fmt(latest.latest) : '--.-';
  $('heroUnit').textContent = latest ? `${latest.metric.toUpperCase()} / ${latest.unit}` : 'NO SIGNAL';
}

function renderStationOptions() {
  const select = $('stationSelect');
  const current = select.value;
  const region = selectedRegion();
  const devices = new Map();

  for (const item of state.data?.stats ?? []) {
    if (region && item.region !== region) continue;
    const label = item.station && item.station !== item.device
      ? `${item.station} · ${item.device}`
      : (item.station || item.device);
    if (!devices.has(item.device)) devices.set(item.device, { label, metrics: new Set() });
    devices.get(item.device).metrics.add(item.metric);
  }

  const ordered = [...devices.entries()].sort((a, b) =>
    b[1].metrics.size - a[1].metrics.size || a[0].localeCompare(b[0]));

  select.replaceChildren(new Option('全部測站', ''));
  for (const [device, { label }] of ordered) select.add(new Option(label, device));

  const keepAll = current === '' && !state.autoSelectStation;
  select.value = keepAll ? '' : (ordered.find(([device]) => device === current)?.[0] ?? ordered[0]?.[0] ?? '');
  state.autoSelectStation = false;
}

function renderMetricButtons() {
  for (const button of $('metricSwitch').querySelectorAll('button[data-metric]')) {
    const active = button.dataset.metric === state.metric;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function renderReadouts(series) {
  const all = state.metric === ALL_METRIC;
  const samples = scopedStats().reduce((total, item) => total + (item.count ?? 0), 0);
  $('roLatest').textContent = all || !series ? '--' : fmt(series.latest);
  $('roMin').textContent = all || !series ? '--' : fmt(series.min);
  $('roMax').textContent = all || !series ? '--' : fmt(series.max);
  $('roAvg').textContent = all || !series ? '--' : fmt(series.avg, 2);
  $('roCount').textContent = all ? samples : (series ? series.count : '--');
}

function renderLegend() {
  const container = $('chartLegend');
  const all = state.metric === ALL_METRIC;
  container.hidden = !all;
  container.replaceChildren();
  if (!all) return;

  for (const metric of METRIC_ORDER) {
    const stat = scopedStats().find((item) => item.metric === metric);
    if (!stat) continue;
    const item = document.createElement('span');
    item.className = 'legend-item';
    item.innerHTML = `<i style="background:${MULTI_COLORS[metric]}"></i><b>${escapeHtml(metric)}</b><em>${fmt(stat.latest)} ${escapeHtml(stat.unit)}</em>`;
    container.append(item);
  }
}

function renderAlerts(alerts) {
  const container = $('alertList');
  $('alertBadge').textContent = alerts.length;
  container.replaceChildren();

  if (alerts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '<strong>ALL CLEAR</strong>目前沒有觸發中的告警門檻';
    container.append(empty);
    return;
  }

  for (const alert of alerts) {
    const item = document.createElement('div');
    item.className = 'alert-item';
    const parts = utcParts(alert.timestamp);
    item.innerHTML = `
      <span class="alert-item__title">${escapeHtml(alert.message)}</span>
      <span class="alert-item__tag">${escapeHtml(alert.id)}</span>
      <span class="alert-item__meta">
        <span>${alert.region ? `${escapeHtml(alert.region)}${alert.station ? ` · ${escapeHtml(alert.station)}` : ''} · ` : ''}${escapeHtml(alert.device)} / ${escapeHtml(alert.metric)}</span>
        <span>VALUE <b>${fmt(alert.value)} ${escapeHtml(alert.unit)}</b></span>
        <span>LIMIT ${alert.operator} ${fmt(alert.threshold)}</span>
        <span>${parts ? `${parts.date} ${parts.time}` : '--:--'} UTC</span>
      </span>`;
    container.append(item);
  }
}

function renderFeed(recent) {
  const container = $('feedList');
  container.replaceChildren();

  if (recent.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '<strong>NO PACKETS</strong>等待第一筆遙測資料';
    container.append(empty);
    return;
  }

  for (const reading of recent.slice(0, 8)) {
    const parts = utcParts(reading.timestamp);
    const row = document.createElement('div');
    row.className = 'feed-row';
    row.innerHTML = `
      <time>${parts ? `${parts.date} <em>${parts.time}</em>` : '--:--'}</time>
      <b><em>${escapeHtml(reading.station ? `${reading.region} · ${reading.station}` : `${reading.region ? `${reading.region} · ` : ''}${reading.device}`)}</em> / ${escapeHtml(reading.metric)}</b>
      <span>${fmt(reading.value)} ${escapeHtml(reading.unit)}</span>`;
    container.append(row);
  }
}

function focusSeries(item) {
  const countySelect = $('countySelect');
  const previousRegion = countySelect.value;
  const region = item.region && [...countySelect.options].some((option) => option.value === item.region)
    ? item.region
    : '';

  countySelect.value = region;
  syncExportLink();
  renderStationOptions();
  $('stationSelect').value = item.device;
  state.metric = buttonOf(item.metric);
  render();
  document.querySelector('.panel--trace').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (region !== previousRegion) refresh();
}

function renderTable(stats, alerts) {
  const body = $('deviceRows');
  body.replaceChildren();

  const query = state.tableSearch.trim().toLowerCase();
  const filtered = (stats ?? []).filter((item) => {
    const text = [item.region, item.station, item.metric, item.device].join(' ').toLowerCase();
    return (!query || text.includes(query)) && (!state.tableCounty || item.region === state.tableCounty);
  });
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  state.tablePage = Math.min(Math.max(state.tablePage, 1), pages);
  const pageItems = filtered.slice((state.tablePage - 1) * PAGE_SIZE, state.tablePage * PAGE_SIZE);

  $('tableCount').textContent = `${filtered.length} / ${stats?.length ?? 0} 筆`;

  for (const item of pageItems) {
    const alert = alerts.find((entry) => entry.device === item.device && entry.metric === item.metric);
    const range = GAUGE_RANGES[item.metric] ?? { min: item.min, max: item.max };
    const tone = gaugeTone(item.metric, item.latest);
    const bandLeft = gaugePercent(item.min, range);
    const bandWidth = Math.max(0, gaugePercent(item.max, range) - bandLeft);
    const dot = gaugePercent(item.latest, range);
    const gaugeStyle = [
      `--gauge-color:${tone.color}`,
      `--gauge-soft:${tone.soft}`,
      `--gauge-band-left:${bandLeft}%`,
      `--gauge-band-width:${bandWidth}%`,
      `--gauge-dot:${dot}%`,
    ].join(';');
    const row = document.createElement('tr');
    row.tabIndex = 0;
    row.title = '點擊查看此測站與指標的波形';
    row.innerHTML = `
      <td class="cell-device">${escapeHtml(item.device)}</td>
      <td class="cell-region">${escapeHtml(item.region || '—')}</td>
      <td class="cell-place">${escapeHtml(item.station || '—')}</td>
      <td class="cell-metric">${escapeHtml(item.metric)}</td>
      <td class="cell-date">${measurementDate(item.latestAt)}</td>
      <td>${fmt(item.latest)} ${escapeHtml(item.unit)}</td>
      <td>
        <span class="gauge-cell" style="${gaugeStyle}">
          <span class="gauge-meta"><span>${fmt(item.min)}</span><span>${fmt(item.max)}</span></span>
          <span class="gauge-track">
            <span class="gauge-band"${bandWidth > 0 ? '' : ' hidden'}></span>
            <span class="gauge-dot"></span>
          </span>
        </span>
      </td>
      <td>${fmt(item.avg, 2)}</td>
      <td>${item.count}</td>
      <td><span class="status-pill-table ${alert ? 'is-alert' : ''}">${alert ? 'ALERT' : 'NORMAL'}</span></td>`;
    row.addEventListener('click', () => focusSeries(item));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        focusSeries(item);
      }
    });
    body.append(row);
  }

  const pager = $('tablePagination');
  pager.replaceChildren();
  const info = document.createElement('span');
  info.textContent = `第 ${state.tablePage} / ${pages} 頁`;
  pager.append(info);

  for (const [label, page, disabled] of [
    ['上一頁', state.tablePage - 1, state.tablePage === 1],
    ['下一頁', state.tablePage + 1, state.tablePage === pages],
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'page-btn';
    button.dataset.page = String(page);
    button.textContent = label;
    button.disabled = disabled;
    pager.append(button);
  }
}

function drawChart() {
  const canvas = $('chart');
  const ctx = canvas.getContext('2d');
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const colors = chartColors();
  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 1;
  for (let i = 1; i < 6; i += 1) {
    const x = (width / 6) * i;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let i = 1; i < 5; i += 1) {
    const y = (height / 5) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  const scoped = scopedStats();
  const pointsFor = (device, metric) => {
    const source = state.seriesDevice === device ? state.series : (state.data?.recent ?? []);
    return source
      .filter((item) => item.device === device && item.metric === metric && Number.isFinite(Date.parse(item.timestamp)))
      .slice(0, 40)
      .reverse();
  };
  const alertFor = (item) => {
    if (!item) return null;
    const key = keyOf(item.device, item.metric);
    return state.data?.alerts?.find((entry) => keyOf(entry.device, entry.metric) === key)
      ?? state.data?.rules?.find((rule) => keyOf(rule.device, rule.metric) === key)
      ?? null;
  };
  const bounds = (points, threshold) => {
    const values = points.map((item) => item.value);
    if (Number.isFinite(threshold)) values.push(threshold);
    if (values.length === 0) return { min: 0, max: 1 };
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) { min -= 1; max += 1; }
    const padding = (max - min) * 0.18;
    return { min: min - padding, max: max + padding };
  };
  const violates = (value, alert) => {
    if (!alert) return false;
    if (alert.operator === '>') return value > alert.threshold;
    if (alert.operator === '>=') return value >= alert.threshold;
    if (alert.operator === '<') return value < alert.threshold;
    if (alert.operator === '<=') return value <= alert.threshold;
    return false;
  };

  const allMode = state.metric === ALL_METRIC;
  const primary = allMode ? null : (scoped.find((item) => item.metric === metricOf(state.metric)) ?? null);
  const paired = primary ? scoped.find((item) => {
    if (item.device !== primary.device || item.metric === primary.metric) return false;
    if (primary.metric === 'temperature') return item.metric === 'humidity';
    if (primary.metric === 'humidity') return item.metric === 'temperature';
    return true;
  }) ?? null : null;

  const selected = allMode
    ? METRIC_ORDER.map((metric) => scoped.find((item) => item.metric === metric)).filter(Boolean)
    : [primary, paired].filter(Boolean);
  const plotted = selected.map((item, index) => {
    const points = pointsFor(item.device, item.metric);
    const alert = alertFor(item);
    return {
      item,
      points,
      alert,
      range: bounds(points, alert?.threshold),
      stroke: allMode ? (MULTI_COLORS[item.metric] ?? colors.line) : (index === 0 ? colors.line : colors.secondary),
    };
  });
  const allPoints = plotted.flatMap((entry) => entry.points);

  if (allPoints.length === 0) {
    ctx.strokeStyle = colors.axis;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = colors.axis;
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('WAITING FOR SIGNAL', width / 2, height / 2 - 14);
    return;
  }

  const times = allPoints.map((item) => Date.parse(item.timestamp));
  const start = Math.min(...times);
  const end = Math.max(...times);
  const span = end - start || 1;

  const plotLeft = 46;
  const plotRight = width - 46;
  const plotTop = 32;
  const plotBottom = height - 28;
  const xOf = (iso) => plotLeft + ((Date.parse(iso) - start) / span) * (plotRight - plotLeft);
  const yOf = (value, range) => plotBottom - ((value - range.min) / (range.max - range.min)) * (plotBottom - plotTop);

  const drawLimit = (alert, range, align) => {
    if (!alert) return;
    const y = yOf(alert.threshold, range);
    ctx.strokeStyle = colors.threshold;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(plotRight, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = colors.threshold;
    ctx.font = '9px "IBM Plex Mono", monospace';
    ctx.textAlign = align;
    ctx.fillText(`LIMIT ${fmt(alert.threshold)}`, align === 'left' ? plotLeft : plotRight, y - 6);
  };
  if (!allMode) {
    if (plotted[0]) drawLimit(plotted[0].alert, plotted[0].range, 'right');
    if (plotted[1]) drawLimit(plotted[1].alert, plotted[1].range, 'left');
  }

  const drawLine = (points, range, stroke, alert, fill) => {
    if (!points.length) return;
    if (fill) {
      const gradient = ctx.createLinearGradient(0, plotTop, 0, plotBottom);
      gradient.addColorStop(0, fill[0]);
      gradient.addColorStop(1, fill[1]);
      ctx.beginPath();
      ctx.moveTo(xOf(points[0].timestamp), plotBottom);
      points.forEach((item) => ctx.lineTo(xOf(item.timestamp), yOf(item.value, range)));
      ctx.lineTo(xOf(points[points.length - 1].timestamp), plotBottom);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
    }
    ctx.beginPath();
    points.forEach((item, index) => {
      const x = xOf(item.timestamp);
      const y = yOf(item.value, range);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.shadowColor = stroke;
    ctx.shadowBlur = fill ? 12 : 0;
    ctx.stroke();
    ctx.shadowBlur = 0;
    points.forEach((item, index) => {
      const last = index === points.length - 1;
      const x = xOf(item.timestamp);
      const y = yOf(item.value, range);
      ctx.beginPath();
      ctx.arc(x, y, last ? 3.5 : 2, 0, Math.PI * 2);
      ctx.fillStyle = last ? colors.last : stroke;
      ctx.fill();
      if (violates(item.value, alert)) {
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.strokeStyle = colors.anomaly;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });
  };
  plotted.forEach((entry, index) => {
    const fill = !allMode && index === 0 ? [colors.fillTop, colors.fillBottom] : null;
    drawLine(entry.points, entry.range, entry.stroke, entry.alert, fill);
  });

  if (!allMode && plotted[0]) {
    const first = plotted[0];
    ctx.font = '9px "IBM Plex Mono", monospace';
    ctx.fillStyle = colors.line;
    ctx.textAlign = 'right';
    ctx.fillText(fmt(first.range.max), plotLeft - 6, plotTop + 4);
    ctx.fillText(fmt(first.range.min), plotLeft - 6, plotBottom + 3);
    ctx.textAlign = 'left';
    ctx.fillText(`${first.item.metric} ${first.item.unit}`, plotLeft, 14);

    if (plotted[1]) {
      const second = plotted[1];
      ctx.fillStyle = colors.secondary;
      ctx.textAlign = 'left';
      ctx.fillText(fmt(second.range.max), plotRight + 6, plotTop + 4);
      ctx.fillText(fmt(second.range.min), plotRight + 6, plotBottom + 3);
      ctx.textAlign = 'right';
      ctx.fillText(`${second.item.metric} ${second.item.unit}`, plotRight, 14);
    }
  }

  const axisTime = (ms) => {
    const parts = utcParts(new Date(ms).toISOString());
    return parts ? `${parts.date.slice(5)} ${parts.time}` : '';
  };
  ctx.fillStyle = colors.axis;
  ctx.font = '9px "IBM Plex Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(axisTime(start), plotLeft, height - 8);
  ctx.textAlign = 'center';
  ctx.fillText(axisTime(start + span / 2), (plotLeft + plotRight) / 2, height - 8);
  ctx.textAlign = 'right';
  ctx.fillText(axisTime(end), plotRight, height - 8);
}

function render() {
  const data = state.data;
  if (!data) return;

  renderKpis(data);
  renderStationOptions();
  if (selectedDevice() !== state.seriesDevice) loadSeries();
  renderMetricButtons();

  const scoped = scopedStats();
  const series = state.metric === ALL_METRIC
    ? null
    : (scoped.find((item) => item.metric === metricOf(state.metric)) ?? null);
  renderReadouts(series);
  renderLegend();
  renderAlerts(data.alerts ?? []);
  renderFeed(data.recent ?? []);
  renderTable(data.stats ?? [], data.alerts ?? []);
  drawChart();
}

async function refresh(announce = false) {
  if (state.busy) return;
  state.busy = true;

  try {
    const response = await fetch(`/api/summary?region=${encodeURIComponent(selectedRegion())}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data.ok) throw new Error(data.message || 'API 回傳失敗');

    state.data = data;
    render();
    clearError();
    if (announce) showToast('資料已更新');
  } catch (error) {
    showError(`無法取得遙測資料：${error.message}`);
  } finally {
    state.busy = false;
  }
}

async function loadSeries() {
  const device = selectedDevice();
  state.seriesDevice = device;
  if (!device) {
    state.series = [];
    return;
  }

  try {
    const response = await fetch(`/api/readings?device=${encodeURIComponent(device)}&limit=40`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (!body.ok) throw new Error(body.message || '序列讀取失敗');
    if (state.seriesDevice !== device) return;
    state.series = body.readings ?? [];
  } catch (error) {
    state.series = [];
  }
  render();
}

async function post(path, options = {}) {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body.message || `HTTP ${response.status}`);
  return body;
}

async function loadCwa() {
  const region = selectedRegion();
  try {
    const result = await post('/api/import/cwa', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ region }),
    });
    showToast(`已載入 ${region} ${result.accepted} 筆中央氣象署觀測資料`);
    await refresh();
  } catch (error) {
    showToast(`載入失敗：${error.message}`, true);
  }
}

async function injectSimulation() {
  const region = selectedRegion();
  try {
    const result = await post('/api/simulate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ region }),
    });
    showToast(`已寫入 ${result.accepted} 筆四項模擬讀數`);
    await refresh();
  } catch (error) {
    showToast(`注入失敗：${error.message}`, true);
  }
}

async function reset() {
  if (!window.confirm('確定要清空所有遙測紀錄嗎？')) return;
  try {
    await post('/api/readings', { method: 'DELETE' });
    state.data = null;
    state.metric = ALL_METRIC;
    state.tablePage = 1;
    state.series = [];
    state.seriesDevice = '';
    $('stationSelect').value = '';
    await refresh();
    showToast('已清空所有紀錄');
  } catch (error) {
    showToast(`清空失敗：${error.message}`, true);
  }
}

function toggleLive() {
  state.live = !state.live;
  $('pauseLabel').textContent = state.live ? '暫停即時更新' : '繼續即時更新';
  $('pauseBtn').setAttribute('aria-pressed', String(!state.live));
  clearInterval(state.pollTimer);
  if (state.live) {
    refresh();
    state.pollTimer = setInterval(() => refresh(), 3000);
  }
  clearError();
}

function startClock() {
  const tick = () => {
    const now = new Date();
    $('clock').innerHTML = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')} <em>UTC</em>`;
  };
  tick();
  state.clockTimer = setInterval(tick, 1000);
}

function init() {
  populateCountySelects();
  $('cwaBtn').addEventListener('click', loadCwa);
  $('simulateBtn').addEventListener('click', injectSimulation);
  $('resetBtn').addEventListener('click', reset);
  $('refreshBtn').addEventListener('click', () => refresh(true));
  $('pauseBtn').addEventListener('click', toggleLive);
  $('countySelect').addEventListener('change', () => {
    state.autoSelectStation = true;
    syncExportLink();
    refresh(true);
  });
  $('stationSelect').addEventListener('change', () => render());
  $('metricSwitch').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-metric]');
    if (!button) return;
    state.metric = button.dataset.metric;
    render();
  });
  $('tableSearch').addEventListener('input', (event) => {
    state.tableSearch = event.target.value;
    state.tablePage = 1;
    render();
  });
  $('tableCounty').addEventListener('change', (event) => {
    state.tableCounty = event.target.value;
    state.tablePage = 1;
    render();
  });
  $('tablePagination').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-page]');
    if (!button || button.disabled) return;
    state.tablePage = Number(button.dataset.page);
    render();
  });
  window.addEventListener('resize', () => drawChart());

  initTheme();
  syncExportLink();
  startClock();
  refresh();
  state.pollTimer = setInterval(() => refresh(), 3000);
}

init();
