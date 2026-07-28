/* 檢查 sw.js 的快取清單有沒有跟實際檔案脫節。
   漏一個 js 檔，離線時那個模組就載不到 —— 而且只有在真的離線時才會發現。
   執行：node tools/audit-sw.mjs */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));

const walk = d => fs.readdirSync(d, {withFileTypes:true})
  .flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const norm = f => "./" + f.split(path.sep).join("/");

const sw = fs.readFileSync("sw.js", "utf8");
const listed = [...sw.matchAll(/"(\.\/[^"]+)"/g)].map(m => m[1]);

const shouldCache = [
  ...walk("js").map(norm),
  ...walk("icons").map(norm),
  "./index.html", "./samples.html", "./css/app.css",
  "./vendor/vexflow.js", "./manifest.webmanifest"
];

const missing = shouldCache.filter(f => !listed.includes(f));
const stale = listed.filter(f => f !== "./" && !fs.existsSync(f.slice(2)));

console.log("應快取:", shouldCache.length, "| SW 已列:", listed.length);
if (missing.length) console.log("✗ SW 漏掉:\n  " + missing.join("\n  "));
if (stale.length) console.log("✗ SW 列了不存在的檔案:\n  " + stale.join("\n  "));
if (!missing.length && !stale.length) console.log("✓ 快取清單與實際檔案完全一致");
process.exit(missing.length || stale.length ? 1 : 0);
