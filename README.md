<p align="center">
  <img src="https://raw.githubusercontent.com/mikegsaunders/yarrow/main/yarrow.png" alt="Yarrow mascot" width="200">
</p>

# Yarrow

A customised harness for [Pi](https://github.com/earendil-works/pi) — the terminal coding agent. Extra extensions, custom keybindings, and opinionated defaults.

**Pi is still the engine.** Yarrow just layers its files on top. When Pi updates, you get those updates automatically.

## Quick install

```bash
curl -fsSL https://raw.githubusercontent.com/mikegsaunders/yarrow/main/install.sh | bash
```

Then run `yarrow` (or keep using `pi`).

## What's included

| Extension | What it does |
|-----------|-------------|
| `yarrow.ts` | Custom ASCII-art header + `/yarrow` command to toggle it |
| `openrouter-credits.ts` | Footer showing OpenRouter credit balance + session token stats |
| `web-search` | Multi-provider web search tool (`Exa → Brave → OpenRouter` fallback chain) |
| `pi-permissions-custom` | Claude Code-style permission modes (`default` / `acceptEdits` / `fullAuto` / `bypassPermissions`) |

**Config**
- Dark theme, quiet startup, custom keybindings
- Default provider: OpenRouter, default model: `moonshotai/kimi-k2.6`
- Personal wiki skill loaded from `~/.pi/agent/skills`

## Manual install

If you prefer to clone first:

```bash
git clone https://github.com/mikegsaunders/yarrow.git ~/.yarrow
cd ~/.yarrow
./install.sh
```

The install script will:
1. Install Pi if it's not already present (via `bun` or `npm`)
2. Symlink Yarrow's extensions, skills, and config into `~/.pi/agent/`
3. Add a `yarrow` wrapper to `~/.local/bin/`

## Custom providers

If you need custom providers (e.g. NVIDIA build), copy the example and add your key:

```bash
cp ~/.yarrow/config/models.json.example ~/.pi/agent/models.json
# edit ~/.pi/agent/models.json
```

`models.json` and `auth.json` are **never touched** by the install script and are ignored by git.

## Updating

### Updating Pi

Pi updates itself (or via your package manager). Yarrow doesn't interfere.

### Updating Yarrow

```bash
cd ~/.yarrow
git pull
./install.sh
```

## Uninstall

```bash
~/.yarrow/install.sh --uninstall
```

This removes Yarrow's symlinks from `~/.pi/agent/` and deletes the `yarrow` wrapper. The repo at `~/.yarrow` is left intact in case you want it back.

## Commands added

| Command | Description |
|---------|-------------|
| `/yarrow` | Toggle the Yarrow header |
| `/builtin-header` | Restore Pi's default header |
| `/search-stats` | Show web-search quota usage |
| `/permissions` | Interactive permission mode selector |
| `/permissions <mode>` | Set mode directly |
| `/permissions:status` | Show current mode & approvals |
| `/permissions:reload` | Reload `rules.json` |

## Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+P` | Cycle permission modes |

## Security

This repo contains **no API keys**.

- `auth.json` is ignored by `.gitignore` and never touched by the installer.
- `models.json` is ignored. Only `models.json.example` is in the repo.
- The install script refuses to overwrite a real (non-symlink) `settings.json` or `keybindings.json` — remove them manually first if you want Yarrow's versions.

## License

Extensions are MIT. Pi itself is a separate project — see the [Pi repo](https://github.com/earendil-works/pi).
