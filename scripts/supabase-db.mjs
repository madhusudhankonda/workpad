import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const envFile = await readFile(resolve(".env.local"), "utf8");
const matches = envFile.split(/\r?\n/).filter((line) => line.startsWith("SUPABASE_DB_PASSWORD="));
if (matches.length !== 1) throw new Error(".env.local must contain exactly one SUPABASE_DB_PASSWORD entry.");
let password = matches[0].slice("SUPABASE_DB_PASSWORD=".length).trim();
if ((password.startsWith('"') && password.endsWith('"')) || (password.startsWith("'") && password.endsWith("'"))) password = password.slice(1, -1);
if (!password) throw new Error("SUPABASE_DB_PASSWORD is empty.");
const args = process.argv.slice(2);
if (!args.length) throw new Error("Provide a Supabase database command.");

let command = "npx";
let commandArgs = ["--yes", "supabase@latest", ...args, "--password", password];
let childEnv = process.env;

if (args[0] === "schema-dump") {
  const outputFile = args[1];
  if (!outputFile) throw new Error("Provide an output file for schema-dump.");
  const poolerUrl = await readFile(resolve("supabase/.temp/pooler-url"), "utf8");
  const match = poolerUrl.trim().match(/^postgresql:\/\/([^:]+):\[YOUR-PASSWORD\]@([^:]+):\d+\/postgres$/);
  if (!match) throw new Error("Unable to parse the linked Supabase pooler URL.");
  command = "/opt/homebrew/opt/postgresql@17/bin/pg_dump";
  commandArgs = [
    "--host", match[2],
    "--port", "5432",
    "--username", match[1],
    "--dbname", "postgres",
    "--schema-only",
    "--schema", "public",
    "--no-owner",
    "--file", resolve(outputFile)
  ];
  childEnv = { ...process.env, PGPASSWORD: password };
}

const child = spawn(command, commandArgs, {
  cwd: resolve("."),
  env: childEnv,
  shell: false,
  stdio: "inherit"
});
child.on("error", (error) => { throw error; });
process.exitCode = await new Promise((resolveExit) => child.on("exit", (code) => resolveExit(code ?? 1)));
