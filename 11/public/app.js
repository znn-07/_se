const $ = (id) => document.getElementById(id);

const state = {
  data: null,
  seriesKey: '',
  live: true,
  busy: false,
  clockTimer: null,
  pollTimer: null,
};

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

const THEME_KEY = 'telemetry-hub-theme';

function keyOf(device, metric) {
  return `${device}::${metric}`;
}

function currentSeries() {
  return (state.data?.stats ?? []).find((item) => keyOf(item.device, item.metric) === state.seriesKey);
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
    threshold: read('--chart-threshold', 'rgba(255, 107, 107, .6)'),
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
    drawChart(currentSeries());
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

function renderChips(stats) {
  const signature = stats.map((item) => keyOf(item.device, item.metric)).join('|');
  if (signature === state.chipSignature) return;

  state.chipSignature = signature;
  const container = $('seriesChips');
  container.replaceChildren();

  for (const item of stats) {
    const key = keyOf(item.device, item.metric);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = `${item.device} · ${item.metric}`;
    chip.dataset.key = key;
    chip.setAttribute('aria-pressed', 'false');
    chip.addEventListener('click', () => {
      state.seriesKey = key;
      render();
    });
    container.append(chip);
  }
}

function renderReadouts(series) {
  $('roLatest').textContent = series ? fmt(series.latest) : '--';
  $('roMin').textContent = series ? fmt(series.min) : '--';
  $('roMax').textContent = series ? fmt(series.max) : '--';
  $('roAvg').textContent = series ? fmt(series.avg, 2) : '--';
  $('roCount').textContent = series ? series.count : '--';
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
        <span>${escapeHtml(alert.device)} / ${escapeHtml(alert.metric)}</span>
        <span>VALUE <b>${fmt(alert.value)} ${escapeHtml(alert.unit)}</b></span>
        <span>LIMIT ${alert.operator} ${fmt(alert.threshold)}</span>
        <span>${parts ? parts.time : '--:--'} UTC</span>
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
      <time>${parts ? parts.time : '--:--'}</time>
      <b><em>${escapeHtml(reading.device)}</em> / ${escapeHtml(reading.metric)}</b>
      <span>${fmt(reading.value)} ${escapeHtml(reading.unit)}</span>`;
    container.append(row);
  }
}

function renderTable(stats, alerts) {
  const body = $('deviceRows');
  body.replaceChildren();

  for (const item of stats) {
    const alert = alerts.find((entry) => entry.device === item.device && entry.metric === item.metric);
    const span = item.max - item.min;
    const percent = span > 0 ? Math.min(100, Math.max(0, ((item.latest - item.min) / span) * 100)) : 100;
    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="cell-device">${escapeHtml(item.device)}</td>
      <td class="cell-metric">${escapeHtml(item.metric)}</td>
      <td>${fmt(item.latest)} ${escapeHtml(item.unit)}</td>
      <td>
        <span class="range-cell">
          <span>${fmt(item.min)}</span>
          <span class="range-track"><i style="width:${percent}%"></i></span>
          <span>${fmt(item.max)}</span>
        </span>
      </td>
      <td>${fmt(item.avg, 2)}</td>
      <td>${item.count}</td>
      <td><span class="status-pill-table ${alert ? 'is-alert' : ''}">${alert ? 'ALERT' : 'NORMAL'}</span></td>`;
    body.append(row);
  }
}

function drawChart(series) {
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

  const points = state.data?.recent
    .filter((item) => keyOf(item.device, item.metric) === state.seriesKey)
    .slice(0, 40)
    .reverse() ?? [];

  if (points.length === 0) {
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

  const values = points.map((item) => item.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const padding = (max - min) * 0.18;
  min -= padding;
  max += padding;

  const plotLeft = 12;
  const plotRight = width - 40;
  const plotTop = 18;
  const plotBottom = height - 26;
  const xOf = (index) => plotLeft + (index / Math.max(1, points.length - 1)) * (plotRight - plotLeft);
  const yOf = (value) => plotBottom - ((value - min) / (max - min)) * (plotBottom - plotTop);

  const alert = state.data?.alerts?.find((entry) => keyOf(entry.device, entry.metric) === state.seriesKey);
  if (alert) {
    const y = yOf(alert.threshold);
    ctx.strokeStyle = colors.threshold;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(plotRight, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = colors.threshold;
    ctx.font = '9px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`LIMIT ${fmt(alert.threshold)}`, plotRight, y - 6);
  }

  const gradient = ctx.createLinearGradient(0, plotTop, 0, plotBottom);
  gradient.addColorStop(0, colors.fillTop);
  gradient.addColorStop(1, colors.fillBottom);

  ctx.beginPath();
  ctx.moveTo(xOf(0), plotBottom);
  points.forEach((item, index) => ctx.lineTo(xOf(index), yOf(item.value)));
  ctx.lineTo(xOf(points.length - 1), plotBottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  points.forEach((item, index) => {
    const x = xOf(index);
    const y = yOf(item.value);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 2;
  ctx.shadowColor = colors.line;
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.shadowBlur = 0;

  points.forEach((item, index) => {
    ctx.beginPath();
    ctx.arc(xOf(index), yOf(item.value), index === points.length - 1 ? 3.5 : 2, 0, Math.PI * 2);
    ctx.fillStyle = index === points.length - 1 ? colors.last : colors.point;
    ctx.fill();
  });

  ctx.fillStyle = colors.axis;
  ctx.font = '9px "IBM Plex Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(fmt(max), plotRight + 6, plotTop + 4);
  ctx.fillText(fmt(min), plotRight + 6, plotBottom + 3);
  ctx.fillText(utcParts(points[0].timestamp)?.time ?? '', plotLeft, height - 6);
  ctx.textAlign = 'right';
  ctx.fillText(utcParts(points[points.length - 1].timestamp)?.time ?? '', plotRight, height - 6);
}

function render() {
  const data = state.data;
  if (!data) return;

  renderKpis(data);
  renderChips(data.stats ?? []);

  const chips = $('seriesChips').querySelectorAll('.chip');
  chips.forEach((chip) => {
    const active = chip.dataset.key === state.seriesKey;
    chip.classList.toggle('is-active', active);
    chip.setAttribute('aria-pressed', String(active));
  });

  const series = currentSeries();
  renderReadouts(series);
  renderAlerts(data.alerts ?? []);
  renderFeed(data.recent ?? []);
  renderTable(data.stats ?? [], data.alerts ?? []);
  drawChart(series);
}

async function refresh(announce = false) {
  if (state.busy) return;
  state.busy = true;

  try {
    const response = await fetch('/api/summary', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data.ok) throw new Error(data.message || 'API 回傳失敗');

    state.data = data;
    if (!state.seriesKey || !(data.stats ?? []).some((item) => keyOf(item.device, item.metric) === state.seriesKey)) {
      state.seriesKey = data.stats?.[0] ? keyOf(data.stats[0].device, data.stats[0].metric) : '';
      state.chipSignature = '';
    }

    render();
    clearError();
    if (announce) showToast('資料已更新');
  } catch (error) {
    showError(`無法取得遙測資料：${error.message}`);
  } finally {
    state.busy = false;
  }
}

async function post(path, options = {}) {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body.message || `HTTP ${response.status}`);
  return body;
}

async function inject() {
  try {
    const result = await post('/api/demo', { method: 'POST' });
    showToast(`已注入 ${result.reading.device} / ${result.reading.metric} = ${fmt(result.reading.value)}`);
    await refresh();
  } catch (error) {
    showToast(`注入失敗：${error.message}`, true);
  }
}

async function loadCwa() {
  try {
    const result = await post('/api/import/cwa', { method: 'POST' });
    showToast(`已載入 ${result.accepted} 筆中央氣象署觀測資料`);
    await refresh();
  } catch (error) {
    showToast(`載入失敗：${error.message}`, true);
  }
}

async function reset() {
  if (!window.confirm('確定要清空所有遙測紀錄嗎？')) return;
  try {
    await post('/api/readings', { method: 'DELETE' });
    state.data = null;
    state.seriesKey = '';
    state.chipSignature = '';
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
  $('injectBtn').addEventListener('click', inject);
  $('cwaBtn').addEventListener('click', loadCwa);
  $('resetBtn').addEventListener('click', reset);
  $('refreshBtn').addEventListener('click', () => refresh(true));
  $('pauseBtn').addEventListener('click', toggleLive);
  window.addEventListener('resize', () => drawChart(currentSeries()));

  initTheme();
  startClock();
  refresh();
  state.pollTimer = setInterval(() => refresh(), 3000);
}

init();
