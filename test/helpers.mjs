import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../build.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..");
export const fixture = (name) => join(HERE, "fixtures", name);

// Run the real build against a fixture songs.json, into a temp dir, offline.
export async function buildFixture(fixtureName) {
  const dir = mkdtempSync(join(tmpdir(), "yarg-songs-test-"));
  const distDir = join(dir, "dist");
  await build({
    songsPath: fixture(fixtureName),
    templatePath: join(ROOT, "src", "index.html"),
    artDir: join(dir, "art"),
    distDir,
    assetsDir: join(ROOT, "assets"),
    noArt: true,
    quiet: true,
  });
  return { dir, distDir, html: readFileSync(join(distDir, "index.html"), "utf8") };
}
