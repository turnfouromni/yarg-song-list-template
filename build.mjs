// Build: assemble src/ (index.html + style.css + app.js) and songs.json into
// a single self-contained dist/index.html, and download
// album art from the Deezer API (no key) at build time, self-hosted under art/.
//
//   node build.mjs            normal build (downloads art for new albums)
//   NO_ART=1 node build.mjs   skip all network; use whatever art is cached
//
// Downloaded covers live in ./art/ (gitignored). In CI the folder is restored
// from actions/cache, so only new albums are looked up; locally it just
// accumulates between builds.
//
// This file doubles as a library: the pure helpers and `build()` are exported
// for the test suite, and the CLI entry at the bottom only runs when the file
// is executed directly (`node build.mjs`).
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

// --- Merge artists that differ only by casing (most common spelling wins) ---
export function canonicalizeArtists(records) {
  const groups = new Map();
  records.forEach((s, i) => {
    const a = s.Artist || "";
    const key = a.toLowerCase();
    if (!groups.has(key)) groups.set(key, new Map());
    const v = groups.get(key);
    if (!v.has(a)) v.set(a, { count: 0, order: i });
    v.get(a).count++;
  });
  const canon = new Map();
  for (const [key, variants] of groups) {
    let best = null;
    for (const [variant, info] of variants) {
      if (!best || info.count > best.count || (info.count === best.count && info.order < best.order)) {
        best = { variant, count: info.count, order: info.order };
      }
    }
    canon.set(key, best.variant);
  }
  return canon;
}

// --- Trim to the fields the page uses ---
export function shapeSongs(records, canon) {
  const canonArtist = (a) => canon.get((a || "").toLowerCase()) || a || "";
  return records.map((s) => ({
    Name: s.Name || "",
    Artist: canonArtist(s.Artist),
    Album: s.Album || "",
    Genre: s.Genre || "",
    Year: s.Year || "",
    songlength: typeof s.songlength === "number" ? s.songlength : 0,
  }));
}

// --- songs.json validation (template users hand-edit this file) ---
// Returns a list of human-readable problems; empty list = valid. Extra fields
// (Charter, chartsAvailable, Playlist, ...) are allowed and simply ignored.
export function validateSongs(records) {
  if (!Array.isArray(records)) {
    return ['songs.json must be a list of songs: it should start with "[" and end with "]".'];
  }
  const errors = [];
  const describe = (s) => {
    for (const f of ["Name", "Artist", "Album"]) {
      if (s && typeof s[f] === "string" && s[f]) return `${f}: "${s[f]}"`;
    }
    return "no recognizable fields";
  };
  records.forEach((s, i) => {
    const where = `Song #${i + 1} (${describe(s)})`;
    if (s === null || typeof s !== "object" || Array.isArray(s)) {
      errors.push(`Song #${i + 1} is not an object — each entry must look like {"Name": "...", "Artist": "..."}.`);
      return;
    }
    if (!s.Name || typeof s.Name !== "string") errors.push(`${where} is missing "Name" (the song title).`);
    if (!s.Artist || typeof s.Artist !== "string") errors.push(`${where} is missing "Artist".`);
    if (s.songlength !== undefined && typeof s.songlength !== "number") {
      errors.push(`${where} has a non-numeric "songlength" — use milliseconds (e.g. 3:32 = 212000), or omit it.`);
    }
  });
  return errors;
}

// Point at the offending line when songs.json isn't valid JSON.
function friendlyJsonError(text, err) {
  let where = "";
  const m = /position (\d+)/.exec(err.message);
  if (m) {
    const pos = Math.min(Number(m[1]), text.length);
    const before = text.slice(0, pos);
    const line = before.split("\n").length;
    const lineText = (text.split("\n")[line - 1] || "").trim().slice(0, 80);
    where = `\n  Around line ${line}: ${lineText}`;
  }
  return (
    `songs.json is not valid JSON: ${err.message}${where}\n` +
    `  Common causes: a missing comma between songs, a trailing comma after the\n` +
    `  last song, or unquoted text. Paste the file into https://jsonlint.com to\n` +
    `  find the exact spot.`
  );
}

export function loadSongs(songsPath) {
  const text = readFileSync(songsPath, "utf8");
  let records;
  try {
    records = JSON.parse(text);
  } catch (e) {
    throw new Error(friendlyJsonError(text, e));
  }
  const errors = validateSongs(records);
  if (errors.length) {
    throw new Error(`songs.json has ${errors.length} problem${errors.length === 1 ? "" : "s"}:\n  - ${errors.join("\n  - ")}`);
  }
  return records;
}

// --- Album art via Deezer (downloaded + self-hosted) ---
// Covers are stored under art/<hash>.jpg and reused across builds. The manifest
// has two maps: album covers (shared by every song on the album) and, as a
// fallback, per-song covers found by searching the track when the album misses.
// A value of null means "looked up, none found" (so we don't re-query).
export const albumKey = (artist, album) =>
  createHash("md5").update((artist + "\n" + album).toLowerCase()).digest("hex").slice(0, 16);
export const trackKey = (artist, song) =>
  createHash("md5").update(("track\n" + artist + "\n" + song).toLowerCase()).digest("hex").slice(0, 16);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const coverOf = (o) => (o ? (o.cover_big || o.cover_medium || o.cover || null) : null);

// Lookups run concurrently (ART_CONCURRENCY at a time), but every Deezer API
// call still waits for a global slot spaced API_SPACING_MS apart, so total
// request rate stays under Deezer's public limit (50 per 5 s per IP) no matter
// how many workers are in flight.
export const ART_CONCURRENCY = 4;
const API_SPACING_MS = 130;
let apiSlot = Promise.resolve();
const takeApiSlot = () => { const mine = apiSlot; apiSlot = mine.then(() => sleep(API_SPACING_MS)); return mine; };

// Run worker(item) over items with at most `limit` in flight.
async function runPool(items, limit, worker) {
  let i = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await worker(items[i++]);
  });
  await Promise.all(lanes);
}

async function deezer(path, q) {
  await takeApiSlot();
  const u = "https://api.deezer.com/" + path + "?limit=1&q=" + encodeURIComponent(q);
  const res = await fetch(u, { headers: { "User-Agent": "YARGSongList/1.0" } });
  if (res.status === 429) throw new Error("429"); // caller backs off
  if (!res.ok) return null;
  const json = await res.json();
  return json && json.data && json.data[0] ? json.data[0] : null;
}
async function albumCover(artist, album) {
  const a = (await deezer("search/album", `artist:"${artist}" album:"${album}"`)) ||
            (await deezer("search/album", `${artist} ${album}`));
  return coverOf(a);
}
// Fallback: search the track by song + artist and take that track's album cover.
async function trackCover(artist, song) {
  const t = (await deezer("search", `artist:"${artist}" track:"${song}"`)) ||
            (await deezer("search", `${artist} ${song}`));
  return t && t.album ? coverOf(t.album) : null;
}

// --- Inline the song data into the template ---
export function injectData(template, songsWithArt) {
  const json = JSON.stringify(songsWithArt).replace(/<\//g, "<\\/");
  return template.replace("/*__DATA__*/", () => json);
}

export async function build(opts = {}) {
  const {
    songsPath = join(ROOT, "songs.json"),
    templatePath = join(ROOT, "src", "index.html"),
    artDir = join(ROOT, "art"),
    distDir = join(ROOT, "dist"),
    assetsDir = join(ROOT, "assets"),
    noArt = process.env.NO_ART === "1",
    quiet = false,
  } = opts;

  mkdirSync(artDir, { recursive: true });

  // Assemble the page: src/ keeps CSS and JS in their own files for editing,
  // but the output stays a single self-contained index.html.
  const srcDir = dirname(templatePath);
  const css = readFileSync(join(srcDir, "style.css"), "utf8");
  const js = readFileSync(join(srcDir, "app.js"), "utf8");
  if (js.includes("</script>")) {
    throw new Error('src/app.js must not contain a literal "</script>" — it is inlined into the page. Split the string, e.g. "</scr" + "ipt>".');
  }
  const template = readFileSync(templatePath, "utf8")
    .replace("/*__CSS__*/", () => css)
    .replace("/*__JS__*/", () => js);
  const records = loadSongs(songsPath);
  const songs = shapeSongs(records, canonicalizeArtists(records));

  const manifestPath = join(artDir, "manifest.json");
  let manifest = { albums: {}, tracks: {} };
  if (existsSync(manifestPath)) {
    try {
      const m = JSON.parse(readFileSync(manifestPath, "utf8"));
      // Migrate the old flat shape ({key: file}) into { albums, tracks }.
      manifest = (m.albums || m.tracks) ? { albums: m.albums || {}, tracks: m.tracks || {} } : { albums: m, tracks: {} };
    } catch { /* rebuild */ }
  }

  async function download(coverUrl, file) {
    const res = await fetch(coverUrl);
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 512) return false; // guard against empty/placeholder blobs
    writeFileSync(join(artDir, file), buf);
    return true;
  }

  // Resolve one cover into `store[key]` (a filename, or null if none). Returns
  // the filename if art is present after the call, else null.
  async function resolve(store, key, getCover) {
    const file = key + ".jpg";
    if (existsSync(join(artDir, file))) { store[key] = file; return file; }
    if (store[key] === null) return null;   // known miss
    if (noArt) return null;                 // offline build
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const cover = await getCover();
        if (!cover) { store[key] = null; return null; }
        if (await download(cover, file)) { store[key] = file; return file; }
        store[key] = null; return null;
      } catch (e) {
        await sleep(1500 * (attempt + 1)); // back off on 429/network hiccup
      }
    }
    return null;
  }

  const log = quiet ? () => {} : (...a) => console.log(...a);

  // Pass 1: one lookup per unique album.
  const albums = new Map(); // key -> { artist, album }
  for (const s of songs) {
    if (!s.Album) continue;
    const key = albumKey(s.Artist, s.Album);
    if (!albums.has(key)) albums.set(key, { artist: s.Artist, album: s.Album });
  }
  const isCached = (store, key) => existsSync(join(artDir, key + ".jpg")) || store[key] === null;
  let netCalls = 0;
  const albumsPending = [...albums.keys()].filter((k) => !isCached(manifest.albums, k)).length;
  if (noArt) log("NO_ART=1 — skipping album art downloads, using cached art only");
  else if (albumsPending) log(`Fetching album art: ${albumsPending} album${albumsPending === 1 ? "" : "s"} to look up (${albums.size - albumsPending} already cached)`);
  else log(`Album art: all ${albums.size} albums already cached`);
  let albumsDone = 0;
  await runPool([...albums], ART_CONCURRENCY, async ([key, { artist, album }]) => {
    const cached = isCached(manifest.albums, key);
    const file = await resolve(manifest.albums, key, () => albumCover(artist, album));
    if (!cached && !noArt) {
      netCalls++;
      log(`  [${++albumsDone}/${albumsPending}] ${artist} — ${album}: ${file ? "downloaded" : "no cover found"}`);
    }
  });

  // Pass 2: for songs whose album had no art, fall back to a per-song track
  // lookup. Deduped by key so concurrent workers never race the same track.
  const needsTrack = (s) => s.Name && !(s.Album && manifest.albums[albumKey(s.Artist, s.Album)]);
  const trackJobs = new Map(); // key -> song
  for (const s of songs) {
    if (!needsTrack(s)) continue;
    const key = trackKey(s.Artist, s.Name);
    if (!trackJobs.has(key)) trackJobs.set(key, s);
  }
  const tracksPending = [...trackJobs.keys()].filter((k) => !isCached(manifest.tracks, k)).length;
  if (tracksPending && !noArt) log(`Track fallback: ${tracksPending} song${tracksPending === 1 ? "" : "s"} without album art to look up`);
  let tracksDone = 0;
  await runPool([...trackJobs], ART_CONCURRENCY, async ([key, s]) => {
    const cached = isCached(manifest.tracks, key);
    const file = await resolve(manifest.tracks, key, () => trackCover(s.Artist, s.Name));
    if (!cached && !noArt) {
      netCalls++;
      log(`  [${++tracksDone}/${tracksPending}] ${s.Artist} — ${s.Name}: ${file ? "downloaded" : "no cover found"}`);
    }
  });

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 0));

  // Per-song art filename: album cover first, else the track fallback.
  const artFile = (s) => {
    if (s.Album) { const f = manifest.albums[albumKey(s.Artist, s.Album)]; if (f) return f; }
    return manifest.tracks[trackKey(s.Artist, s.Name)] || null;
  };

  // --- Emit dist ---
  mkdirSync(distDir, { recursive: true });
  mkdirSync(join(distDir, "art"), { recursive: true });

  // Attach the art path (or null) to each song, then inline the data.
  const withArt = songs.map((s) => {
    const file = artFile(s);
    return { ...s, art: file ? "art/" + file : null };
  });
  const out = injectData(template, withArt);
  writeFileSync(join(distDir, "index.html"), out);
  writeFileSync(join(distDir, ".nojekyll"), "");

  // Copy only the covers actually referenced into the deploy artifact.
  const used = new Set(withArt.map((s) => s.art).filter(Boolean).map((p) => p.slice(4))); // strip "art/"
  for (const file of used) cpSync(join(artDir, file), join(distDir, "art", file));

  // Copy static assets (header instrument icons, etc.).
  if (existsSync(assetsDir)) cpSync(assetsDir, join(distDir, "assets"), { recursive: true });

  const withCount = withArt.filter((s) => s.art).length;
  const viaTrack = withArt.filter((s) => s.art && !(s.Album && manifest.albums[albumKey(s.Artist, s.Album)])).length;
  if (!quiet) {
    console.log(
      `Built dist/index.html — ${songs.length} songs, ${(out.length / 1024).toFixed(0)} KB\n` +
      `Album art: ${albums.size} unique albums | ${withCount}/${songs.length} songs have art ` +
      `(${viaTrack} via track fallback) | ${netCalls} network lookups this run`
    );
  }
  return { songs: withArt, netCalls };
}

// CLI entry: only when run directly (`node build.mjs`), not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await build();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
