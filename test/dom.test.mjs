import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { JSDOM, VirtualConsole } from "jsdom";
import { buildFixture } from "./helpers.mjs";

// The page's inline script runs on load. A listener-less VirtualConsole
// swallows jsdom's "not implemented" noise (window.scrollTo etc).
async function loadPage(fixtureName) {
  const { html } = await buildFixture(fixtureName);
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "http://localhost/",
    virtualConsole: new VirtualConsole(),
  });
  return dom.window;
}

const songRows = (doc) =>
  doc.querySelectorAll("tbody tr:not(.artist-sep):not(.alpha-sep)");

test("renders all songs grouped by artist on load", async () => {
  const { document } = await loadPage("songs.sample.json");
  assert.equal(songRows(document).length, 4);
  assert.equal(document.getElementById("count").textContent, "4 of 4 songs");
  const artists = [...document.querySelectorAll(".artist-sep")].map((tr) =>
    tr.getAttribute("data-artist")
  );
  assert.deepEqual(artists, ["The Testers", "Zeta Band"], "casing variants merged into one group");
});

test("song names with </script> in them render intact", async () => {
  const { document } = await loadPage("songs.sample.json");
  const names = [...document.querySelectorAll(".t-name")].map((td) => td.textContent);
  assert.ok(names.includes("Alpha </script> Song"), `got: ${names.join(", ")}`);
});

test("search filters the list (debounced input)", async () => {
  const window = await loadPage("songs.sample.json");
  const { document } = window;
  const search = document.getElementById("search");
  search.value = "delta";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await delay(250); // page debounces input by 90ms
  assert.equal(songRows(document).length, 1);
  assert.equal(document.getElementById("count").textContent, "1 of 4 songs");
  assert.equal(document.querySelector(".t-name").textContent, "Delta");
});

test("search with no matches shows the filter empty state", async () => {
  const window = await loadPage("songs.sample.json");
  const { document } = window;
  const search = document.getElementById("search");
  search.value = "zzzz no such song";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await delay(250);
  assert.match(document.querySelector(".empty").textContent, /No songs match your filters/);
});

test("sorting by song name switches to letter buckets", async () => {
  const { document } = await loadPage("songs.sample.json");
  const nameHeader = document.querySelector('th.sortable[data-sort="name"]');
  nameHeader.click();
  assert.equal(document.querySelectorAll(".artist-sep").length, 0);
  assert.ok(document.querySelectorAll(".alpha-sep").length > 0, "letter separators shown");
  assert.equal(songRows(document).length, 4, "all songs still listed");
});

test("collapsing an artist hides its songs", async () => {
  const { document } = await loadPage("songs.sample.json");
  document.querySelector('.artist-sep[data-artist="The Testers"]').click();
  assert.equal(songRows(document).length, 1, "only Zeta Band's song remains visible");
});

test("random modal opens with a song", async () => {
  const { document } = await loadPage("songs.sample.json");
  document.getElementById("random-btn").click();
  assert.equal(document.getElementById("random-modal").hidden, false);
  assert.ok(document.querySelector(".rand-title").textContent.length > 0);
});

test("genre filter panel lists the fixture genres", async () => {
  const { document } = await loadPage("songs.sample.json");
  const genres = [...document.querySelectorAll("#genre-panel input")].map((i) => i.value);
  assert.deepEqual(genres, ["Metal", "Pop", "Rock"]);
});

test("empty songs.json: friendly empty state, random disabled, no crash", async () => {
  const { document } = await loadPage("songs.empty.json");
  assert.match(document.querySelector(".empty").textContent, /No songs yet/);
  assert.equal(document.getElementById("count").textContent, "0 of 0 songs");
  assert.equal(document.getElementById("random-btn").disabled, true);
});
