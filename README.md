# YARG Song List

A fast, static, single-page song list for your [YARG](https://github.com/YARC-Official/YARG)
library — built from YARG's native `songs.json` file and published to GitHub Pages. Share it with friends so they can browse your YARG song library from any device.

## Features

- Sortable by artist or song title
- Artists can be collapsed so you can easily browse what artists are available
- Search bar for song and artist names
- Genre multi-select filter
- "Pick a Random Song" button
- Album art fetched via the Deezer API and added to the deployed web page
- Responsive website that looks great on mobile
- 100% static web page

## Demo

**See an example of a published page here: <https://turnfouromni.github.io/yarg-song-list-demo>**

## How to create your own

You don't need to install anything — everything happens on github.com.

1. **Export your song list from YARG** — in YARG, go to
   **Settings → All Settings → File Management → Ouvert (JSON)** and save the
   `songs.json` file somewhere you can find again.
2. **Get a GitHub account** (free) at <https://github.com/signup> if you don't
   have one.
3. At the top of this repository's page, click the green **Use this template**
   button, then **Create a new repository**.
4. Give it a name (this becomes part of your page's web address — e.g.
   `my-song-list`) and make sure visibility is set to **Public**.
   GitHub Pages is only available for private repositories on paid plans — see
   [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).
5. **IMPORTANT — Turn on GitHub Pages** — in your new repository, open
   **Settings → Pages** and under **Build and deployment** set **Source** to
   **GitHub Actions**.
6. Back on the repository's main page, click on `songs.json`, then the
   **pencil icon** (Edit this file). Replace the `[]` with the contents of
   the file you exported in step 1 and click **Commit changes**.
7. That's it. GitHub now builds your page: click the **Actions** tab to watch
   it (the first run takes a few minutes while album art downloads).
8. When the run turns green, your list is live at:

   ```
   https://<your-username>.github.io/<repository-name>/
   ```

   e.g. `https://janedoe.github.io/my-song-list/`. The link also appears on
   the workflow run and under **Settings → Pages**.

Every time you edit `songs.json` and commit, the page republishes itself
within a couple of minutes.

## How album art works

At build time, covers are looked up on the free Deezer API (no key needed) by
album, falling back to a per-track search, and saved under `art/`. In CI that
folder is persisted with `actions/cache`, so only new albums are fetched on
later builds. If the cache expires, art is simply re-fetched on the next run —
no action needed. Covers remain the property of their owners and are
self-hosted only for display alongside the song list.

## Local development

Requires Node 20+ (Node 22 recommended — matches CI).

```sh
node build.mjs           # build dist/index.html (fetches art for new albums)
NO_ART=1 node build.mjs  # offline build — skip all art lookups
```

Open `dist/index.html` directly in a browser to preview. On Windows
PowerShell, set the env var with `$env:NO_ART = "1"` first.

### Tests

```sh
npm ci        # installs jsdom (dev-only; the app itself has no dependencies)
npm test      # unit + build-integration + DOM tests (node:test)
```

- `test/unit.test.mjs` — build helpers: artist canonicalization, field
  trimming, art cache keys, data injection/escaping, songs.json validation
- `test/build.test.mjs` — runs the real build against fixtures and checks the
  emitted page
- `test/dom.test.mjs` — loads the built page in jsdom and exercises search,
  sorting, collapsing, filters, the random-song modal, and the empty state

CI (`.github/workflows/ci.yml`) runs the suite on every pull request; the
deploy workflow runs it before every deploy, so a red test never ships.

## FAQ

**The site didn't deploy on my new repo.**
Almost always step 5 above: GitHub Pages must be switched on by hand once.
Open **Settings → Pages** and under **Build and deployment** set **Source**
to **GitHub Actions**, then re-run the failed workflow from the **Actions**
tab (or just commit any change). Also remember the repository must be public
on the free plan.

**Some songs have no album art.**
The Deezer lookup found no match for that album/track — usually a spelling
mismatch. Fixing the `Album` or `Artist` spelling and pushing again re-tries
those songs only.

## Credits

- **[YARG (Yet Another Rhythm Game)](https://github.com/YARC-Official/YARG)**
  by [YARC](https://yarg.in/) — the free, open-source rhythm game this list is
  built for. The instrument icons in the header are YARG's official icons
  (LGPL-3.0) — see [ATTRIBUTION.md](ATTRIBUTION.md). This project is not
  affiliated with or endorsed by YARC.
- **[Deezer API](https://developers.deezer.com/api)** — free, keyless album
  art lookup.

## License

MIT — see [LICENSE](LICENSE). The instrument icons in `assets/icons/` are
LGPL-3.0 (see [ATTRIBUTION.md](ATTRIBUTION.md)).
