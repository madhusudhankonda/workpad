import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const packageJson = await readJson("package.json");
const sourceManifest = await readJson("manifest.json");
const publicManifest = await readJson("public/manifest.json");
const builtManifest = await readJson("dist/manifest.json");

const failures = [];
if (JSON.stringify(sourceManifest) !== JSON.stringify(publicManifest)) failures.push("manifest.json and public/manifest.json differ");
if (JSON.stringify(publicManifest) !== JSON.stringify(builtManifest)) failures.push("dist/manifest.json is stale; rebuild the extension");
if (sourceManifest.version !== packageJson.version) failures.push("package and manifest versions differ");
if (process.env.RELEASE_TAG && process.env.RELEASE_TAG !== `v${packageJson.version}`) failures.push(`release tag ${process.env.RELEASE_TAG} does not match package version v${packageJson.version}`);
if (sourceManifest.manifest_version !== 3) failures.push("Chrome Manifest V3 is required");
if (sourceManifest.permissions?.includes("<all_urls>") || sourceManifest.host_permissions?.includes("<all_urls>")) failures.push("broad <all_urls> access is not allowed");
if (!sourceManifest.content_security_policy?.extension_pages?.includes("object-src 'none'")) failures.push("extension CSP must block object sources");

for (const legalFile of ["privacy.html", "terms.html", "refunds.html", "support.html", "delete-account.html"]) {
  try { await stat(resolve(root, "docs", legalFile)); }
  catch { failures.push(`docs/${legalFile} is missing`); }
}

for (const size of [16, 32, 48, 128]) {
  const iconPath = resolve(root, `dist/icons/icon-${size}.png`);
  try { if ((await stat(iconPath)).size === 0) failures.push(`icon-${size}.png is empty`); }
  catch { failures.push(`icon-${size}.png is missing`); }
}

try { if ((await stat(resolve(root, "store-assets/small-promo-440x280.png"))).size === 0) failures.push("Chrome Web Store promotional image is empty"); }
catch { failures.push("Chrome Web Store promotional image is missing"); }

const walk = async (directory) => (await Promise.all((await readdir(directory, { withFileTypes: true })).map(async (entry) => {
  const path = resolve(directory, entry.name);
  return entry.isDirectory() ? walk(path) : path;
}))).flat();
const files = await walk(resolve(root, "dist"));
const forbiddenNames = new Set([".env", ".env.local", ".DS_Store"]);
for (const path of files) {
  const name = path.split(/[\\/]/).at(-1);
  if (name && forbiddenNames.has(name)) failures.push(`forbidden file found in release: ${name}`);
  if (path.endsWith(".map")) failures.push(`source map found in production release: ${path}`);
  if ((await stat(path)).size > 5_000_000) failures.push(`release file exceeds 5 MB: ${path}`);
}
for (const path of files.filter((file) => /\.(js|html|json)$/.test(file))) {
  const content = await readFile(path, "utf8");
  if (/sk-(?:live|test|proj)-[A-Za-z0-9_-]{12,}/.test(content)) failures.push(`possible OpenAI secret found in ${path}`);
  if (/rk_(?:live|test)_[A-Za-z0-9]{12,}|sk_(?:live|test)_[A-Za-z0-9]{12,}/.test(content)) failures.push(`possible Stripe secret found in ${path}`);
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exitCode = 1;
} else console.log(`Release validation passed for Workpad ${sourceManifest.version}.`);
