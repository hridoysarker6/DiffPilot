import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function counts(results) {
  const c = { total: results.length, ok: 0, warn: 0, fail: 0 };
  for (const r of results) c[r.severity]++;
  return c;
}

const LABEL = { ok: 'Passed', warn: 'Warning', fail: 'Failed' };
const COLOR = { ok: '#166534', warn: '#92400e', fail: '#991b1b' };
const BG = { ok: '#dcfce7', warn: '#fef3c7', fail: '#fee2e2' };

const chip = (arr, bg, fg) => arr.map((x) => `<span class="chip" style="background:${bg};color:${fg}">${esc(x)}</span>`).join('');

function issueHtml(i) {
  const d = i.detail;
  let body;
  if (!d) {
    body = `<table><tr><th>Legacy</th><th>New</th></tr><tr><td>${esc(i.legacy)}</td><td>${esc(i.new)}</td></tr></table>`;
  } else if (d.type === 'list') {
    body =
      (d.missing.length ? `<div><small style="color:#991b1b">In Legacy, missing in New:</small><br>${chip(d.missing, '#fee2e2', '#991b1b')}</div>` : '') +
      (d.extra.length ? `<div><small style="color:#166534">Extra in New:</small><br>${chip(d.extra, '#dcfce7', '#166534')}</div>` : '');
  } else {
    const cells = (row, bad, bg) => row.map((c, k) => `<td${bad && bad.includes(k) ? ` style="background:${bg};font-weight:600"` : ''}>${esc(c)}</td>`).join('');
    const rows =
      d.changed.map((c) => `<tr><td>Legacy</td>${cells(c.legacy, c.diff, '#fee2e2')}</tr><tr><td>New</td>${cells(c.new, c.diff, '#dcfce7')}</tr>`).join('') +
      d.missing.map((r) => `<tr style="background:#fee2e2"><td>Missing in New</td>${cells(r)}</tr>`).join('') +
      d.extra.map((r) => `<tr style="background:#dcfce7"><td>Extra in New</td>${cells(r)}</tr>`).join('');
    body = `<table><tr><th></th>${d.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows}</table>`;
  }
  return `<div class="iss"><b style="color:${COLOR[i.sev]}">${esc(i.field)}</b>${body}</div>`;
}

export function buildHtml(run) {
  const c = counts(run.results);
  const roles = [...new Set(run.results.map((r) => r.role))];
  const body = roles
    .map((role) => {
      const items = run.results.filter((r) => r.role === role);
      const rc = counts(items);
      const rows = items
        .map((r) => {
          const issues = r.issues.length ? r.issues.map(issueHtml).join('') : '<p>No differences.</p>';
          const shots =
            r.shots && (r.shots.legacy || r.shots.new)
              ? `<div class="shots">${['legacy', 'new']
                  .map((k) => (r.shots[k] ? `<figure><figcaption>${k}</figcaption><a href="${esc(r.shots[k])}"><img loading="lazy" src="${esc(r.shots[k])}"></a></figure>` : ''))
                  .join('')}</div>`
              : '';
          const ft = (r.filters || []).length
            ? `<p><b>Filter tests</b></p><table><tr><th>Filter</th><th>Value</th><th>Legacy rows</th><th>New rows</th><th>Result</th></tr>${r.filters
                .map((f) => `<tr><td>${esc(f.control)}</td><td>${esc(f.option)}</td><td>${f.legacyRows ?? '-'}</td><td>${f.newRows ?? '-'}</td><td style="color:${COLOR[f.severity]}">${LABEL[f.severity]}</td></tr>`)
                .join('')}</table>`
            : '';
          return `<details><summary><span class="b" style="background:${BG[r.severity]};color:${COLOR[r.severity]}">${LABEL[r.severity]}</span> <code>${esc(r.path)}</code> <span class="m">${esc(r.summary)} (legacy ${r.legacy.status}, new ${r.new.status})</span></summary>${issues}${ft}${shots}</details>`;
        })
        .join('');
      return `<h2>${esc(role)} <small>${rc.ok} passed, ${rc.warn} warning, ${rc.fail} failed</small></h2>${rows}`;
    })
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>DiffPilot report ${esc(run.id)}</title>
<style>body{font:14px system-ui,sans-serif;max-width:1100px;margin:24px auto;padding:0 16px;color:#111}
.cards{display:flex;gap:12px}.cards div{flex:1;background:#f4f4f5;border-radius:8px;padding:12px}.cards b{display:block;font-size:24px}
details{border-bottom:1px solid #e4e4e7;padding:6px 0}summary{cursor:pointer}.b{padding:2px 8px;border-radius:6px;font-size:12px}.m{color:#71717a}
table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border:1px solid #e4e4e7;padding:4px 8px;text-align:left;vertical-align:top;word-break:break-word}
.shots{display:flex;gap:12px}.shots figure{flex:1;margin:0}.shots img{width:100%;border:1px solid #e4e4e7}small{font-weight:400;color:#71717a;font-size:13px}.iss{border:1px solid #e4e4e7;border-radius:8px;padding:8px 10px;margin:8px 0}.chip{display:inline-block;padding:2px 8px;border-radius:4px;margin:2px 4px 2px 0}</style></head><body>
<h1>DiffPilot report</h1>
<p>Run ${esc(run.id)} · Legacy: ${esc(run.legacyUrl)} · New: ${esc(run.newUrl)} · ${esc(new Date(run.startedAt).toLocaleString())}</p>
<div class="cards"><div>Total<b>${c.total}</b></div><div>Passed<b style="color:#166534">${c.ok}</b></div><div>Warning<b style="color:#92400e">${c.warn}</b></div><div>Failed<b style="color:#991b1b">${c.fail}</b></div></div>
${body}</body></html>`;
}

export async function buildXlsx(run, file) {
  const wb = new ExcelJS.Workbook();
  const sum = wb.addWorksheet('Summary');
  sum.columns = [
    { header: 'Role', key: 'role', width: 20 },
    { header: 'Total', key: 'total', width: 10 },
    { header: 'Passed', key: 'ok', width: 10 },
    { header: 'Warning', key: 'warn', width: 10 },
    { header: 'Failed', key: 'fail', width: 10 },
  ];
  for (const role of [...new Set(run.results.map((r) => r.role))]) {
    sum.addRow({ role, ...counts(run.results.filter((r) => r.role === role)) });
  }
  sum.addRow({ role: 'ALL', ...counts(run.results) });

  const res = wb.addWorksheet('Results');
  res.columns = [
    { header: 'Role', key: 'role', width: 16 },
    { header: 'Page', key: 'path', width: 40 },
    { header: 'Result', key: 'severity', width: 10 },
    { header: 'Summary', key: 'summary', width: 50 },
    { header: 'Legacy status', key: 'ls', width: 14 },
    { header: 'New status', key: 'ns', width: 12 },
    { header: 'Legacy screenshot', key: 'lshot', width: 40 },
    { header: 'New screenshot', key: 'nshot', width: 40 },
  ];
  for (const r of run.results) {
    res.addRow({
      role: r.role,
      path: r.path,
      severity: LABEL[r.severity],
      summary: r.summary,
      ls: r.legacy.status,
      ns: r.new.status,
      lshot: r.shots?.legacy || '',
      nshot: r.shots?.new || '',
    });
  }

  const iss = wb.addWorksheet('Issues');
  iss.columns = [
    { header: 'Role', key: 'role', width: 16 },
    { header: 'Page', key: 'path', width: 36 },
    { header: 'Severity', key: 'sev', width: 10 },
    { header: 'Field', key: 'field', width: 44 },
    { header: 'Legacy', key: 'legacy', width: 50 },
    { header: 'New', key: 'new', width: 50 },
  ];
  for (const r of run.results) for (const i of r.issues) iss.addRow({ role: r.role, path: r.path, sev: LABEL[i.sev], field: i.field, legacy: i.legacy, new: i.new });
  for (const ws of [sum, res, iss]) ws.getRow(1).font = { bold: true };

  await wb.xlsx.writeFile(file);
}

export function writeReport(run, dir) {
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(run));
  fs.writeFileSync(path.join(dir, 'report.html'), buildHtml(run));
}
