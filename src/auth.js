// Login form auto-detect: password field khuje, tar age-r input ke username/email dhore.
// config.login.* selector dile sheta override hishebe kaj kore.
const LOGIN_PATHS = ['/', '/login', '/signin', '/sign-in', '/admin/login', '/auth/login', '/user/login'];

async function visiblePassword(page, selector) {
  let els;
  try {
    els = await page.$$(selector || 'input[type=password]');
  } catch {
    return null; // navigation cholche
  }
  for (const el of els) if (await el.isVisible().catch(() => false)) return el;
  return null;
}

// Page er bhitore username input ar submit button tag kore (data-dp-*)
function tagFields(pw) {
  const HINT = /user|e-?mail|mail|login|phone|mobile|account|member|emp|staff|\bid\b|name/i;
  const scope = pw.closest('form') || document;
  const skip = ['hidden', 'password', 'checkbox', 'radio', 'submit', 'button', 'file', 'image', 'reset'];
  const cands = [...scope.querySelectorAll('input')].filter((i) => !skip.includes(i.type) && !i.disabled && (i.offsetWidth || i.offsetHeight));
  const before = cands.filter((i) => i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING);
  const hint = (i) => HINT.test(`${i.name} ${i.id} ${i.placeholder} ${i.autocomplete} ${i.type}`);
  const pick = [...before].reverse().find(hint) || before[before.length - 1] || cands.find(hint) || cands[0];
  if (pick) pick.setAttribute('data-dp-user', '1');

  const btns = [...scope.querySelectorAll('button, input[type=submit], input[type=button], a.btn')].filter((b) => !b.disabled && (b.offsetWidth || b.offsetHeight));
  const label = (b) => `${b.innerText || ''} ${b.value || ''}`;
  const submit =
    btns.find((b) => b.type === 'submit') ||
    btns.find((b) => /log\s*-?in|sign\s*-?in|submit|continue|enter|login/i.test(label(b))) ||
    btns.find((b) => b.tagName === 'BUTTON' && b.type !== 'button');
  if (submit) submit.setAttribute('data-dp-submit', '1');
  return { user: !!pick, submit: !!submit };
}

async function openLoginForm(page, baseUrl, login) {
  const paths = login.path ? [login.path] : LOGIN_PATHS;
  for (const p of paths) {
    try {
      await page.goto(new URL(p, baseUrl).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    } catch {
      continue;
    }
    const pw = await visiblePassword(page, login.passwordSelector);
    if (pw) return pw;
  }
  throw new Error(`Login form not found (tried ${paths.join(', ')}). Setup > Login selectors e path din.`);
}

export async function createSession(browser, baseUrl, user, login = {}) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  try {
    const pw = await openLoginForm(page, baseUrl, login);

    let userField;
    let submitBtn = null;
    if (login.emailSelector) {
      userField = page.locator(login.emailSelector).first();
      if (login.submitSelector) submitBtn = page.locator(login.submitSelector).first();
    } else {
      const found = await pw.evaluate(tagFields);
      if (!found.user) throw new Error('Login: username/email field khuje pawa jayni. Setup > Login selectors e din.');
      userField = page.locator('[data-dp-user="1"]').first();
      if (found.submit) submitBtn = page.locator('[data-dp-submit="1"]').first();
    }

    await userField.fill(user.email, { timeout: 10000 });
    await pw.fill(user.password, { timeout: 10000 });
    if (submitBtn) await submitBtn.click({ timeout: 10000 });
    else await pw.press('Enter');

    // Success = password field ar dekha jay na
    let ok = false;
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(500);
      if (!(await visiblePassword(page, login.passwordSelector))) {
        ok = true;
        break;
      }
    }
    if (!ok) {
      const msg = await page
        .locator('.invalid-feedback, .alert-danger, .alert-error, .text-red-500, .text-red-600, .text-danger, .error, [role=alert]')
        .first()
        .innerText({ timeout: 1000 })
        .catch(() => '');
      throw new Error(`Login failed${msg ? `: ${msg.trim().replace(/\s+/g, ' ').slice(0, 120)}` : ' (still on login form)'}`);
    }
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    return { context, homePath: new URL(page.url()).pathname || '/' };
  } catch (e) {
    await context.close().catch(() => {});
    throw e;
  } finally {
    await page.close().catch(() => {});
  }
}
