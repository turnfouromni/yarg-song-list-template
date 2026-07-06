# Contributing

Thanks for helping out! A few ground rules keep this project easy to maintain:

- **Zero runtime dependencies.** The built page and `build.mjs` use only Node
  built-ins and vanilla HTML/CSS/JS. devDependencies are fine for tests and
  tooling, but nothing may be required to build or view the site.
- **Run the tests.** `npm ci && npm test` must pass (Node 20+). Pull requests
  run the suite automatically via `.github/workflows/ci.yml`.
- **Add tests with behavior changes.** New UI behavior gets a DOM test in
  `test/dom.test.mjs`; build changes get unit or integration coverage.
- **Keep it small.** This is a single-page tool — prefer deleting code to
  adding abstractions.

To work on the UI, edit `src/index.html` (markup), `src/style.css`, or
`src/app.js` — the build inlines all three into one self-contained page. Then
`NO_ART=1 node build.mjs` and open `dist/index.html`. The test fixtures in `test/fixtures/` give you a tiny
song list to develop against.
