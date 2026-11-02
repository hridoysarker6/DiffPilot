import { detectFilters, tagFilterButton, extractData, settle } from './extract.js';
import { compare } from './compare.js';

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, '');

const rowsOf = (data) => {
  if (!data) return null;
  if (data.pagination != null) return data.pagination;
  return data.tables.reduce((m, t) => Math.max(m, t.rows.length), 0);
};

// Search box e dewar jonno page er prothom table row theke ekta shobdo nei
function sampleTerm(data) {
  for (const t of data?.tables || []) {
    for (const row of t.rows.slice(0, 3)) {
      for (const cell of row) {
        const c = cell.trim();
        if (/[a-zঀ-৿]{3,}/i.test(c)) return c.length <= 30 ? c : c.split(/\s+/)[0];
      }
    }
  }
  return null;
}

async function applyAndExtract(page, url, ctl, task, ignoreSelectors) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await settle(page);
    const loc = page.locator(ctl.sel).first();
    if (task.kind === 'select') {
      const opt = ctl.options.find((o) => norm(o.text) === norm(task.text));
      if (!opt) return { error: 'option not found' };
      await loc.selectOption({ value: opt.value }, { timeout: 5000 });
    } else {
      await loc.fill(task.text, { timeout: 5000 });
    }
    await page.waitForTimeout(400); // auto-submit/ajax filter hole shuru hok
    if (await tagFilterButton(page, ctl.sel)) {
      await page.locator('[data-dp-filter="1"]').first().click({ timeout: 4000 }).catch(() => {});
    } else if (task.kind === 'search') {
      await loc.press('Enter').catch(() => {});
    }
    await settle(page);
    return { data: await extractData(page, ignoreSelectors), finalUrl: page.url() };
  } catch (e) {
    return { error: e.message.split('\n')[0] };
  }
}

// Duita open page (default state e) er filter gulo duita site e apply kore table/total compare kore.
export async function runFilterTests(lp, np, lurl, nurl, cfg, shouldStop = () => false) {
  const fc = cfg.filters || {};
  const out = { issues: [], tests: [] };
  const ign = cfg.ignore?.selectors || [];

  const [lc, nc] = await Promise.all([detectFilters(lp), detectFilters(np)]);
  if (!lc.selects.length && !lc.search) return out;

  const keyOf = (c) => (cfg.compare?.fieldKey === 'label' ? norm(c.label) || c.key : c.key);
  const nmap = new Map(nc.selects.map((c) => [keyOf(c), c]));
  const tasks = [];

  for (const l of lc.selects.slice(0, fc.maxControls ?? 3)) {
    const n = nmap.get(keyOf(l));
    const name = l.label || l.key;
    if (!n) {
      out.issues.push({ sev: 'warn', field: `Filter "${name}" missing in new`, legacy: l.options.map((o) => o.text).slice(0, 8).join(' | '), new: '' });
      continue;
    }
    const have = new Set(n.options.map((o) => norm(o.text)));
    for (const o of l.options.filter((o) => have.has(norm(o.text))).slice(0, fc.maxOptions ?? 8)) {
      tasks.push({ kind: 'select', name, text: o.text, l, n });
    }
  }
  if (fc.search !== false && lc.search && nc.search) {
    const base = await extractData(lp, ign).catch(() => null);
    const term = sampleTerm(base);
    if (term) tasks.push({ kind: 'search', name: lc.search.label || lc.search.key, text: term, l: lc.search, n: nc.search });
  }

  for (const t of tasks) {
    if (shouldStop()) break;
    const [lr, nr] = await Promise.all([applyAndExtract(lp, lurl, t.l, t, ign), applyAndExtract(np, nurl, t.n, t, ign)]);
    const label = `Filter ${t.kind === 'search' ? 'search' : t.name} = "${t.text}"`;
    const test = { control: t.name, kind: t.kind, option: t.text, severity: 'ok', legacyRows: rowsOf(lr.data), newRows: rowsOf(nr.data), error: null };

    if (lr.error || nr.error) {
      // Tool apply korte parle na: site er bug noy, tai warning
      test.severity = 'warn';
      test.error = lr.error || nr.error;
      out.issues.push({ sev: 'warn', field: `${label}: could not apply (${lr.error ? 'legacy' : 'new'}: ${test.error})`, legacy: lr.error || '', new: nr.error || '' });
    } else {
      const pseudo = (r) => ({ status: 200, finalUrl: r.finalUrl, error: null, data: r.data, consoleErrors: [], failed: [] });
      const res = compare(pseudo(lr), pseudo(nr), cfg, { dataOnly: true });
      test.severity = res.severity;
      for (const i of res.issues) out.issues.push({ ...i, field: `${label}: ${i.field}` });
    }
    out.tests.push(test);
  }
  return out;
}
