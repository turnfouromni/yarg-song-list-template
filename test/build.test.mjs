import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSongs } from "../build.mjs";
import { buildFixture } from "./helpers.mjs";

// Pull the inlined JSON back out of the built page.
function extractData(html) {
  const m = /<script id="song-data" type="application\/json">(.*?)<\/script>/s.exec(html);
  assert.ok(m, "song-data script tag present");
  return JSON.parse(m[1].replace(/<\\\//g, "</"));
}

test("build: inlines fixture songs into dist/index.html", async () => {
  const { distDir, html } = await buildFixture("songs.sample.json");
  assert.ok(!html.includes("/*__DATA__*/"), "data token replaced");
  assert.ok(!html.includes("/*__CSS__*/") && html.includes(".yarg-icons"), "CSS inlined");
  assert.ok(!html.includes("/*__JS__*/") && html.includes("function render()"), "JS inlined");
  const songs = extractData(html);
  assert.equal(songs.length, 4);
  assert.equal(songs[1].Artist, "The Testers", "artist casing canonicalized");
  assert.equal(songs[0].Charter, undefined, "extra fields dropped");
  assert.equal(songs[3].songlength, 0, "missing songlength defaults to 0");
  assert.ok(existsSync(join(distDir, ".nojekyll")), ".nojekyll emitted for Pages");
  assert.ok(existsSync(join(distDir, "assets", "icons", "guitar.png")), "assets copied");
});

test("build: output only references relative URLs", async () => {
  const { html } = await buildFixture("songs.sample.json");
  for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (url.startsWith("data:")) continue;
    assert.ok(!/^(\/|https?:)/.test(url), `non-relative URL in output: ${url}`);
  }
});

test("build: empty songs.json produces a valid page", async () => {
  const { distDir, html } = await buildFixture("songs.empty.json");
  assert.deepEqual(extractData(html), []);
  assert.ok(existsSync(join(distDir, ".nojekyll")));
});

test("loadSongs: invalid JSON gets a friendly error with a line pointer", () => {
  const dir = mkdtempSync(join(tmpdir(), "yarg-songs-test-"));
  const p = join(dir, "songs.json");
  writeFileSync(p, '[\n  { "Name": "A", "Artist": "B" },\n]\n');
  assert.throws(() => loadSongs(p), (e) => {
    assert.match(e.message, /not valid JSON/);
    assert.match(e.message, /missing comma|trailing comma/);
    return true;
  });
});

test("loadSongs: schema problems are all reported at once", () => {
  const dir = mkdtempSync(join(tmpdir(), "yarg-songs-test-"));
  const p = join(dir, "songs.json");
  writeFileSync(p, JSON.stringify([{ Artist: "No Name" }, { Name: "No Artist" }]));
  assert.throws(() => loadSongs(p), (e) => {
    assert.match(e.message, /2 problems/);
    assert.match(e.message, /Song #1/);
    assert.match(e.message, /Song #2/);
    return true;
  });
});
