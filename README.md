<p align="center">
  <img src="https://raw.githubusercontent.com/mikegsaunders/yarrow/main/yarrow.png" alt="Yarrow mascot" width="200">
</p>

# Yarrow

An opinionated harness for [Pi](https://github.com/earendil-works/pi). Pi is still the engine — Yarrow is a package layered on top, so pi keeps updating itself underneath you.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/mikegsaunders/yarrow/main/install.sh | bash
```

Installs pi if you don't have it. If you already have pi and want the extensions without the config opinions: `pi install npm:@mikegsaunders/yarrow`.

## Use

```bash
yarrow                                    # the TUI
yarrow update                             # update pi, then Yarrow
yo remind me of the command for nginx     # one-shot answer, in the terminal
```

One-shots go to a fast model (`openrouter/@preset/flash`, or set `YARROW_QUICK_MODEL`). Nothing that would need your approval runs unattended. `pi` on its own works too — the package is global. `pi -ne` skips it.

> zsh eats `?`, so either quote the question or `alias yo='noglob yo'`.

## What you get

| | |
|---|---|
| **Permissions** | No modes to pick. Catastrophic commands and secret paths are denied outright; destructive ones ask you; reads, everyday commands and edits in your working directory just run; everything else is judged by a fast model, which blocks with a reason the agent can work around. [Details](extensions/permissions/AGENTS.md) |
| **Web search** | `web_search` tool, Exa → Brave → OpenRouter, staying inside the free tiers. `/search-stats` |
| **Footer** | OpenRouter balance and session spend |
| **Header** | The dog. `/yarrow` toggles him |
| **Personal wiki** | Skill for a knowledge base at `~/wiki` |

> The last tier means a background model call: calls that reach it are sent to `@preset/flash` — the command, your last message, and your git remote URLs — costing a fraction of a cent and a few seconds. Reads, everyday commands, and edits in your working directory never reach it.

Defaults: OpenRouter, `kimi-k2.6`, medium thinking, quiet startup. Yarrow **merges** these into `settings.json` and leaves anything you have already set — pi owns that file, so your changes always win. `--force-config` overrides that.

## Update, uninstall

```bash
yarrow update                   # updates pi, then Yarrow, however you installed it
~/.yarrow/install.sh --uninstall
```

## Hacking on it

```bash
git clone https://github.com/mikegsaunders/yarrow.git ~/.yarrow && ~/.yarrow/install.sh
```

Installed from a checkout, pi loads the extensions out of your working copy — edit, restart, done.

```bash
npm install && npm run typecheck && bun test
```

Extensions are typechecked against the pi version in `devDependencies`, so API drift shows up in CI rather than at someone's next startup.
