import { makeDemoReading } from '../src/demo.js';

const baseUrl = (process.argv[2] || 'http://localhost:8787').replace(/\/$/, '');
const count = Number.parseInt(process.argv[3] ?? '20', 10);

if (!Number.isFinite(count) || count < 1 || count > 500) {
  console.error('usage: node scripts/seed.mjs [baseUrl] [1-500]');
  process.exit(1);
}

let accepted = 0;

for (let i = 0; i < count; i += 1) {
  const reading = makeDemoReading(new Date(Date.now() - (count - i) * 1000));
  const response = await fetch(`${baseUrl}/api/telemetry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(reading),
  });

  if (!response.ok) {
    console.error(`request ${i + 1} failed: ${response.status} ${await response.text()}`);
    process.exit(1);
  }

  accepted += 1;
}

console.log(`seeded ${accepted} readings into ${baseUrl}`);
