import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
let content = `积水书房 ${lock.version} — Third-party notices\n\n`;
for (const [path, pkg] of Object.entries(lock.packages)) {
  if (!path || pkg.dev) continue;
  const name = path.split("node_modules/").at(-1);
  content += `\n\n===== ${name} ${pkg.version} (${pkg.license ?? "See license"}) =====\n`;
  try {
    const files = await readdir(path);
    const license = files.find((f) => /^licen[sc]e(\.|$)/i.test(f));
    if (license) content += await readFile(join(path, license), "utf8");
  } catch {
    /* Optional dependencies may target other systems. */
  }
}
content +=
  "\n\n===== Water background artwork =====\n" +
  (await readFile("public/assets/Water/README.md", "utf8"));
content +=
  "\n\n===== Collectibles =====\n" +
  (await readFile("public/assets/Collection/Kenney-License.txt", "utf8")) +
  "\n" +
  (await readFile("public/assets/Collection/sources.json", "utf8"));
for (const name of ["Lucide", "Phosphor", "Tabler"])
  content +=
    `\n\n===== ${name} artwork =====\n` +
    (await readFile(`public/assets/${name}/LICENSE`, "utf8"));
content +=
  "\n\n===== Botanical artwork =====\n" +
  (await readFile("public/assets/Botanical/README.md", "utf8"));
content +=
  '\n\n===== shadcn/ui adapted component patterns (MIT) =====\nCopyright (c) 2023 shadcn\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n';
await writeFile("THIRD_PARTY_NOTICES.txt", content);
await writeFile(
  "public/licenses.html",
  '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>第三方许可</title><style>body{max-width:1000px;margin:40px auto;padding:20px;font:14px/1.7 sans-serif;background:#f6f6ef}pre{white-space:pre-wrap}</style><h1>第三方许可与素材来源</h1><pre>' +
    content.replaceAll("&", "&amp;").replaceAll("<", "&lt;") +
    "</pre>",
);
