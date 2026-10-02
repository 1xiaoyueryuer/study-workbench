import { Buffer } from "node:buffer";
import * as T from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mkdir, writeFile, readFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
// Node implementation for GLTFExporter's browser FileReader dependency.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((v) => {
      this.result = v;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((v) => {
      this.result = `data:${blob.type};base64,${Buffer.from(v).toString("base64")}`;
      this.onloadend?.();
    });
  }
};
const out = "public/assets/Collection";
await mkdir(out, { recursive: true });
const cream = new T.MeshStandardMaterial({
    color: 0xf4edda,
    roughness: 0.28,
    metalness: 0.08,
  }),
  gold = new T.MeshStandardMaterial({
    color: 0xd9b971,
    roughness: 0.27,
    metalness: 0.65,
  }),
  red = new T.MeshStandardMaterial({ color: 0xbf6559, roughness: 0.32 }),
  blue = new T.MeshStandardMaterial({
    color: 0x8bb7c5,
    roughness: 0.22,
    metalness: 0.15,
  }),
  purple = new T.MeshStandardMaterial({
    color: 0xad9bbe,
    roughness: 0.24,
    metalness: 0.25,
  });
const mesh = (g, geo, mat, x = 0, y = 0, z = 0, s = [1, 1, 1]) => {
  const m = new T.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.scale.set(...s);
  g.add(m);
  return m;
};
const sphere = (g, mat, x, y, z, s) =>
  mesh(g, new T.SphereGeometry(1, 24, 16), mat, x, y, z, s);
const ring = (g, r, t, mat, x = 0, y = 0, z = 0) =>
  mesh(g, new T.TorusGeometry(r, t, 10, 48), mat, x, y, z);
const models = {};
for (const id of [
  "shell",
  "crystal",
  "bottle",
  "moon",
  "star",
  "chest",
  "sun",
  "koi",
  "scroll",
])
  models[id] = new T.Group();
const shell = models.shell;
for (let i = 0; i < 9; i++) {
  const a = (i - 4) * 0.21;
  const rib = sphere(
    shell,
    cream,
    Math.sin(a) * 0.34,
    Math.cos(a) * 0.22,
    0,
    [0.13, 0.53, 0.14],
  );
  rib.rotation.z = -a;
}
sphere(shell, gold, 0, -0.27, 0.04, [0.18, 0.1, 0.1]);
const crystal = models.crystal;
for (let i = 0; i < 5; i++) {
  const m = mesh(
    crystal,
    new T.CylinderGeometry(0, 0.17, 0.48, 6),
    blue,
    (i - 2) * 0.18,
    0.1 + (i % 2) * 0.16,
    Math.sin(i) * 0.1,
  );
  m.rotation.z = (i - 2) * -0.15;
  mesh(
    crystal,
    new T.CylinderGeometry(0.17, 0.17, 0.38, 6),
    blue,
    m.position.x,
    m.position.y - 0.43,
    m.position.z,
  );
}
const bottle = models.bottle;
sphere(bottle, blue, 0, -0.08, 0, [0.36, 0.43, 0.3]);
mesh(bottle, new T.CylinderGeometry(0.13, 0.2, 0.28, 24), blue, 0, 0.36);
mesh(bottle, new T.CylinderGeometry(0.145, 0.145, 0.12, 24), gold, 0, 0.55);
ring(bottle, 0.15, 0.025, gold, 0, 0.43).rotation.x = Math.PI / 2;
mesh(
  bottle,
  new T.BoxGeometry(0.13, 0.32, 0.04),
  cream,
  0,
  -0.03,
  0.29,
).rotation.z = -0.25;
const moon = models.moon;
mesh(
  moon,
  new T.TorusGeometry(0.4, 0.11, 12, 48, Math.PI * 1.55),
  purple,
).rotation.z = 0.65;
sphere(moon, gold, 0.24, -0.18, 0.05, [0.09, 0.09, 0.09]);
function starShape() {
  const shape = new T.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 + Math.PI / 2,
      r = i % 2 ? 0.2 : 0.45,
      x = Math.cos(a) * r,
      y = Math.sin(a) * r;
    if (i) shape.lineTo(x, y);
    else shape.moveTo(x, y);
  }
  shape.closePath();
  return new T.ExtrudeGeometry(shape, {
    depth: 0.12,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.03,
    bevelSegments: 3,
    steps: 1,
  });
}
mesh(models.star, starShape(), purple);
ring(models.star, 0.1, 0.022, gold, 0, 0.55);
mesh(models.star, new T.CylinderGeometry(0.24, 0.3, 0.09, 32), gold, 0, -0.52);
const chest = models.chest;
mesh(chest, new T.BoxGeometry(0.82, 0.42, 0.55), cream, 0, -0.18);
const lid = mesh(
  chest,
  new T.CylinderGeometry(0.29, 0.29, 0.83, 24, 1, false, 0, Math.PI),
  gold,
  0,
  0.06,
);
lid.rotation.z = Math.PI / 2;
mesh(chest, new T.BoxGeometry(0.14, 0.24, 0.03), gold, 0, -0.02, 0.29);
for (const x of [-0.3, 0.3])
  mesh(chest, new T.BoxGeometry(0.05, 0.45, 0.57), gold, x, -0.18);
const sun = models.sun;
sphere(sun, gold, 0, 0, 0, [0.29, 0.29, 0.09]);
ring(sun, 0.36, 0.025, gold);
for (let i = 0; i < 12; i++) {
  const a = (i * Math.PI) / 6,
    m = mesh(
      sun,
      new T.ConeGeometry(0.045, 0.17, 6),
      gold,
      Math.sin(a) * 0.47,
      Math.cos(a) * 0.47,
    );
  m.rotation.z = -a;
}
mesh(sun, new T.CylinderGeometry(0.25, 0.3, 0.08, 32), cream, 0, -0.62);
const koi = models.koi;
sphere(koi, cream, 0, 0, 0, [0.45, 0.2, 0.16]);
sphere(koi, red, 0.08, 0.08, 0.03, [0.19, 0.135, 0.14]);
sphere(koi, red, -0.25, 0.02, 0.06, [0.12, 0.15, 0.12]);
for (const y of [-0.11, 0.11]) {
  const tail = mesh(koi, new T.ConeGeometry(0.2, 0.3, 3), red, -0.48, y);
  tail.rotation.z = Math.PI / 2;
}
for (const z of [-0.15, 0.15])
  sphere(
    koi,
    new T.MeshStandardMaterial({ color: 0x39433d }),
    0.31,
    0.05,
    z,
    [0.025, 0.025, 0.018],
  );
const gate = ring(koi, 0.64, 0.032, gold);
gate.scale.y = 0.95;
mesh(koi, new T.CylinderGeometry(0.46, 0.51, 0.09, 48), cream, 0, -0.7);
const scroll = models.scroll;
mesh(scroll, new T.BoxGeometry(0.65, 0.85, 0.07), cream);
for (const y of [-0.46, 0.46]) {
  const rod = mesh(
    scroll,
    new T.CylinderGeometry(0.055, 0.055, 0.85, 20),
    gold,
    0,
    y,
  );
  rod.rotation.z = Math.PI / 2;
}
mesh(scroll, new T.BoxGeometry(0.08, 0.75, 0.02), red, 0, 0, 0.05);
mesh(scroll, new T.BoxGeometry(0.3, 0.23, 0.025), red, 0, -0.17, 0.08);
for (const x of [-0.075, 0, 0.075])
  mesh(scroll, new T.BoxGeometry(0.012, 0.14, 0.01), gold, x, -0.17, 0.1);
ring(scroll, 0.12, 0.018, gold, 0, 0.59);
const exporter = new GLTFExporter();
const records = [];
for (const [id, g] of Object.entries(models)) {
  const binary = await exporter.parseAsync(g, { binary: true });
  await writeFile(`${out}/${id}.glb`, Buffer.from(binary));
  records.push({
    catalogId: id,
    source: "Original procedural design",
    author: "Study Workbench",
    license: "Project original asset",
    originalFile: "scripts/collection-assets.mjs",
    changes: "Purpose-built ceramic and metal miniature",
  });
}
for (const [id, file] of [
  ["pebble", "rock_smallA"],
  ["sprout", "plant_bushSmall"],
  ["mushroom", "mushroom_tan"],
]) {
  const source = `.artifacts/cache/assets/nature/Models/GLTF format/${file}.glb`;
  if (existsSync(source)) await copyFile(source, `${out}/${id}.glb`);
  else if (!existsSync(`${out}/${id}.glb`))
    throw new Error(
      "Restore the checked-in Kenney model or extract Nature Kit into .artifacts/cache/assets/nature",
    );
  records.push({
    catalogId: id,
    source: "https://kenney.nl/assets/nature-kit",
    author: "Kenney",
    license: "CC0-1.0",
    originalFile: `Models/GLTF format/${file}.glb`,
    changes:
      "Unmodified model; normalized scale and shared lighting at runtime",
  });
}
if (existsSync(".artifacts/cache/assets/nature/License.txt"))
  await copyFile(
    ".artifacts/cache/assets/nature/License.txt",
    `${out}/Kenney-License.txt`,
  );
const shapes = {
  pebble:
    '<ellipse cx="63" cy="73" rx="31" ry="22" fill="url(#ivory)" transform="rotate(-16 63 73)"/><path d="M43 62 Q59 48 76 58" fill="none" stroke="#fff" stroke-width="3"/>',
  shell:
    '<path d="M35 49 Q63 15 91 49 Q108 77 66 98 Q23 76 35 49" fill="url(#ivory)"/><g stroke="#c5bba4" fill="none"><path d="M66 97L43 48M66 97L55 39M66 97L67 36M66 97L79 42M66 97L91 54"/></g><ellipse cx="66" cy="95" rx="10" ry="5" fill="#c5ad78"/>',
  sprout:
    '<ellipse cx="64" cy="94" rx="25" ry="9" fill="url(#ivory)"/><path d="M64 94Q58 64 68 43" stroke="#7d9574" stroke-width="4" fill="none"/><path d="M63 74Q23 72 30 40Q65 40 63 74M65 58Q95 57 98 29Q70 28 65 58" fill="url(#green)"/>',
  mushroom:
    '<path d="M57 59L50 97Q65 105 77 97L70 58" fill="url(#ivory)"/><path d="M25 64Q31 19 64 24Q96 23 104 64Q69 82 25 64" fill="url(#gold)"/><g fill="#f4eddb"><ellipse cx="48" cy="44" rx="7" ry="5"/><ellipse cx="77" cy="38" rx="5" ry="4"/><ellipse cx="88" cy="61" rx="6" ry="3"/></g>',
  crystal:
    '<path d="M37 92L28 59L41 44L57 58L51 93M52 97L48 37L65 17L83 37L76 98M80 97L77 55L91 39L104 54L98 94" fill="url(#blue)" stroke="#7ba4b1"/><path d="M65 17L65 95M48 37L65 46L83 37" fill="none" stroke="#e1f0ee"/>',
  bottle:
    '<path d="M53 27H77V43Q107 63 94 88Q68 111 39 88Q26 67 53 43Z" fill="url(#blue)" stroke="#89abb0"/><path d="M42 74Q64 64 92 75L89 87Q64 101 42 86" fill="#bce0dd"/><rect x="52" y="18" width="26" height="12" rx="3" fill="url(#gold)"/><rect x="57" y="53" width="18" height="32" rx="3" fill="#f6f1dc" transform="rotate(-12 66 69)"/>',
  moon: '<path d="M83 24Q36 32 55 72Q65 91 94 87Q59 114 34 82Q7 43 48 21Q66 13 83 24" fill="url(#purple)"/><path d="M91 42L95 51L105 55L95 59L91 69L87 59L77 55L87 51Z" fill="url(#gold)"/>',
  star: '<ellipse cx="65" cy="103" rx="23" ry="5" fill="url(#gold)"/><path d="M65 95V105" stroke="#b49b68" stroke-width="4"/><path d="M64 21L77 46L106 51L85 72L89 101L64 87L38 100L43 71L22 50L51 46Z" fill="url(#purple)" stroke="#a792b8"/><path d="M64 21V63L22 50M64 63L89 101M64 63L106 51" stroke="#dfd1e4" fill="none"/>',
  chest:
    '<path d="M26 59Q26 27 64 27Q102 27 102 59V93Q63 108 26 92Z" fill="url(#gold)"/><path d="M27 61Q62 73 102 61V92Q63 107 27 92Z" fill="url(#ivory)"/><path d="M42 34V98M87 34V98" stroke="#c3a05b" stroke-width="7"/><rect x="58" y="61" width="14" height="20" rx="3" fill="#bc9854"/><circle cx="65" cy="71" r="2" fill="#f7edca"/>',
  sun: '<g stroke="#d1b16b" stroke-width="4"></g><circle cx="64" cy="59" r="31" fill="none" stroke="#c7a465" stroke-width="2"/><circle cx="64" cy="59" r="24" fill="url(#gold)"/><path d="M64 90V104M45 106H83" stroke="#b89d62" stroke-width="5"/>',
  koi: '<circle cx="64" cy="62" r="43" fill="none" stroke="url(#gold)" stroke-width="3"/><path d="M36 66L16 46L18 85Z" fill="url(#red)"/><ellipse cx="68" cy="62" rx="35" ry="19" fill="url(#ivory)" transform="rotate(-20 68 62)"/><path d="M47 57Q52 40 66 44L73 57Q58 69 47 57M83 46Q92 43 101 51L93 62L84 60" fill="url(#red)"/><circle cx="93" cy="53" r="2" fill="#4a4a3e"/><path d="M66 77L54 93L82 83" fill="#cc9580"/><ellipse cx="64" cy="112" rx="32" ry="5" fill="url(#gold)"/>',
  scroll:
    '<path d="M34 28H96V99H34Z" fill="url(#ivory)" stroke="#e4d6b4"/><rect x="27" y="22" width="77" height="9" rx="4" fill="url(#gold)"/><rect x="27" y="96" width="77" height="9" rx="4" fill="url(#gold)"/><path d="M65 20V98" stroke="#b95e50" stroke-width="6"/><rect x="48" y="44" width="34" height="37" rx="2" fill="url(#red)"/><text x="65" y="60" font-size="11" text-anchor="middle" fill="#ffedb8" font-family="serif">金榜</text><text x="65" y="74" font-size="11" text-anchor="middle" fill="#ffedb8" font-family="serif">题名</text>',
};
shapes.sun = shapes.sun.replace(
  '<g stroke="#d1b16b" stroke-width="4"></g>',
  `<g stroke="#d1b16b" stroke-width="3">${Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI) / 6;
    return `<path d="M${64 + Math.cos(a) * 37} ${59 + Math.sin(a) * 37}L${64 + Math.cos(a) * 44} ${59 + Math.sin(a) * 44}"/>`;
  }).join("")}</g>`,
);
for (const [id, shape] of Object.entries(shapes)) {
  const gradients = [
    ["ivory", "#fffdf4", "#d2cbb8"],
    ["gold", "#f6e4ab", "#b9944f"],
    ["green", "#c0d5a4", "#709475"],
    ["blue", "#d5eeec", "#78a5b9"],
    ["purple", "#e7d9ec", "#a691b9"],
    ["red", "#e1a087", "#b4574d"],
  ]
    .map(
      ([id, a, b]) =>
        `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`,
    )
    .join("");
  await writeFile(
    `${out}/${id}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs>${gradients}</defs><ellipse cx="64" cy="112" rx="34" ry="5" fill="#6d8279" opacity=".09"/>${shape}</svg>`,
  );
}
for (const r of records) {
  const bytes = await readFile(`${out}/${r.catalogId}.glb`);
  r.sha256 = createHash("sha256").update(bytes).digest("hex");
  r.bytes = bytes.length;
  r.thumbnail = `${r.catalogId}.svg`;
  r.thumbnailAuthor = "Study Workbench original vector illustration";
}
await writeFile(`${out}/sources.json`, JSON.stringify(records, null, 2));
console.log(records.map((r) => `${r.catalogId}: ${r.bytes}`).join("\n"));
