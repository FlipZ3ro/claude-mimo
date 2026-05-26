#!/usr/bin/env node
/**
 * claude-mimo — one-shot CLI to install Claude Code + wire it to MiMo.
 *
 * Usage:
 *   node scripts/claude-mimo.mjs setup \
 *       --key tp-xxxxxxxxxxxx \
 *       --base-url https://token-plan-sgp.xiaomimimo.com \
 *       --model mimo-v2.5-pro \
 *       --profile xrapz1767
 *
 *   node scripts/claude-mimo.mjs list                   # show saved profiles
 *   node scripts/claude-mimo.mjs use <profile>          # switch active profile
 *   node scripts/claude-mimo.mjs status                 # print current config
 *   node scripts/claude-mimo.mjs unset                  # remove MiMo settings
 *
 *   # interactive (no args -> prompts for missing values)
 *   node scripts/claude-mimo.mjs setup
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline/promises";
import { execSync, spawnSync } from "node:child_process";

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, ".claude");
const SETTINGS_PATH = path.join(CLAUDE_DIR, "settings.json");
const CLAUDE_JSON_PATH = path.join(HOME, ".claude.json");
const PROFILES_DIR = path.join(CLAUDE_DIR, "mimo-profiles");

const DEFAULTS = {
  baseUrl: "https://token-plan-sgp.xiaomimimo.com/anthropic",
  model: "mimo-v2.5-pro",
};

/* ---------------------- utils ---------------------- */

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};
const log = {
  info: (m) => console.log(`${C.cyan}›${C.reset} ${m}`),
  ok: (m) => console.log(`${C.green}✓${C.reset} ${m}`),
  warn: (m) => console.log(`${C.yellow}!${C.reset} ${m}`),
  err: (m) => console.error(`${C.red}✗${C.reset} ${m}`),
  step: (m) => console.log(`\n${C.bold}${m}${C.reset}`),
};

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const key = eq > -1 ? a.slice(2, eq) : a.slice(2);
      const val = eq > -1 ? a.slice(eq + 1) : argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[key] = val;
    } else {
      out._.push(a);
    }
  }
  return out;
}

function readJsonSafe(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    log.warn(`could not parse ${p}: ${e.message}`);
    return null;
  }
}

function backupFile(p) {
  if (!fs.existsSync(p)) return null;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const bak = `${p}.bak-${ts}`;
  fs.copyFileSync(p, bak);
  return bak;
}

function mergeWrite(p, patch) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const existing = readJsonSafe(p) ?? {};
  const merged = deepMerge(existing, patch);
  if (fs.existsSync(p)) backupFile(p);
  fs.writeFileSync(p, JSON.stringify(merged, null, 2) + "\n", "utf8");
  return merged;
}

function deepMerge(a, b) {
  if (typeof a !== "object" || typeof b !== "object" || a == null || b == null) return b;
  if (Array.isArray(a) || Array.isArray(b)) return b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = k in a ? deepMerge(a[k], v) : v;
  }
  return out;
}

function maskKey(k) {
  if (!k) return "—";
  if (k.length < 12) return k.slice(0, 4) + "***";
  return k.slice(0, 6) + "…" + k.slice(-4);
}

/* ---------------------- node + claude detect ---------------------- */

function ensureNodeVersion() {
  const major = Number((process.versions.node.split(".")[0] || "0"));
  if (major < 18) {
    log.err(`Node.js 18+ required (you have ${process.versions.node}). Upgrade and re-run.`);
    process.exit(2);
  }
}

function which(cmd) {
  const isWin = process.platform === "win32";
  const r = spawnSync(isWin ? "where" : "which", [cmd], { encoding: "utf8" });
  if (r.status === 0) return r.stdout.split(/\r?\n/)[0].trim();
  return null;
}

function getClaudeVersion() {
  try {
    const out = execSync("claude --version", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    return out;
  } catch {
    return null;
  }
}

function installClaudeCode() {
  log.step("Installing @anthropic-ai/claude-code globally...");
  const cmd = "npm install -g @anthropic-ai/claude-code";
  try {
    execSync(cmd, { stdio: "inherit" });
    log.ok("Installed.");
  } catch (e) {
    log.err(`Install failed: ${e.message}`);
    log.info("Try manually: " + C.bold + cmd + C.reset);
    process.exit(3);
  }
}

/* ---------------------- prompts ---------------------- */

async function prompt(question, fallback) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = await rl.question(question);
    rl.close();
    return ans.trim() || fallback || "";
  } catch {
    rl.close();
    return fallback || "";
  }
}

async function promptIfMissing(args) {
  let key = args.key || process.env.MIMO_API_KEY;
  let baseUrl = args["base-url"] || process.env.MIMO_BASE_URL || DEFAULTS.baseUrl;
  let model = args.model || DEFAULTS.model;
  let profile = args.profile || "default";

  if (!key) {
    console.log("");
    console.log(`${C.bold}MiMo Open Platform API key${C.reset} (starts with ${C.cyan}tp-${C.reset})`);
    key = await prompt(`  api key: `);
    if (!key) {
      log.err("API key is required.");
      process.exit(4);
    }
  }
  if (!baseUrl) {
    baseUrl = await prompt(`  base url [${DEFAULTS.baseUrl}]: `, DEFAULTS.baseUrl);
  }
  if (!model) {
    model = await prompt(`  model [${DEFAULTS.model}]: `, DEFAULTS.model);
  }
  return { key, baseUrl, model, profile };
}

/* ---------------------- core actions ---------------------- */

function buildEnvBlock({ key, baseUrl, model }) {
  return {
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_AUTH_TOKEN: key,
    ANTHROPIC_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
  };
}

function writeSettings({ key, baseUrl, model }) {
  const env = buildEnvBlock({ key, baseUrl, model });
  mergeWrite(SETTINGS_PATH, { env });
}

function writeClaudeJson() {
  mergeWrite(CLAUDE_JSON_PATH, { hasCompletedOnboarding: true });
}

function saveProfile(profile, { key, baseUrl, model }) {
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
  const p = path.join(PROFILES_DIR, `${profile}.json`);
  fs.writeFileSync(p, JSON.stringify({ key, baseUrl, model, savedAt: new Date().toISOString() }, null, 2));
  return p;
}

function loadProfile(profile) {
  const p = path.join(PROFILES_DIR, `${profile}.json`);
  return readJsonSafe(p);
}

function listProfiles() {
  if (!fs.existsSync(PROFILES_DIR)) return [];
  return fs.readdirSync(PROFILES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const p = path.join(PROFILES_DIR, f);
      const data = readJsonSafe(p) ?? {};
      return { name: f.slice(0, -5), ...data };
    });
}

function currentEnv() {
  const s = readJsonSafe(SETTINGS_PATH);
  return s?.env ?? {};
}

/* ---------------------- subcommands ---------------------- */

async function cmdSetup(args) {
  ensureNodeVersion();

  log.step("Step 1/4 — Pre-flight");
  const v = getClaudeVersion();
  if (v) {
    log.ok(`claude already installed: ${v}`);
  } else if (args["skip-install"] === "true") {
    log.warn("claude not found, --skip-install set; skipping install");
  } else {
    installClaudeCode();
    const v2 = getClaudeVersion();
    if (v2) log.ok(`claude installed: ${v2}`);
    else log.warn("`claude --version` not found; restart your shell after this script.");
  }

  log.step("Step 2/4 — Collect config");
  const ans = await promptIfMissing(args);
  console.log("");
  console.log(`  ${C.dim}profile :${C.reset} ${ans.profile}`);
  console.log(`  ${C.dim}base url:${C.reset} ${ans.baseUrl}`);
  console.log(`  ${C.dim}model   :${C.reset} ${ans.model}`);
  console.log(`  ${C.dim}api key :${C.reset} ${maskKey(ans.key)}`);

  log.step("Step 3/4 — Write configs");
  if (args["dry-run"] === "true") {
    log.warn("--dry-run set; nothing written.");
  } else {
    writeSettings(ans);
    log.ok(`wrote ${SETTINGS_PATH}`);
    writeClaudeJson();
    log.ok(`wrote ${CLAUDE_JSON_PATH}`);
    saveProfile(ans.profile, ans);
    log.ok(`saved profile "${ans.profile}" -> ${path.join(PROFILES_DIR, ans.profile + ".json")}`);
  }

  log.step("Step 4/4 — Done");
  console.log("");
  console.log(`  ${C.bold}Reopen your terminal${C.reset}, cd into a project, then run:`);
  console.log(`    ${C.cyan}claude${C.reset}`);
  console.log(`  After Claude Code opens, run ${C.cyan}/status${C.reset} to verify the model.`);
  console.log("");
  if (process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_BASE_URL) {
    log.warn("ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL are set in your env — unset them so settings.json takes effect:");
    if (process.platform === "win32") {
      console.log(`    setx ANTHROPIC_AUTH_TOKEN ""`);
      console.log(`    setx ANTHROPIC_BASE_URL ""`);
    } else {
      console.log(`    unset ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL`);
    }
  }
}

async function cmdList() {
  const profiles = listProfiles();
  const env = currentEnv();
  const activeKey = env.ANTHROPIC_AUTH_TOKEN;
  if (profiles.length === 0) {
    log.warn("no profiles saved. Run `claude-mimo setup --profile <name>` first.");
    return;
  }
  console.log(`${C.bold}Profiles:${C.reset}`);
  for (const p of profiles) {
    const active = p.key === activeKey ? `${C.green}● active${C.reset}` : `  `;
    console.log(`  ${active}  ${C.bold}${p.name}${C.reset}  ${C.dim}${p.model || "?"} · ${maskKey(p.key)}${C.reset}`);
  }
}

async function cmdUse(args) {
  const name = args._[1];
  if (!name) {
    log.err("usage: claude-mimo use <profile>");
    process.exit(5);
  }
  const data = loadProfile(name);
  if (!data) {
    log.err(`profile "${name}" not found. Available: ${listProfiles().map((p) => p.name).join(", ") || "(none)"}`);
    process.exit(6);
  }
  writeSettings(data);
  writeClaudeJson();
  log.ok(`switched to profile "${name}" (${maskKey(data.key)})`);
  log.info("Reopen your terminal for the change to take effect.");
}

async function cmdStatus() {
  const env = currentEnv();
  console.log(`${C.bold}Current settings.json env:${C.reset}`);
  console.log(`  ANTHROPIC_BASE_URL : ${env.ANTHROPIC_BASE_URL || "(unset)"}`);
  console.log(`  ANTHROPIC_AUTH_TOKEN: ${maskKey(env.ANTHROPIC_AUTH_TOKEN)}`);
  console.log(`  ANTHROPIC_MODEL    : ${env.ANTHROPIC_MODEL || "(unset)"}`);
  console.log("");
  const v = getClaudeVersion();
  console.log(`${C.bold}claude --version${C.reset}: ${v || "not installed"}`);
  console.log(`${C.bold}Settings path${C.reset}: ${SETTINGS_PATH}`);
  console.log(`${C.bold}Profiles dir${C.reset}: ${PROFILES_DIR}`);
}

async function cmdUnset() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    log.warn(`no ${SETTINGS_PATH}`);
    return;
  }
  const existing = readJsonSafe(SETTINGS_PATH) ?? {};
  if (existing.env) {
    const keys = [
      "ANTHROPIC_BASE_URL",
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_MODEL",
      "ANTHROPIC_DEFAULT_SONNET_MODEL",
      "ANTHROPIC_DEFAULT_OPUS_MODEL",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    ];
    for (const k of keys) delete existing.env[k];
    if (Object.keys(existing.env).length === 0) delete existing.env;
  }
  backupFile(SETTINGS_PATH);
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(existing, null, 2) + "\n", "utf8");
  log.ok(`stripped MiMo env from ${SETTINGS_PATH}`);
}

function usage() {
  console.log(`${C.bold}claude-mimo${C.reset} — set up Claude Code with a Xiaomi MiMo endpoint.

  ${C.bold}Commands:${C.reset}
    setup    install Claude Code and write settings.json (interactive if no flags)
    list     list saved profiles
    use      switch active profile
    status   show current config
    unset    remove the MiMo env block from settings.json

  ${C.bold}Setup flags:${C.reset}
    --key <tp-...>          MiMo API key      (or env MIMO_API_KEY)
    --base-url <url>        Anthropic-compat endpoint
                            (default: ${DEFAULTS.baseUrl})
    --model <id>            (default: ${DEFAULTS.model})
    --profile <name>        save under this profile name (default: default)
    --skip-install          assume claude is already on PATH
    --dry-run               show what would change, write nothing

  ${C.bold}Examples:${C.reset}
    claude-mimo setup
    claude-mimo setup --key tp-xxx --profile mimo-swe
    claude-mimo list
    claude-mimo use mimo-swe

  ${C.bold}Install:${C.reset}
    npm install -g claude-mimo
    # or one-off:  npx claude-mimo setup
`);
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const sub = args._[0];

  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    usage();
    return;
  }
  try {
    switch (sub) {
      case "setup":  await cmdSetup(args); break;
      case "list":   await cmdList(); break;
      case "use":    await cmdUse(args); break;
      case "status": await cmdStatus(); break;
      case "unset":  await cmdUnset(); break;
      default:
        log.err(`unknown subcommand: ${sub}`);
        usage();
        process.exit(1);
    }
  } catch (e) {
    log.err(e.message);
    process.exit(1);
  }
}

main();
