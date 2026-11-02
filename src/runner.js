import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from './config.js';
import { createSession } from './auth.js';
import { crawl } from './discover.js';
import { visit } from './extract.js';
import { compare } from './compare.js';
import { runFilterTests } from './filter.js';
import { counts, writeReport } from './report.js';

export const RUNS_DIR = path.join(ROOT, 'runs');

const slug = (p) => (p === '/' ? 'home' : p.replace(/^\/+/, '').replace(/[^a-z0-9]+/gi, '_')).slice(0, 80);
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');

export class Runner extends EventEmitter {
  state = { running: false, runId: null, progress: { done: 0, total: 0 }, logs: [] };
  stopFlag = false;

  emitEvent(e) {
    this.emit('event', e);
  }

  log(level, msg) {
    const e = { type: 'log', level, msg, t: Date.now() };
    this.state.logs.push(e);
    if (this.state.logs.length > 300) this.state.logs.shift();
    this.emitEvent(e);
  }

  progress(done, total) {
    this.state.progress = { done, total };
    this.emitEvent({ type: 'progress', done, total });
  }

  stop() {
    this.stopFlag = true;
    this.log('warn', 'Stop requested, finishing current page…');
  }

  start(cfg, roles = []) {
    if (this.state.running) throw new Error('A run is already in progress');
    const runId = stamp();
    this.stopFlag = false;
    this.state = { running: true, runId, progress: { done: 0, total: 0 }, logs: [] };
    this.emitEvent({ type: 'started', runId });
    this.execute(cfg, roles, runId).catch((e) => this.log('error', `Run crashed: ${e.message}`)).finally(() => {
      this.state.running = false;
      this.emitEvent({ type: 'done', runId });
    });
    return runId;
  }

  async execute(cfg, roles, runId) {
    const dir = path.join(RUNS_DIR, runId);
    fs.mkdirSync(path.join(dir, 'shots'), { recursive: true });
    const run = { id: runId, startedAt: Date.now(), legacyUrl: cfg.legacy.baseUrl, newUrl: cfg.new.baseUrl, results: [] };
    const users = cfg.users.filter((u) => !roles.length || roles.includes(u.role));
    if (!users.length) {
      this.log('error', 'No users selected. Add a test user in Setup.');
      return;
    }
    if (!cfg.legacy.baseUrl || !cfg.new.baseUrl) {
      this.log('error', 'Legacy and New URL are required.');
      return;
    }

    const ignorePaths = (cfg.ignore.paths || []).map((r) => new RegExp(r));
    const browser = await chromium.launch({ headless: cfg.headless !== false });
    let done = 0;
    let total = 0;
    const save = () => writeReport({ ...run, finishedAt: Date.now() }, dir);

    try {
      for (const user of users) {
        if (this.stopFlag) break;
        this.log('info', `[${user.role}] logging in to both sites…`);
        let ls;
        let ns;
        try {
          [ls, ns] = await Promise.all([
            createSession(browser, cfg.legacy.baseUrl, user, cfg.login),
            createSession(browser, cfg.new.baseUrl, user, cfg.login),
          ]).catch(async (e) => {
            throw e;
          });
        } catch (e) {
          this.log('error', `[${user.role}] ${e.message}`);
          run.results.push(this.loginFailure(user.role, e.message));
          total++;
          done++;
          this.progress(done, total);
          continue;
        }

        try {
          let paths = (cfg.routes || []).filter((p) => typeof p === 'string' && !p.includes('{'));
          if (!paths.length) {
            this.log('info', `[${user.role}] no route list, crawling both sites…`);
            const max = cfg.crawl.maxPages;
            const [a, b] = [
              await crawl(ls.context, cfg.legacy.baseUrl, ls.homePath, { maxPages: max }, () => this.stopFlag),
              await crawl(ns.context, cfg.new.baseUrl, ns.homePath, { maxPages: max }, () => this.stopFlag),
            ];
            paths = [...new Set([...a, ...b])];
            this.log('info', `[${user.role}] found ${paths.length} pages (legacy ${a.length}, new ${b.length})`);
          }
          paths = paths.filter((p) => !ignorePaths.some((r) => r.test(p)));
          total += paths.length;
          this.progress(done, total);

          for (const p of paths) {
            if (this.stopFlag) break;
            const result = await this.testPage(cfg, user.role, p, ls.context, ns.context, runId);
            run.results.push(result);
            done++;
            this.progress(done, total);
            this.emitEvent({ type: 'result', result: { role: result.role, path: result.path, severity: result.severity, summary: result.summary } });
            const tag = { ok: 'PASS', warn: 'WARN', fail: 'FAIL' }[result.severity];
            this.log(result.severity === 'ok' ? 'ok' : result.severity, `${tag} ${user.role} ${p}${result.severity === 'ok' ? '' : ' — ' + result.summary}`);
            if (done % 10 === 0) save();
          }
        } finally {
          await ls.context.close().catch(() => {});
          await ns.context.close().catch(() => {});
        }
      }
    } finally {
      await browser.close().catch(() => {});
      save();
      const c = counts(run.results);
      this.log('info', `Done. ${c.total} pages: ${c.ok} passed, ${c.warn} warning, ${c.fail} failed${this.stopFlag ? ' (stopped)' : ''}`);
    }
  }

  loginFailure(role, message) {
    const empty = { status: 0, finalUrl: '', error: message, data: null };
    return {
      id: `${role}-login`, role, path: '(login)', severity: 'fail', summary: message,
      issues: [{ sev: 'fail', field: 'Login', legacy: '', new: message }], legacy: empty, new: empty, shots: {},
    };
  }

  async testPage(cfg, role, p, lctx, nctx, runId) {
    const sel = cfg.ignore.selectors || [];
    const [lv, nv] = await Promise.all([visit(lctx, new URL(p, cfg.legacy.baseUrl).href, 30000, sel), visit(nctx, new URL(p, cfg.new.baseUrl).href, 30000, sel)]);
    const shots = {};
    for (const [key, v] of [['legacy', lv], ['new', nv]]) {
      const rel = `shots/${role}/${slug(p)}-${key}.png`;
      const file = path.join(RUNS_DIR, runId, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const ok = await v.page.screenshot({ path: file, fullPage: true, timeout: 15000 }).then(() => true, () => false);
      if (ok) shots[key] = rel;
    }
    const cmp = compare(lv, nv, cfg);
    const side = (v) => ({ status: v.status, finalUrl: v.finalUrl, error: v.error || v.extractError, data: v.data });
    const result = { id: `${role}:${p}`, role, path: p, severity: cmp.severity, summary: cmp.summary, issues: cmp.issues, filters: [], legacy: side(lv), new: side(nv), shots };

    // Filter test: duita page ekhono default state e khola, tai ekhane chalai
    if (cfg.filters?.enabled !== false && !lv.error && !nv.error && lv.status < 400 && nv.status < 400 && lv.data && nv.data) {
      try {
        const f = await runFilterTests(lv.page, nv.page, lv.finalUrl, nv.finalUrl, cfg, () => this.stopFlag);
        result.filters = f.tests;
        result.issues = [...result.issues, ...f.issues];
        const rank = { ok: 0, warn: 1, fail: 2 };
        for (const i of f.issues) if (rank[i.sev] > rank[result.severity]) result.severity = i.sev;
        const top = result.issues.find((i) => i.sev === result.severity);
        result.summary = top ? top.field : 'Same on both';
      } catch (e) {
        this.log('warn', `[${role}] ${p} filter test error: ${e.message.split('\n')[0]}`);
      }
    }
    await Promise.all([lv.page.close().catch(() => {}), nv.page.close().catch(() => {})]);
    return result;
  }
}
