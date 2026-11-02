# DiffPilot

Legacy (Laravel 8) vs new (Laravel 13) site parity tester. Role-wise login kore duita site er protita page compare kore: access (HTTP status), table data, form field, pagination total, error, menu. Theme, colour ba pixel compare kore na. Screenshot shudhu proof.

## Run (local)
Node 20+ lagbe.

```
start.bat            # first run e npm install + chromium install, tarpor http://localhost:4000
```
ba:
```
npm run setup
npm start
```
CLI: `npm run cli -- --role=admin,sales` (report `runs/<id>/report.html` e).

## Use
1. **Setup**: Legacy ar New URL, test user (role, email, password) add korun. Route list optional, na dile login er por menu/link crawl kore page khuje nibe.
2. **Run**: role select kore Start.
3. **Results**: filter, row click kore Legacy vs New diff ar screenshot. **Role matrix**: role x page grid.
4. Export: Excel ba HTML report (`runs/<id>/`).

## Config
`config.yaml`. Login field auto-detect hoy (password field, tar age-r input, submit button). Auto-detect fail korle `login.*` e selector din. `ignore.text` (regex) diye timestamp/format noise cell compare theke bad din, `ignore.columns` diye column, `ignore.paths` diye page.

## Notes
- Normal page shudhu GET kore dekhe, create/edit form submit kore na (same DB te data pollute hobe na).
- Filter test: page-er dropdown option ar search box duita site-e apply kore table row ar total milay. Shudhu "Filter/Search/Apply" button wala form click kore, Save/Delete type button kokhono click kore na. Setup-e on/off ar limit (max options, max filters) ache.
- Password `config.yaml` e plain text e thake; dashboard default e shudhu localhost e khola. `HOST=0.0.0.0` diye onno PC theke khola jay, kintu tokhon auth nai.
- Dynamic page (`/orders/123`) crawl e pattern-pro ekta sample nei. Beshi coverage er jonno `routes` dian.
- CAPTCHA/2FA support nai; test user der jonno eta bondho rakhun.
