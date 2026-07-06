import { test } from "node:test";
import assert from "node:assert/strict";
import {
  albumKey,
  canonicalizeArtists,
  injectData,
  shapeSongs,
  trackKey,
  validateSongs,
} from "../build.mjs";

test("canonicalizeArtists: most common casing wins", () => {
  const canon = canonicalizeArtists([
    { Artist: "the beatles" },
    { Artist: "The Beatles" },
    { Artist: "The Beatles" },
  ]);
  assert.equal(canon.get("the beatles"), "The Beatles");
});

test("canonicalizeArtists: tie broken by first occurrence", () => {
  const canon = canonicalizeArtists([{ Artist: "AC/DC" }, { Artist: "Ac/Dc" }]);
  assert.equal(canon.get("ac/dc"), "AC/DC");
});

test("shapeSongs: keeps the 6 page fields, drops the rest", () => {
  const records = [{
    Name: "Song", Artist: "Artist", Album: "Album", Genre: "Rock",
    Year: "2020", songlength: 1000, Charter: "X", chartsAvailable: 5, Playlist: "P",
  }];
  const [s] = shapeSongs(records, canonicalizeArtists(records));
  assert.deepEqual(s, {
    Name: "Song", Artist: "Artist", Album: "Album", Genre: "Rock",
    Year: "2020", songlength: 1000,
  });
});

test("shapeSongs: missing fields default; non-number songlength becomes 0", () => {
  const records = [{ Name: "Song", Artist: "Artist", songlength: "3:32" }];
  const [s] = shapeSongs(records, canonicalizeArtists(records));
  assert.equal(s.Album, "");
  assert.equal(s.Genre, "");
  assert.equal(s.Year, "");
  assert.equal(s.songlength, 0);
});

test("shapeSongs: applies artist canonicalization", () => {
  const records = [
    { Name: "A", Artist: "the who" },
    { Name: "B", Artist: "The Who" },
    { Name: "C", Artist: "The Who" },
  ];
  const shaped = shapeSongs(records, canonicalizeArtists(records));
  assert.deepEqual(shaped.map((s) => s.Artist), ["The Who", "The Who", "The Who"]);
});

test("art keys: 16 hex chars, case-insensitive, album and track keys differ", () => {
  const a = albumKey("Artist", "Album");
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(a, albumKey("ARTIST", "ALBUM"));
  assert.notEqual(albumKey("Artist", "X"), trackKey("Artist", "X"));
});

test("injectData: replaces the token and escapes </script>", () => {
  const template = '<script id="song-data" type="application/json">/*__DATA__*/</script>';
  const out = injectData(template, [{ Name: "Bad </script> Name" }]);
  assert.ok(!out.includes("/*__DATA__*/"), "token replaced");
  assert.ok(!out.includes("Bad </script> Name"), "raw close tag must not appear");
  assert.ok(out.includes("Bad <\\/script> Name"), "close tag escaped for inline JSON");
});

test("injectData: songs containing replacement patterns like $& survive", () => {
  const out = injectData("/*__DATA__*/", [{ Name: "Cash $& Carry" }]);
  assert.deepEqual(JSON.parse(out), [{ Name: "Cash $& Carry" }]);
});

test("validateSongs: empty array is valid", () => {
  assert.deepEqual(validateSongs([]), []);
});

test("validateSongs: rejects non-arrays in plain language", () => {
  const errors = validateSongs({ Name: "One Song" });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /list of songs/);
});

test("validateSongs: flags missing Name/Artist with the entry's position", () => {
  const errors = validateSongs([
    { Name: "Fine", Artist: "Someone", songlength: 1000 },
    { Artist: "No Name Band" },
    { Name: "No Artist Song" },
  ]);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /Song #2/);
  assert.match(errors[0], /"Name"/);
  assert.match(errors[0], /No Name Band/, "shows a sibling field to locate the entry");
  assert.match(errors[1], /Song #3/);
  assert.match(errors[1], /"Artist"/);
});

test("validateSongs: non-numeric songlength suggests milliseconds", () => {
  const errors = validateSongs([{ Name: "S", Artist: "A", songlength: "3:32" }]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /milliseconds/);
});

test("validateSongs: non-object entries are called out", () => {
  const errors = validateSongs(["just a string"]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Song #1 is not an object/);
});
