import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

// WORKPAD_DB_TARGET=prod reads the production password, so dev and production passwords are never mixed up.
const target = process.env.WORKPAD_DB_TARGET === "prod" ? "prod" : "dev";
const passwordVariable = target === "prod" ? "SUPABASE_PROD_DB_PASSWORD" : "SUPABASE_DB_PASSWORD";
const envFile = await readFile(resolve(".env.local"), "utf8");
const matches = envFile.split(/\r?\n/).filter((line) => line.startsWith(`${passwordVariable}=`));
if (matches.length !== 1) throw new Error(`.env.local must contain exactly one ${passwordVariable} entry.`);
let password = matches[0].slice(`${passwordVariable}=`.length).trim();
if ((password.startsWith('"') && password.endsWith('"')) || (password.startsWith("'") && password.endsWith("'"))) password = password.slice(1, -1);
if (!password) throw new Error(`${passwordVariable} is empty.`);
console.error(`Using the ${target} database password (${passwordVariable}).`);
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
