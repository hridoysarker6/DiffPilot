// Dev fixture: duita fake Laravel-moto site (legacy :5001, new :5002) with 2 roles, jate tool dry run kora jay.
// Run: node test/fake-sites.js
import express from 'express';

const USERS = { 'admin@test.com': 'admin', 'sales@test.com': 'sales' };
const ORDERS = [['1001', 'Rahim', '5,000', 'Paid'], ['1002', 'Karim', '7,500', 'Due'], ['1003', 'Salma', '3,200', 'Paid'], ['1004', 'Nasir', '900', 'Due']];

function site(port, variant) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  const roleOf = (req) => (req.headers.cookie || '').match(/role=(\w+)/)?.[1];
  const layout = (role, body) => `<!doctype html><html><head><title>App</title></head><body class="${variant}">
    <aside class="sidebar"><a href="/dashboard">Dashboard</a><a href="/orders">Orders</a>${role === 'admin' ? '<a href="/users">Users</a>' : ''}<a href="/logout">Logout</a></aside><main>${body}</main>${variant === 'new' ? '<div id="phpdebugbar"><nav><a href="#">Queries</a><a href="#">Timeline</a></nav><table><thead><tr><th>SQL</th></tr></thead><tbody><tr><td>select 1</td></tr></tbody></table></div>' : ''}</body></html>`;
  const guard = (roles) => (req, res, next) => {
    const r = roleOf(req);
    if (!r) return res.redirect('/login');
    if (roles && !roles.includes(r)) return res.status(403).send('Forbidden');
    req.role = r;
    next();
  };

  app.get('/login', (_q, res) => res.send('<form method="post" action="/login"><input name="userEmail" placeholder="User Email"><input name="pass" type="password"><button type="submit">Login</button></form>'));
  app.post('/login', (req, res) => {
    const role = USERS[req.body.userEmail];
    if (!role || req.body.pass !== 'secret') return res.status(401).send('<div class="alert-danger">Invalid credentials</div><form method="post"><input name="userEmail" placeholder="User Email"><input name="pass" type="password"><button type="submit">Login</button></form>');
    res.set('Set-Cookie', `role=${role}; Path=/`).redirect('/dashboard');
  });
  app.get('/logout', (_q, res) => res.set('Set-Cookie', 'role=; Path=/; Max-Age=0').redirect('/login'));
  app.get('/dashboard', guard(), (req, res) => res.send(layout(req.role, `<h1>Dashboard</h1><div class="stat-card">Total orders ${ORDERS.length}</div>`)));
  app.get('/orders', guard(), (req, res) => {
    let rows = ORDERS.map((o, i) => (variant === 'new' && i === 1 ? [o[0], o[1], '7,000', o[3]] : o));
    const { status, q } = req.query;
    // new site bug: status=Due filter ignored
    if (status && !(variant === 'new' && status === 'Due')) rows = rows.filter((r) => r[3] === status);
    if (q) rows = rows.filter((r) => r[1].toLowerCase().includes(q.toLowerCase()));
    const form = '<form method="get" action="/orders"><select name="status"><option value="">All</option><option>Paid</option><option>Due</option></select><input type="search" name="q" placeholder="Search customer"><button type="submit">Filter</button></form>';
    const trs = rows.map((r, i) => '<tr><td>' + (i + 1) + '</td><td>' + r[0] + '</td><td>' + r[1] + '</td><td>৳ ' + r[2] + '</td><td>' + r[3] + '</td></tr>').join('');
    res.send(layout(req.role, '<h1>Orders</h1>' + form + '<table><thead><tr><th>#</th><th>Order</th><th>Customer</th><th>Amount</th><th>Status</th></tr></thead><tbody>' + trs + '</tbody></table><p>Showing 1 to ' + rows.length + ' of ' + rows.length + ' entries</p><a href="/orders/create">New</a>'));
  });
  // new site bug: sales role forbidden on create
  app.get('/orders/create', guard(variant === 'new' ? ['admin'] : null), (req, res) =>
    res.send(layout(req.role, `<h1>Create order</h1><form method="post"><label for="c">Customer</label><input id="c" name="customer" required><select name="status"><option>Paid</option><option>Due</option>${variant === 'legacy' ? '<option>Partial</option>' : ''}</select><button type="submit">Save</button></form>`)));
  app.get('/users', guard(['admin']), (req, res) => res.send(layout(req.role, '<h1>Users</h1><table><thead><tr><th>Name</th></tr></thead><tbody><tr><td>Admin</td></tr></tbody></table>')));
  app.listen(port, () => console.log(`${variant} site on http://localhost:${port}`));
}

site(5001, 'legacy');
site(5002, 'new');
