const RANK = { ok: 0, warn: 1, fail: 2 };
const DEFAULT_IGNORE_COL = /^(#|sl\.?|sn|s\.?no\.?|serial|no\.?|action|actions|options)?$/i;

const pathOf = (u) => {
  try {
    return new URL(u).pathname.replace(/\/+$/, '') || '/';
  } catch {
    return u;
  }
};

const fmt = (v) => {
  if (v === undefined || v === null) return '';
  const s = Array.isArray(v) ? v.join(' | ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 300 ? s.slice(0, 300) + '…' : s;
};

function makeNorm(ignoreText = []) {
  const res = ignoreText.map((s) => new RegExp(s, 'gi'));
  return (s) => {
    let t = String(s ?? '');
    for (const r of res) t = t.replace(r, '');
    return t
      .toLowerCase()
      .replace(/[\s,৳$₹€£]/g, '')
      .replace(/(\d)\.0+(?!\d)/g, '$1');
  };
}

function pair(Ls, Ns, keyFn) {
  const used = new Set();
  const pairs = [];
  const missing = [];
  for (const l of Ls) {
    const lk = keyFn(l);
    let best = -1;
    let bestScore = 0;
    Ns.forEach((n, j) => {
      if (used.has(j)) return;
      const nk = keyFn(n);
      let score;
      if (!lk.size && !nk.size) score = 1;
      else {
        const inter = [...lk].filter((k) => nk.has(k)).length;
        score = inter / (new Set([...lk, ...nk]).size || 1);
      }
      if (score > bestScore) {
        bestScore = score;
        best = j;
      }
    });
    if (best >= 0 && bestScore >= 0.5) {
      used.add(best);
      pairs.push([l, Ns[best]]);
    } else missing.push(l);
  }
  return { pairs, missing, extra: Ns.filter((_, j) => !used.has(j)) };
}

const diffSets = (a, b, norm) => {
  const nb = new Set(b.map(norm));
  const na = new Set(a.map(norm));
  return {
    onlyA: a.filter((x) => norm(x) && !nb.has(norm(x))),
    onlyB: b.filter((x) => norm(x) && !na.has(norm(x))),
  };
};

// opts.dataOnly: filter test er jonno, shudhu table data, pagination ar error text compare kore
export function compare(L, N, cfg = {}, opts = {}) {
  const ignore = cfg.ignore || {};
  const norm = makeNorm(ignore.text);
  const colIgnore = (ignore.columns || []).map((r) => new RegExp(r, 'i'));
  const skipCol = (h) => DEFAULT_IGNORE_COL.test(h.trim()) || colIgnore.some((r) => r.test(h));
  // Form field kon key diye milabe: 'name' (same framework) ba 'label' (framework alada, naam alada)
  const fk = (x) => (cfg.compare?.fieldKey === 'label' ? norm(x.label) || x.name : x.name);
  const issues = [];
  const add =(sev, field, l, n, detail) => issues.push({ sev, field, legacy: fmt(l), new: fmt(n), ...(detail ? { detail } : {}) });
  // Visual list diff: missing = legacy te ase new te nai, extra = new te beshi
  const addList = (sev, field, missing, extra) => add(sev, field, missing.slice(0, 8), extra.slice(0, 8), { type: 'list', missing, extra });

  if (L.error || N.error) {
    if (L.error && N.error) add('fail', 'Page load', L.error, N.error);
    else add('fail', 'Page load', L.error || `HTTP ${L.status}`, N.error || `HTTP ${N.status}`);
    return finish(issues);
  }
  if (L.status !== N.status) add('fail', 'HTTP status', L.status, N.status);

  const lp = pathOf(L.finalUrl);
  const np = pathOf(N.finalUrl);
  if (!opts.dataOnly && lp !== np) {
    const toLogin = /login/i.test(lp) || /login/i.test(np);
    add(toLogin || L.status !== N.status ? 'fail' : 'warn', 'Final URL (redirect)', lp, np);
  }
  if (L.extractError || N.extractError) add('warn', 'Could not read page content (tool error, not a site error)', L.extractError, N.extractError);
  if (L.status >= 400 || N.status >= 400 || !L.data || !N.data) return finish(issues);

  const ld = L.data;
  const nd = N.data;

  if (ld.errorText || nd.errorText) add('fail', 'Error text on page', ld.errorText, nd.errorText);
  if (!opts.dataOnly) {
    if (nd.errorText == null && N.consoleErrors.length > L.consoleErrors.length) add('warn', 'Console errors', L.consoleErrors, N.consoleErrors);
    if (N.failed.length > L.failed.length) add('warn', 'Failed requests', L.failed, N.failed);
    if (ld.headings[0] && norm(ld.headings[0]) !== norm(nd.headings[0])) add('warn', 'Main heading', ld.headings[0], nd.headings[0]);
  }

  // Tables
  const tkey = (t) => new Set(t.headers.map(norm).filter(Boolean));
  const tp = pair(ld.tables, nd.tables, tkey);
  const tname = (t) => `Table "${t.headers.slice(0, 3).join(' / ') || 'no header'}"`;
  for (const t of tp.missing) add(t.rows.length ? 'fail' : 'warn', `${tname(t)} missing in new`, `${t.rows.length} rows`, 'not found');
  for (const [lt, nt] of tp.pairs) {
    const lh = lt.headers.map(norm);
    const nh = nt.headers.map(norm);
    const hd = diffSets(lt.headers, nt.headers, norm);
    if (hd.onlyA.length || hd.onlyB.length) addList('warn', `${tname(lt)} columns`, hd.onlyA, hd.onlyB);

    const cols = lt.headers
      .map((h, i) => ({ h, li: i, ni: nh.indexOf(lh[i]) }))
      .filter((c) => c.ni >= 0 && lh[c.li] && !skipCol(c.h));
    const sig = (row, side) => (cols.length ? cols.map((c) => norm(row[side === 'l' ? c.li : c.ni])).join('¦') : row.map(norm).join('¦'));
    const raw = (row, side) => (cols.length ? cols.map((c) => row[side === 'l' ? c.li : c.ni] ?? '') : row);
    const shownHeaders = cols.length ? cols.map((c) => c.h) : lt.headers;

    if (lt.rows.length !== nt.rows.length) add('fail', `${tname(lt)} row count`, lt.rows.length, nt.rows.length);
    const counts = new Map();
    for (const r of lt.rows) counts.set(sig(r, 'l'), (counts.get(sig(r, 'l')) || 0) + 1);
    const nOnly = [];
    for (const r of nt.rows) {
      const k = sig(r, 'n');
      if (counts.get(k)) counts.set(k, counts.get(k) - 1);
      else nOnly.push(raw(r, 'n'));
    }
    const lOnly = lt.rows.filter((r) => counts.get(sig(r, 'l')) > 0 && (counts.set(sig(r, 'l'), counts.get(sig(r, 'l')) - 1), true)).map((r) => raw(r, 'l'));
    if (lOnly.length || nOnly.length) {
      // Same row ke pair kore (cell-level diff dekhate): je row te sobcheye beshi cell mile
      const changed = [];
      const freeN = [...nOnly];
      const missingRows = [];
      for (const l of lOnly) {
        let best = -1;
        let bestScore = 0;
        freeN.forEach((n, j) => {
          const score = l.filter((c, k) => norm(c) === norm(n[k])).length;
          if (score > bestScore) {
            bestScore = score;
            best = j;
          }
        });
        if (best >= 0 && bestScore >= Math.max(1, Math.ceil(l.length / 2))) {
          const n = freeN.splice(best, 1)[0];
          changed.push({ legacy: l, new: n, diff: l.map((c, k) => (norm(c) === norm(n[k]) ? -1 : k)).filter((k) => k >= 0) });
        } else missingRows.push(l);
      }
      const detail = { type: 'table', headers: shownHeaders, changed: changed.slice(0, 60), missing: missingRows.slice(0, 60), extra: freeN.slice(0, 60) };
      add(
        'fail',
        `${tname(lt)} data: ${changed.length} changed, ${missingRows.length} missing in new, ${freeN.length} extra in new`,
        [...changed.map((c) => c.legacy), ...missingRows].slice(0, 3).map((r) => r.join(' | ')),
        [...changed.map((c) => c.new), ...freeN].slice(0, 3).map((r) => r.join(' | ')),
        detail
      );
    }
  }

  if (ld.pagination != null && ld.pagination !== nd.pagination) add('fail', 'Pagination total', ld.pagination, nd.pagination);
  if (opts.dataOnly) return finish(issues);

  const sd = diffSets(ld.stats, nd.stats, norm);
  if (sd.onlyA.length) addList('warn', 'Dashboard / stat values', sd.onlyA, sd.onlyB);

  // Forms
  const fkey = (f) => new Set(f.fields.map(fk));
  const fp = pair(ld.forms, nd.forms, fkey);
  for (const f of fp.missing) add('fail', 'Form missing in new', f.fields.map((x) => x.name), 'not found');
  for (const [lf, nf] of fp.pairs) {
    const nmap = new Map(nf.fields.map((x) => [fk(x), x]));
    const lmap = new Map(lf.fields.map((x) => [fk(x), x]));
    const fname = `Form (${lf.fields.slice(0, 3).map((x) => x.name).join(', ')})`;
    const shown = (x) => (cfg.compare?.fieldKey === 'label' && x.label ? x.label : x.name);
    const missing = lf.fields.filter((x) => !nmap.has(fk(x))).map(shown);
    const extra = nf.fields.filter((x) => !lmap.has(fk(x))).map(shown);
    if (missing.length) addList('fail', `${fname} fields missing in new`, missing, []);
    if (extra.length) addList('warn', `${fname} extra fields in new`, [], extra);
    for (const lfld of lf.fields) {
      const nfld = nmap.get(fk(lfld));
      if (!nfld) continue;
      if (lfld.required !== nfld.required) add('warn', `${fname} "${lfld.name}" required`, lfld.required, nfld.required);
      if (lfld.type !== nfld.type && (lfld.type === 'select' || nfld.type === 'select')) add('warn', `${fname} "${lfld.name}" type`, lfld.type, nfld.type);
      if (lfld.options && nfld.options) {
        const skip = (o) => /^(select|choose|--|please)/i.test(o.trim());
        const od = diffSets(lfld.options.filter((o) => !skip(o)), nfld.options.filter((o) => !skip(o)), norm);
        if (od.onlyA.length) addList('fail', `${fname} "${lfld.name}" options missing in new`, od.onlyA, []);
        if (od.onlyB.length) addList('warn', `${fname} "${lfld.name}" extra options in new`, [], od.onlyB);
      }
    }
  }

  const bd = diffSets(ld.buttons, nd.buttons, norm);
  if (bd.onlyA.length) addList('warn', 'Buttons missing in new', bd.onlyA, []);

  const nvd = diffSets(ld.nav, nd.nav, norm);
  if (nvd.onlyA.length) addList('warn', 'Menu items missing in new', nvd.onlyA, []);
  if (nvd.onlyB.length) addList('warn', 'Extra menu items in new (check role permission)', [], nvd.onlyB);

  return finish(issues);
}

function finish(issues) {
  let severity = 'ok';
  for (const i of issues) if (RANK[i.sev] > RANK[severity]) severity = i.sev;
  const top = issues.find((i) => i.sev === severity);
  return { severity, summary: top ? top.field : 'Same on both', issues };
}
