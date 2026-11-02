// Browser er bhitore chole. Theme/colour na, shudhu data, form, access related info nei.
const DEV_SELECTORS = [
  '#phpdebugbar', '.phpdebugbar', '#debugbar', '.debugbar', '#clockwork-app', '#telescope', '#query-monitor',
  '.tracy-bar', '#tracy-debug', '#sf-toolbar', '.sf-toolbarreset', '#__vite_error_overlay', 'vite-error-overlay',
  '#livewire-error', '#ignition-container', '.laravel-debugbar', '#browser-sync-banner', '#__bs_notify__',
  // Django, Next.js, Webpack, ASP.NET, Rails, Angular ityadi
  '#djDebug', 'nextjs-portal', '#__next-build-watcher', '#webpack-dev-server-client-overlay', '#__browserLink_',
  '[id^=__browserLink]', '.mp-snapshots', '#rails-footer', 'ng-devtools', '#react-refresh-overlay',
];
// Dev tool er request/console noise (debugbar, vite hot reload ityadi) gona hobe na
const DEV_REQUEST = /_debugbar|_ignition|telescope|clockwork|horizon|browser-sync|__vite|@vite|\/@fs\/|hot-update|sockjs|\/livewire\/(?:livewire\.js\.map)/i;
const DEV_CONSOLE = /debugbar|\[vite\]|vite|browser-sync|webpack|hot[- ]update|sourcemap|source map|devtools/i;

function extractInPage(extra) {
  document.querySelectorAll(extra.join(',')).forEach((e) => (e.style.display = 'none'));
  const txt = (e) => (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim();
  const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  const uniq = (a) => [...new Set(a)];

  const headings = [...document.querySelectorAll('h1,h2')].filter(vis).map(txt).filter(Boolean).slice(0, 10);

  const tables = [...document.querySelectorAll('table')]
    .filter(vis)
    .map((t) => {
      let headers = [...t.querySelectorAll('thead th, thead td')].map(txt);
      let rowEls = [...t.querySelectorAll('tbody tr')];
      if (!headers.length) {
        const first = t.querySelector('tr');
        if (first && first.querySelector('th')) {
          headers = [...first.children].map(txt);
          if (!rowEls.length) rowEls = [...t.querySelectorAll('tr')].slice(1);
        }
      }
      if (!rowEls.length) rowEls = [...t.querySelectorAll('tr')].filter((r) => !r.querySelector('th'));
      const rows = rowEls
        .map((r) => [...r.children].map(txt))
        .filter((r) => r.length && r.join('') !== '')
        .slice(0, 500);
      return { headers, rows };
    })
    .filter((t) => t.headers.length || t.rows.length);

  // div-based grid (React/Vue/Angular, ag-grid, MUI etc): ARIA role diye
  [...document.querySelectorAll('[role=table],[role=grid],[role=treegrid]')]
    .filter((t) => vis(t) && !t.closest('table'))
    .forEach((t) => {
      const headers = [...t.querySelectorAll('[role=columnheader]')].map(txt);
      const rows = [...t.querySelectorAll('[role=row]')]
        .map((r) => [...r.querySelectorAll('[role=cell],[role=gridcell],[role=rowheader]')].map(txt))
        .filter((r) => r.length && r.join('') !== '')
        .slice(0, 500);
      if (headers.length || rows.length) tables.push({ headers, rows });
    });

  const labelOf = (el) => {
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return txt(l);
    }
    const wrap = el.closest('label');
    if (wrap) return txt(wrap);
    return el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
  };

  const forms = [...document.querySelectorAll('form')]
    .filter((f) => !/logout|signout/i.test(f.getAttribute('action') || ''))
    .map((f) => {
      const fields = [...f.querySelectorAll('input, select, textarea')]
        .filter((el) => el.type !== 'hidden' && el.type !== 'submit' && el.type !== 'button' && (el.name || el.id) && !/^(_token|_method|csrfmiddlewaretoken|authenticity_token|__RequestVerificationToken)$/.test(el.name || el.id))
        .map((el) => ({
          name: (el.name || el.id).replace(/\[\d*\]$/, '[]'),
          type: el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : el.type || 'text',
          label: labelOf(el).slice(0, 80),
          required: !!el.required,
          options: el.tagName === 'SELECT' ? [...el.options].map((o) => txt(o)).slice(0, 300) : undefined,
        }));
      const buttons = uniq([...f.querySelectorAll('button, input[type=submit]')].map((b) => txt(b) || b.value || '').filter(Boolean));
      return { method: (f.getAttribute('method') || 'get').toLowerCase(), fields, buttons };
    })
    .filter((f) => f.fields.length);

  const buttons = uniq(
    [...document.querySelectorAll('main a.btn, main button, .content a.btn, .content button, a.btn, button.btn')]
      .filter(vis)
      .map(txt)
      .filter((s) => s && s.length <= 40)
  ).slice(0, 40);

  const nav = uniq(
    [...document.querySelectorAll('nav a, aside a, header a, [class*=sidebar] a, [class*=navbar] a, [class*=menu] a, [role=navigation] a, [role=menuitem]')].filter(vis).map(txt).filter((s) => s && s.length <= 60)
  ).slice(0, 80);

  const stats = uniq(
    [...document.querySelectorAll('[class*=stat],[class*=count],[class*=total],[class*=widget],[class*=metric],[class*=kpi],[class*=summary]')]
      .filter(vis)
      .map(txt)
      .filter((s) => s.length <= 60 && /\d/.test(s))
  ).slice(0, 40);

  const body = document.body ? document.body.innerText || '' : '';
  const totalMatch = body.match(/(?:\bof|total)\s*:?\s*([\d,]+)\s*(?:entries|results|records|items|rows)/i);
  const pagination = totalMatch ? Number(totalMatch[1].replace(/,/g, '')) : null;
  const errMatch = body.match(
    new RegExp(
      [
        // PHP / Laravel / Symfony / WordPress
        'SQLSTATE', 'Whoops', 'ErrorException', 'Undefined (?:variable|array key|index|property|offset)', 'Call to (?:undefined|a member)',
        'Trying to access array offset', 'Class ".*" not found', 'Method .* does not exist', 'Fatal error:', 'Stack trace:', 'There has been a critical error',
        // Django / Python
        'Traceback \\(most recent call last\\)', 'Server Error \\(500\\)', 'OperationalError', 'TemplateDoesNotExist', 'DoesNotExist at',
        // Rails / Ruby
        'ActionController::', 'ActiveRecord::', "We're sorry, but something went wrong",
        // ASP.NET / Java / Node
        "Server Error in '.*' Application", 'Unhandled Exception', 'Runtime Error', 'Whitelabel Error Page', 'java\\.lang\\.\\w+Exception',
        'Cannot (?:GET|POST) /', 'TypeError: ', 'ReferenceError: ', 'Application error: a client-side exception',
        'Internal Server Error', 'Server Error',
      ].join('|'),
      'i'
    )
  );

  return {
    title: document.title,
    headings,
    tables,
    forms,
    buttons,
    nav,
    stats,
    pagination,
    errorText: errMatch ? errMatch[0] : null,
  };
}

export async function visit(context, url, timeout = 30000, ignoreSelectors = []) {
  const page = await context.newPage();
  const origin = new URL(url).origin;
  const consoleErrors = [];
  const failed = [];

  page.on('console', (m) => {
    if (m.type() === 'error' && !DEV_CONSOLE.test(m.text())) consoleErrors.push(m.text().slice(0, 200));
  });
  page.on('response', (r) => {
    try {
      const u = new URL(r.url());
      if (r.status() >= 400 && u.origin === origin && !DEV_REQUEST.test(u.pathname + u.search)) failed.push(`${r.status()} ${u.pathname}`);
    } catch {
      // ignore
    }
  });

  let status = 0;
  let error = null;
  let data = null;
  let extractError = null;
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    status = resp ? resp.status() : 0;
    await settle(page);
  } catch (e) {
    error = e.message.split('\n')[0];
  }
  if (!error) {
    try {
      data = await extractData(page, ignoreSelectors);
    } catch (e) {
      extractError = e.message.split('\n')[0];
    }
  }
  return { page, status, error, data, extractError, consoleErrors, failed, finalUrl: page.url() };
}

export const extractData = (page, ignoreSelectors = []) => page.evaluate(extractInPage, [...DEV_SELECTORS, ...(ignoreSelectors || [])]);

// Page load/filter er por content ready howar opekkha (SPA te content JS diye ase: text stable na howa porjonto)
export async function settle(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page
    .evaluate(
      () =>
        new Promise((res) => {
          let last = -1;
          let same = 0;
          const t = setInterval(() => {
            const n = document.body ? document.body.innerText.length : 0;
            if (n === last) {
              if (++same >= 3) { clearInterval(t); res(); }
            } else { same = 0; last = n; }
          }, 300);
          setTimeout(() => { clearInterval(t); res(); }, 4000);
        })
    )
    .catch(() => {});
}

// Filter control (select, search box) khuje. Shudhu data-filter form; create/edit (Save button) form bad.
function detectFiltersInPage() {
  const FILTER_BTN = /filter|search|apply|show|find|\bgo\b|view|report/i;
  const txt = (e) => (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim();
  const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  const isDataForm = (el) => {
    const f = el.closest('form');
    if (!f) return false;
    if ((f.getAttribute('method') || 'get').toLowerCase() === 'get') return false;
    const labels = [...f.querySelectorAll('button, input[type=submit]')].map((b) => `${b.innerText || ''} ${b.value || ''}`);
    return !labels.some((t) => FILTER_BTN.test(t));
  };
  const labelOf = (el) => {
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return txt(l);
    }
    const wrap = el.closest('label');
    return wrap ? txt(wrap) : el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
  };
  const selOf = (el) => {
    if (el.name) return `${el.tagName.toLowerCase()}[name="${el.name.replace(/"/g, '\\"')}"]`;
    if (el.id) return `#${CSS.escape(el.id)}`;
    return null;
  };

  const selects = [...document.querySelectorAll('select')]
    .filter((el) => vis(el) && !el.closest('table') && !isDataForm(el) && !/length|per.?page|page.?size|limit|rows/i.test(`${el.name} ${el.id}`))
    .map((el) => {
      const sel = selOf(el);
      if (!sel) return null;
      const options = [...el.options]
        .map((o) => ({ text: txt(o), value: o.value }))
        .filter((o) => o.value !== '' && o.text && !/^(select|choose|--|all\b|please)/i.test(o.text))
        .slice(0, 40);
      return options.length ? { key: el.name || el.id, sel, label: labelOf(el).slice(0, 60), options } : null;
    })
    .filter(Boolean);

  const sEl = [...document.querySelectorAll('input[type=search], input[type=text], input:not([type])')].find(
    (el) =>
      vis(el) &&
      !el.closest('table') &&
      !isDataForm(el) &&
      (el.type === 'search' || /search|keyword|query|term|\bq\b|filter/i.test(`${el.name} ${el.id} ${el.placeholder} ${el.getAttribute('aria-label') || ''}`))
  );
  const searchSel = sEl ? selOf(sEl) : null;
  const search = searchSel ? { key: sEl.name || sEl.id, sel: searchSel, label: labelOf(sEl).slice(0, 60) } : null;
  return { selects, search };
}

export const detectFilters = (page) => page.evaluate(detectFiltersInPage).catch(() => ({ selects: [], search: null }));

// Filter control er form er filter/search button ke tag kore (data-dp-filter)
export const tagFilterButton = (page, sel) =>
  page
    .evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return false;
      const scope = el.closest('form') || document;
      const t = (b) => `${b.innerText || ''} ${b.value || ''}`;
      const bad = /reset|clear|cancel|export|print|download|save|delete|remove|add|create/i;
      const btns = [...scope.querySelectorAll('button, input[type=submit], input[type=button], a.btn')].filter((b) => !b.disabled && (b.offsetWidth || b.offsetHeight));
      const good =
        btns.find((b) => /filter|search|apply|show|find|\bgo\b|view|report/i.test(t(b)) && !bad.test(t(b))) ||
        btns.find((b) => b.type === 'submit' && !bad.test(t(b)));
      if (!good) return false;
      good.setAttribute('data-dp-filter', '1');
      return true;
    }, sel)
    .catch(() => false);
