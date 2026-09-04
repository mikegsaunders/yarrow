# Yarrow – session handoff

Snapshot taken after the 0.84.4 migration / permissions rewrite.

## What just happened

- Updated pi from `0.80.10` → `0.84.4`.
- Migrated Yarrow from symlink-based install to a proper pi package registered via `pi install`.
- Reworked the permissions system: replaced four "permission modes" with four tiers evaluated in order:
  1. `deny`
  2. `ask`
  3. `allow`
  4. `classify`
- Added a real model classifier (`@preset/flash`) for the `classify` tier, with a dedicated eval suite.
- Added shared auth helper (`extensions/shared/auth.ts`) that reads env first, then `~/.pi/agent/auth.json`, supporting both `key` and `access` credential types.
- Reworked `web-search` and `openrouter-credits` to use shared auth.
- Added `install.sh` with two modes:
  - Run from checkout → registers that directory.
  - Piped from curl → installs from npm `@mikegsaunders/yarrow`.
- Generated `~/.local/bin/yarrow` and `~/.local/bin/yo` wrappers.
  - `yarrow` opens the TUI.
  - `yo <question>` is a one-shot flash-model query.
- Published `@mikegsaunders/yarrow@0.5.0` to npm.
- Removed stale `alias yo='pi'` / `alias yarrow='pi'` from `~/dotfiles/zsh/.zshrc` (still uncommitted).

## Current state

- `main` at `15c1af2`, pushed to GitHub.
- `~/yarrow` checkout is current.
- npm package `@mikegsaunders/yarrow@0.5.0` published.
- Machine registration: Yarrow installed from local checkout (`~/yarrow`), wrappers present.
- Tests: 23 pass (18 permissions + 5 auth), typecheck clean, shellcheck clean, classifier eval 16/16.

## Remaining work: switch to OpenRouter OAuth

The code is ready — `extensions/shared/auth.ts` now reads the `access` oauth entry. To complete the switch:

1. Ensure `OPENROUTER_API_KEY` is not exported in your shell env or dotfiles (env wins over `auth.json`).
2. Run `pi` to open the TUI.
3. Run `/login openrouter` and choose "Sign in with OpenRouter".
4. Verify the switch worked by checking the credits footer still shows your balance.

After confirming, revoke the old API key in the OpenRouter dashboard.

## Other things left to verify / decide

- **Approval dialog**: try `sudo ls` in a TUI session to confirm the `ask` tier dialog works.
- **Classifier footer**: trigger a `classify`-tier call and confirm the footer shows `auto · checking`.
- **Classifier latency**: currently ~3.3s on `@preset/flash`. You can enable `google-ai-studio` in [OpenRouter privacy settings](https://openrouter.ai/settings/privacy) and set `classifier.model` in `~/.pi/agent/yarrow/permissions.json` to something faster (e.g. `google/gemini-2.5-flash-lite`). Re-run `bun run eval:classifier` after changing.
- **Dotfiles commit**: commit the `zsh/.zshrc` alias removal (alongside the unrelated `git/.gitconfig` and `wezterm/.wezterm.lua` changes).
- **Future cleanup**:
  - Move `openrouter-credits` and `web-search` onto `ctx.modelRegistry` instead of parsing `auth.json` directly (the classifier already does this).
  - Consider constrained tool sampling for the classifier if parsing ever misbehaves.

## Useful commands

| Command | What it does |
|---|---|
| `yarrow` | Open the TUI |
| `yarrow update` | Update pi, then Yarrow |
| `yo <question>` | One-shot flash answer |
| `pi -ne` | Run pi without extensions |
| `bun test` | Run unit tests |
| `npm run typecheck` | Type-check extensions |
| `bun run eval:classifier` | Run paid classifier eval |
| `./install.sh --uninstall` | Remove Yarrow |
| `node scripts/apply-config.mjs --dry-run` | Preview config merge |

## Gotchas to remember

- `zsh -ic` hangs on `pi --print`; test `yo` in a real interactive shell or tmux.
- `?` in `yo` questions can be globbed by zsh — use `alias yo='noglob yo'` or quote the question.
- Strangers installing via npm need their own OpenRouter presets or a `models.json`; the example is in `config/models.json.example`.
- Wrappers regenerate during `yarrow update`; `install.sh` deletes-before-write so running bash keeps the old inode.
