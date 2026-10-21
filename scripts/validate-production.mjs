import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadEnv } from "vite";

const failures = [];
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const environment = { ...loadEnv("production", root, ""), ...process.env };
const supabaseUrl = environment.VITE_SUPABASE_URL ?? "";
const publishableKey = environment.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";

try {
  const url = new URL(supabaseUrl);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co")) failures.push("VITE_SUPABASE_URL must be an HTTPS Supabase project URL");
} catch { failures.push("VITE_SUPABASE_URL is missing or invalid"); }
if (!publishableKey || /replace|example|your-/i.test(publishableKey)) failures.push("VITE_SUPABASE_PUBLISHABLE_KEY is missing or still a placeholder");
if ((environment.VITE_ALLOW_FREE_SYNC ?? "false") !== "false") failures.push("VITE_ALLOW_FREE_SYNC must be false for production");

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const clientId = manifest.oauth2?.client_id ?? "";
if (!clientId.endsWith(".apps.googleusercontent.com") || /replace|example|your-/i.test(clientId)) failures.push("manifest OAuth client ID is missing or invalid");

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exitCode = 1;
} else console.log("Production configuration is valid.");
