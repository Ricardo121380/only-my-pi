// Mechanical extraction from the user-supplied design. Never executes prototype JS.
import fs from "node:fs/promises";
const source = await fs.readFile(new URL("../docs/design/glacier/pi-agent-glacier.html", import.meta.url), "utf8");
const styles = [...source.slice(0, source.indexOf("</head>")).matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/g)].map((match) => match[1]);
if (styles.length !== 2) throw new Error("Unexpected prototype style structure");
const block = source.slice(source.indexOf("const icons={"), source.indexOf("const I="));
const icons = Object.fromEntries([...block.matchAll(/'([^']+)':'([^']*)'/g)].map((match) => [match[1], match[2]]));
for (const group of source.matchAll(/Object\.assign\(icons,\s*\{([\s\S]*?)\}\)/g)) for (const match of group[1].matchAll(/'([^']+)':'([^']*)'/g)) icons[match[1]] = match[2];
for (const match of source.matchAll(/icons(?:\['([^']+)'\]|\.([\w]+))='([^']*)'/g)) icons[match[1] || match[2]] = match[3];
if (!icons.folder || !icons["panel-bottom"]) throw new Error("Missing prototype icons");
const outputs = {
  "prototype.css": "/* Generated from the original HTML; run node scripts/sync-glacier-assets.mjs. */\n" + styles.join("\n"),
  "prototype-icons.json": JSON.stringify(icons, null, 2) + "\n",
};
const check = process.argv.includes("--check");
for (const [name, content] of Object.entries(outputs)) {
  const path = new URL(`../webui/src/${name}`, import.meta.url);
  if (check) {
    if (await fs.readFile(path, "utf8") !== content) throw new Error(`${name} differs from the original HTML; regenerate assets`);
  } else await fs.writeFile(path, content);
}
console.log(`${check ? "Verified" : "Extracted"} ${styles.length} unchanged style blocks and ${Object.keys(icons).length} SVG symbols`);
