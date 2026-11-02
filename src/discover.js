const SKIP = /log[-_]?out|log[-_]?off|sign[-_]?out|delete|destroy|remove|download|export|\.(pdf|zip|xlsx?|csv|png|jpe?g|gif|svg|docx?)$/i;

const normPath = (p) => p.replace(/\/+$/, '') || '/';

// Dynamic page (/orders/123) theke shudhu ekta sample nei, tai pattern key bananu.
const patternKey = (p) => p.replace(/\/\d+(?=\/|$)/g, '/{id}');

export async function crawl(context, baseUrl, startPath, { maxPages = 60 } = {}, shouldStop = () => false) {
  const origin = new URL(baseUrl).origin;
  const seen = new Set();
  const patterns = new Set();
  const queue = [normPath(startPath)];
  const found = [];
  const page = await context.newPage();

  try {
    while (queue.length && found.length < maxPages && !shouldStop()) {
      const p = queue.shift();
      if (seen.has(p)) continue;
      seen.add(p);

      try {
        const resp = await page.goto(origin + p, { waitUntil: 'domcontentloaded', timeout: 30000 });
        if (!resp || resp.status() >= 400) continue;
        const finalUrl = new URL(page.url());
        if (finalUrl.origin !== origin) continue;
        found.push(p);

        const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.href));
        for (const h of hrefs) {
          let u;
          try {
            u = new URL(h);
          } catch {
            continue;
          }
          if (u.origin !== origin) continue;
          // hash route (#/orders) SPA te page hishebe gona hoy
          const np = normPath(u.pathname) + (u.hash.startsWith('#/') ? u.hash : '');
          if (SKIP.test(np) || seen.has(np)) continue;
          const key = patternKey(np);
          if (key !== np) {
            if (patterns.has(key)) continue;
            patterns.add(key);
          }
          queue.push(np);
        }
      } catch {
        // page load fail, skip
      }
    }
  } finally {
    await page.close().catch(() => {});
  }
  return found;
}
