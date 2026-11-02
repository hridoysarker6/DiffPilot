import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadConfig, saveConfig } from './config.js';
import { Runner, RUNS_DIR } from './runner.js';
import { buildXlsx, counts } from './report.js';

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '127.0.0.1';

const app = express();
const runner = new Runner();
const clients = new Set();

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/runs', express.static(RUNS_DIR));

runner.on('event', (e) => {
  const data = `data: ${JSON.stringify(e)}\n\n`;
  for (const res of clients) res.write(data);
});

const publicConfig = (cfg) => ({ ...cfg, users: cfg.users.map(({ password, ...u }) => ({ ...u, hasPassword: !!password })) });

app.get('/api/config', (_req, res) => res.json(publicConfig(loadConfig())));

app.put('/api/config', (req, res) => {
  const old = loadConfig();
  const b = req.body || {};
  const users = (b.users || []).map((u) => {
    const prev = old.users.find((o) => o.email === u.email && o.role === u.role);
    return { role: String(u.role || '').trim(), email: String(u.email || '').trim(), password: u.password || prev?.password || '' };
  });
  const next = {
    ...old,
    legacy: { baseUrl: String(b.legacy?.baseUrl || '').trim().replace(/\/+$/, '') },
    new: { baseUrl: String(b.new?.baseUrl || '').trim().replace(/\/+$/, '') },
    login: { ...old.login, ...b.login },
    users,
    routes: Array.isArray(b.routes) ? b.routes.map(String).filter(Boolean) : old.routes,
    crawl: { maxPages: Number(b.crawl?.maxPages) || old.crawl.maxPages },
    ignore: { ...old.ignore, ...b.ignore },
    compare: { fieldKey: b.compare?.fieldKey === 'label' ? 'label' : 'name' },
    filters: {
      enabled: b.filters?.enabled !== false,
      maxOptions: Math.min(40, Number(b.filters?.maxOptions) || old.filters.maxOptions),
      maxControls: Math.min(10, Number(b.filters?.maxControls) || old.filters.maxControls),
      search: b.filters?.search !== false,
    },
  };
  saveConfig(next);
  res.json(publicConfig(next));
});

app.post('/api/check', async (_req, res) => {
  const cfg = loadConfig();
  const probe = async (base) => {
    if (!base) return { ok: false, msg: 'URL not set' };
    try {
      const r = await fetch(base + (cfg.login.path || '/'),{ redirect: 'follow', signal: AbortSignal.timeout(10000) });
      return { ok: r.status < 500, msg: `HTTP ${r.status}` };
    } catch (e) {
      return { ok: false, msg: e.cause?.code || e.message };
    }
  };
  const [legacy, nw] = await Promise.all([probe(cfg.legacy.baseUrl), probe(cfg.new.baseUrl)]);
  res.json({ legacy, new: nw });
});

app.post('/api/run', (req, res) => {
  try {
    const runId = runner.start(loadConfig(), req.body?.roles || []);
    res.json({ runId });
  } catch (e) {
    res.status(409).json({ error: e.message });
  }
});

app.post('/api/stop', (_req, res) => {
  runner.stop();
  res.json({ ok: true });
});

app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'state', state: runner.state })}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

const readRun = (id) => {
  const f = path.join(RUNS_DIR, path.basename(id), 'results.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
};

app.get('/api/runs', (_req, res) => {
  if (!fs.existsSync(RUNS_DIR)) return res.json([]);
  const list = fs
    .readdirSync(RUNS_DIR)
    .sort()
    .reverse()
    .map((id) => {
      const r = readRun(id);
      return r ? { id, startedAt: r.startedAt, ...counts(r.results) } : null;
    })
    .filter(Boolean);
  res.json(list);
});

app.get('/api/runs/:id', (req, res) => {
  const r = readRun(req.params.id);
  r ? res.json(r) : res.status(404).json({ error: 'Run not found' });
});

app.get('/api/runs/:id/export.xlsx', async (req, res) => {
  const r = readRun(req.params.id);
  if (!r) return res.status(404).json({ error: 'Run not found' });
  const file = path.join(RUNS_DIR, path.basename(req.params.id), 'report.xlsx');
  await buildXlsx(r, file);
  res.download(file, `diffpilot-${r.id}.xlsx`);
});

app.listen(PORT, HOST, () => console.log(`DiffPilot running at http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`));
