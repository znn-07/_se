const COLUMNS = ['device', 'region', 'station', 'metric', 'value', 'unit', 'timestamp', 'receivedAt'];

export function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[=+@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function toCsv(readings) {
  const lines = [COLUMNS.join(',')];
  for (const reading of readings) {
    lines.push(COLUMNS.map((column) => csvCell(reading[column])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
