# claude-mimo

> One-shot CLI that installs **Claude Code** and points it at the **Xiaomi MiMo** Anthropic-compatible endpoint — with per-account profile switching.

[![npm](https://img.shields.io/npm/v/claude-mimo.svg)](https://www.npmjs.com/package/claude-mimo)
[![node](https://img.shields.io/badge/node-18+-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/FlipZ3ro/claude-mimo/actions/workflows/ci.yml/badge.svg)](https://github.com/FlipZ3ro/claude-mimo/actions/workflows/ci.yml)

Setting up Claude Code against a MiMo endpoint takes 4 manual steps: install the CLI, find the right env vars, locate `~/.claude/settings.json`, edit two JSON files. If you have multiple MiMo accounts (one per project) you do this dance every time you switch.

`claude-mimo` collapses all of that into a single command — and remembers each account as a named profile you can switch between in one line.

## Install

```bash
npm install -g claude-mimo
```

Or run it once without installing:

```bash
npx claude-mimo setup
```

> Requires Node.js 18+.

## Quick start

```bash
# interactive (prompts for missing values)
claude-mimo setup

# one-shot
claude-mimo setup \
  --key tp-xxxxxxxxxxxxxxxxxxxx \
  --profile mimo-swe \
  --model mimo-v2.5-pro
```

That single command:

1. installs `@anthropic-ai/claude-code` globally (skipped if already present),
2. writes `~/.claude/settings.json` with the MiMo env block,
3. writes `~/.claude.json` with `hasCompletedOnboarding: true`,
4. saves the config as a named profile under `~/.claude/mimo-profiles/<name>.json`,
5. backs up any pre-existing settings to `*.bak-<timestamp>`,
6. warns you if conflicting `ANTHROPIC_*` env vars are already set in your shell.

Reopen your terminal, then run `claude` from any project directory.

## Multi-account workflow

If you have multiple MiMo accounts (e.g. one per side project), set them up once:

```bash
claude-mimo setup --profile swe       --key tp-aaa
claude-mimo setup --profile synth     --key tp-bbb
claude-mimo setup --profile mmeval    --key tp-ccc
```

Switch between them in a second:

```bash
claude-mimo use swe
claude-mimo use synth
```

List all saved profiles (active one is marked):

```bash
$ claude-mimo list
Profiles:
  ● active  swe       mimo-v2.5-pro · tp-aaaaa…aaaa
            synth     mimo-v2.5-pro · tp-bbbbb…bbbb
            mmeval    mimo-v2.5-pro · tp-ccccc…cccc
```

## Subcommands

| Cmd                    | What it does                                                       |
|------------------------|--------------------------------------------------------------------|
| `setup`                | install Claude Code, write configs, save profile                    |
| `list`                 | list saved profiles, mark which one is currently active             |
| `use <name>`           | switch active profile (atomically re-writes `settings.json`)        |
| `status`               | print current `settings.json` env + installed Claude Code version   |
| `unset`                | remove the MiMo env block, restore the official Anthropic default   |
| `--help`               | print full help                                                     |

## Setup flags

| Flag              | Default                                              |
|-------------------|------------------------------------------------------|
| `--key <tp-...>`  | (required) — also read from `MIMO_API_KEY` env       |
| `--base-url <u>`  | `https://token-plan-sgp.xiaomimimo.com/anthropic`    |
| `--model <id>`    | `mimo-v2.5-pro`                                      |
| `--profile <n>`   | `default`                                            |
| `--skip-install`  | assume `claude` is already on `PATH`                 |
| `--dry-run`       | show what would change, write nothing                |

For MiMo's 1M-context variant, append `[1m]` to the model id:

```bash
claude-mimo setup --key tp-xxx --model 'mimo-v2.5-pro[1m]'
```

Run `/context` inside Claude Code to verify long context kicks in.

## What gets written where

| File                                       | What                                                  |
|--------------------------------------------|-------------------------------------------------------|
| `~/.claude/settings.json`                  | `env.ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL` (+ Sonnet/Opus/Haiku defaults) |
| `~/.claude.json`                           | `hasCompletedOnboarding: true`                        |
| `~/.claude/mimo-profiles/<profile>.json`   | per-profile snapshot for `use <name>`                 |
| `<file>.bak-<timestamp>`                   | automatic backup before any write                     |

Existing JSON keys are preserved — `claude-mimo` does a deep merge, it does not overwrite unrelated settings.

## After running setup

1. **Reopen your terminal** so the new `settings.json` takes effect.
2. If your shell has lingering `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_BASE_URL` env vars, unset them — they win over `settings.json`. `claude-mimo` warns you and prints the exact command for your OS.
3. `cd` into a project, run `claude`, then `/status` to verify the model.

## Troubleshooting

**`claude --version` is not found.** Reopen your terminal — `npm install -g` adds the binary to your `PATH`, but only new shells see it.

**Calls 401 / Unauthorized.** Your shell still has an `ANTHROPIC_AUTH_TOKEN` from a previous setup. Run `unset ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL` (POSIX) or `setx ANTHROPIC_AUTH_TOKEN ""` (Windows) and reopen the terminal.

**Wrong base URL.** Different MiMo deployments use different paths. Common variants:

- `https://token-plan-sgp.xiaomimimo.com/anthropic`
- `https://token-plan-sgp.xiaomimimo.com/v1`

Override with `--base-url`. The CLI never validates the URL — that's intentional so you can use it against any Anthropic-compatible gateway.

## Privacy

The CLI talks to `npm` and `claude` locally on your machine. It writes only to files under `~/.claude/` and `~/.claude.json`. No telemetry, no remote calls of its own.

## License

MIT — see [LICENSE](LICENSE).
