// After tsc: add ".js" to relative imports in dist/, so the published package works in plain Node ESM.
// (The source keeps extensionless imports, which the app's bundler and tsx need.)
import { readdir, readFile, writeFile } from "node:fs/promises";
const dir = new URL("./dist/", import.meta.url);
for (const f of await readdir(dir)) {
  if (!/\.(js|d\.ts)$/.test(f)) continue;
  const p = new URL(f, dir);
  const s = await readFile(p, "utf8");
  await writeFile(p, s.replace(/(from\s+["'])(\.\/[^"'.]+)(["'])/g, "$1$2.js$3"));
}
