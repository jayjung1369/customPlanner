import { mkdirSync, writeFileSync } from 'node:fs';

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token) throw new Error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in GitHub Actions secrets.');
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/d1/database`;
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(`Cloudflare request failed (${response.status}): ${JSON.stringify(body.errors)}`);
  return body.result;
}
const name = 'customplanner-schedule';
const databases = await api(`${endpoint}?name=${encodeURIComponent(name)}`);
const database = databases.find(db => db.name === name) ?? await api(endpoint, { method: 'POST', body: JSON.stringify({ name }) });
mkdirSync('dist', { recursive: true });
writeFileSync('dist/wrangler.json', JSON.stringify({
  name: 'customplanner', main: 'server/index.js', compatibility_date: '2026-11-09',
  workers_dev: true,
  d1_databases: [{ binding: 'DB', database_name: name, database_id: database.uuid, migrations_dir: '../drizzle' }],
}, null, 2));
