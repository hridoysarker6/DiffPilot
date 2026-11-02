import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.env.DIFFPILOT_CONFIG || path.join(ROOT, 'config.yaml');

export const DEFAULTS = {
  legacy: { baseUrl: '' },
  new: { baseUrl: '' },
  login: { path: '', emailSelector: '', passwordSelector: '', submitSelector: '' },
  users: [],
  routes: [],
  crawl: { maxPages: 60 },
  ignore: { paths: [], columns: [], text: [], selectors: [] },
  compare: { fieldKey: 'name' },
  filters: { enabled: true, maxOptions: 8, maxControls: 3, search: true },
  headless: true,
};

export function loadConfig() {
  const c = fs.existsSync(FILE) ? YAML.parse(fs.readFileSync(FILE, 'utf8')) || {} : {};
  return {
    ...DEFAULTS,
    ...c,
    legacy: { ...DEFAULTS.legacy, ...c.legacy },
    new: { ...DEFAULTS.new, ...c.new },
    login: { ...DEFAULTS.login, ...c.login },
    crawl: { ...DEFAULTS.crawl, ...c.crawl },
    ignore: { ...DEFAULTS.ignore, ...c.ignore },
    compare: { ...DEFAULTS.compare, ...c.compare },
    filters: { ...DEFAULTS.filters, ...c.filters },
    users: c.users || [],
    routes: c.routes || [],
  };
}

export function saveConfig(cfg) {
  fs.writeFileSync(FILE, YAML.stringify(cfg));
}
