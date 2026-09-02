#!/usr/bin/env bash
set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────

YARROW_PACKAGE="${YARROW_PACKAGE:-npm:@mikegsaunders/yarrow}"
PI_AGENT_DIR="${PI_AGENT_DIR:-$HOME/.pi/agent}"

red='\033[0;31m'
green='\033[0;32m'
yellow='\033[1;33m'
nc='\033[0m'

info()  { echo -e "${green}[yarrow]${nc} $*"; }
warn()  { echo -e "${yellow}[yarrow]${nc} $*"; }
error() { echo -e "${red}[yarrow]${nc} $*" >&2; }
die()   { error "$*"; exit 1; }

usage() {
  cat <<EOF
Usage: ${0##*/} [OPTIONS]

Install Yarrow as a pi package and merge its config defaults into pi.

Run from a checkout, Yarrow is registered from that directory so a git pull updates
it. Run any other way (curl | bash), it is installed from npm.

Options:
  --force-config  Overwrite settings you have already customised
  --uninstall     Remove the Yarrow package and its wrappers
  -h, --help      Show this help

Environment:
  YARROW_PACKAGE  Package source when not run from a checkout
                  (default: $YARROW_PACKAGE)
EOF
  exit 0
}

# ─── Where are we running from? ─────────────────────────────────────────────

# Piped through bash (curl | bash), BASH_SOURCE[0] is unset or "-", so there is no
# checkout to install from and we fall back to the published package.
CHECKOUT_DIR=""
if [[ "${BASH_SOURCE[0]:--}" != "-" ]] && [[ -f "${BASH_SOURCE[0]}" ]]; then
  candidate="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  [[ -f "$candidate/package.json" ]] && CHECKOUT_DIR="$candidate"
fi

# ─── Arg parse ─────────────────────────────────────────────────────────

FORCE_CONFIG=false
UNINSTALL=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force-config) FORCE_CONFIG=true; shift ;;
    --uninstall) UNINSTALL=true; shift ;;
    -h|--help) usage ;;
    *) die "Unknown option: $1" ;;
  esac
done

# ─── Legacy layout ──────────────────────────────────────────────────────

# Yarrow used to symlink itself into ~/.pi/agent. Those symlinks would now load a
# second copy of every extension alongside the package, so clear them out.
remove_legacy_links() {
  local removed=false path real
  for path in \
    "$PI_AGENT_DIR/extensions/yarrow.ts" \
    "$PI_AGENT_DIR/extensions/openrouter-credits.ts" \
    "$PI_AGENT_DIR/extensions/web-search" \
    "$PI_AGENT_DIR/extensions/pi-permissions-custom" \
    "$PI_AGENT_DIR/extensions/permissions" \
    "$PI_AGENT_DIR/skills/personal-wiki"
  do
    if [[ -L "$path" ]]; then
      rm -f "$path"
      removed=true
    fi
  done

  # Config files symlinked into the repo become real files holding the same content,
  # so pi can write to them without dirtying the checkout.
  for path in "$PI_AGENT_DIR/settings.json" "$PI_AGENT_DIR/keybindings.json"; do
    if [[ -L "$path" ]]; then
      real=$(readlink -f "$path" 2>/dev/null || true)
      if [[ -f "$real" ]]; then
        rm -f "$path"
        cp "$real" "$path"
        info "Converted $(basename "$path") from a symlink into a real file"
        removed=true
      fi
    fi
  done

  $removed && info "Removed symlinks from the old install layout"
  return 0
}

# ─── Uninstall ────────────────────────────────────────────────────────

if $UNINSTALL; then
  info "Uninstalling Yarrow ..."

  remove_legacy_links

  if command -v pi &>/dev/null; then
    for source in "$YARROW_PACKAGE" "$CHECKOUT_DIR"; do
      [[ -n "$source" ]] || continue
      if pi remove "$source" &>/dev/null; then
        info "Removed package $source"
      fi
    done
  else
    warn "pi not found — remove the Yarrow entry from $PI_AGENT_DIR/settings.json by hand"
  fi

  rm -f "$HOME/.local/bin/yarrow" "$HOME/.local/bin/yo"

  info "Uninstall complete."
  warn "Config keys Yarrow merged into settings.json are left in place — they are yours now."
  exit 0
fi


install_pi() {
  if command -v pi &>/dev/null; then
    info "Pi already installed: $(command -v pi)"
    return 0
  fi

  info "Pi not found. Installing ..."

  # Prefer bun (fast, compiled binary support)
  if command -v bun &>/dev/null; then
    info "Using bun ..."
    bun install -g @earendil-works/pi-coding-agent
  elif command -v npm &>/dev/null; then
    info "Using npm ..."
    npm install -g @earendil-works/pi-coding-agent
  else
    die "Neither bun nor npm found. Install Node.js (>=20.6) or Bun first:\n" \
        "  https://bun.sh  or  https://nodejs.org"
  fi

  # Ensure pi is on PATH for this session
  local bin_dir
  for p in "$HOME/.bun/bin/pi" "$HOME/.local/bin/pi" "$HOME/.npm-global/bin/pi"; do
    if [[ -x "$p" ]]; then
      bin_dir="$(dirname "$p")"
      export PATH="$bin_dir:$PATH"
      break
    fi
  done

  if ! command -v pi &>/dev/null; then
    die "Pi was installed but isn't on your PATH.\n" \
        "Add the global bin directory to your shell profile and restart your terminal."
  fi

  info "Pi installed: $(command -v pi)"
}

# ─── Install ─────────────────────────────────────────────────────────────

install_pi
remove_legacy_links

if [[ -n "$CHECKOUT_DIR" ]]; then
  # Run from a checkout: pi loads the extensions and skills straight out of it, so a
  # git pull is all it takes to update.
  info "Registering Yarrow from $CHECKOUT_DIR ..."
  pi install "$CHECKOUT_DIR"
else
  info "Installing Yarrow from $YARROW_PACKAGE ..."
  pi install "$YARROW_PACKAGE" || die \
    "Could not install $YARROW_PACKAGE.\n" \
    "      If it is not published yet, install from a clone instead:\n" \
    "        git clone https://github.com/mikegsaunders/yarrow.git ~/.yarrow\n" \
    "        ~/.yarrow/install.sh"
fi

# ─── Config ────────────────────────────────────────────────────────────

# The config merge ships with the package as the `yarrow-config` bin, so an npm
# install can run it without this script knowing where pi keeps its packages.
config_args=()
$FORCE_CONFIG && config_args+=(--force)

if [[ -n "$CHECKOUT_DIR" ]]; then
  if command -v node &>/dev/null; then
    node "$CHECKOUT_DIR/scripts/apply-config.mjs" "${config_args[@]}"
  elif command -v bun &>/dev/null; then
    bun "$CHECKOUT_DIR/scripts/apply-config.mjs" "${config_args[@]}"
  else
    warn "Neither node nor bun found — skipping config merge."
  fi
elif command -v npx &>/dev/null; then
  # -p names the package and `yarrow-config` the bin inside it; the two differ.
  npx -y -p "${YARROW_PACKAGE#npm:}" yarrow-config "${config_args[@]}"
elif command -v bunx &>/dev/null; then
  bunx --package "${YARROW_PACKAGE#npm:}" yarrow-config "${config_args[@]}"
else
  warn "Neither npx nor bunx found — skipping config merge."
fi


# ─── models.json ───────────────────────────────────────────────────────

if [[ -f "$PI_AGENT_DIR/models.json" ]]; then
  info "models.json already exists — left untouched."
else
  warn "No models.json found. If you need custom providers, start from:"
  warn "  https://github.com/mikegsaunders/yarrow/blob/main/config/models.json.example"
fi

# ─── yarrow / yo wrappers ─────────────────────────────────────────────────

# Convenience names, not a separate runtime: the package is registered globally, so
# plain `pi` gets Yarrow too. Generated here so the npm install has them as well.
LOCAL_BIN="$HOME/.local/bin"
mkdir -p "$LOCAL_BIN"

# The wrapper is removed and recreated rather than overwritten in place, so that
# `yarrow update` can regenerate it while bash is still reading the old inode.
rm -f "$LOCAL_BIN/yarrow"
# Baked in at install time: how this machine got Yarrow, and so how it updates.
printf '#!/usr/bin/env bash\nYARROW_SOURCE=%q\n' "${CHECKOUT_DIR:-$YARROW_PACKAGE}" > "$LOCAL_BIN/yarrow"
cat >> "$LOCAL_BIN/yarrow" <<'WRAPPER'
# yarrow — open the harness.
#
#   yarrow          start a session (plain `pi` is identical; `pi -ne` skips Yarrow)
#   yarrow update   update pi, then Yarrow itself
#
# Anything else is handed to pi untouched.

if [ "${1:-}" = "update" ] && [ $# -eq 1 ]; then
  echo "[yarrow] updating pi ..."
  pi update || echo "[yarrow] pi update failed, carrying on"

  case "$YARROW_SOURCE" in
    npm:* | git:*)
      echo "[yarrow] updating Yarrow from ${YARROW_SOURCE} ..."
      pi update --extensions
      if command -v npx >/dev/null 2>&1; then
        npx -y -p "${YARROW_SOURCE#npm:}" yarrow-config
      fi
      ;;
    *)
      echo "[yarrow] updating Yarrow from ${YARROW_SOURCE} ..."
      git -C "$YARROW_SOURCE" pull --ff-only || exit 1
      # Re-run the installer: it re-registers the package, merges any new config
      # defaults, and regenerates these wrappers.
      "$YARROW_SOURCE/install.sh"
      ;;
  esac
  exit 0
fi

exec pi "$@"
WRAPPER

rm -f "$LOCAL_BIN/yo"
cat > "$LOCAL_BIN/yo" <<'WRAPPER'
#!/usr/bin/env bash
# yo — Yarrow, in one line.
#
#   yo                        open the harness
#   yo how do I check nginx   answer in the terminal and exit
#
# One-liners go to a fast model. They run non-interactively, so anything that would
# need your approval is refused rather than queued; the safety classifier still
# decides the rest. Override the model with YARROW_QUICK_MODEL.

case "${1:-}" in
  "" | -*) exec pi "$@" ;;
esac

# pi treats every positional argument as a separate message and runs a turn for
# each, so the question has to arrive as one. @file arguments are the exception:
# those it resolves individually, and only before the message.
files=()
words=()
for arg in "$@"; do
  case "$arg" in
    @*) files+=("$arg") ;;
    *) words+=("$arg") ;;
  esac
done

exec pi --print --model "${YARROW_QUICK_MODEL:-openrouter/@preset/flash}" "${files[@]}" "${words[*]}"
WRAPPER

chmod +x "$LOCAL_BIN/yarrow" "$LOCAL_BIN/yo"
info "Installed yarrow and yo wrappers → $LOCAL_BIN"

if [[ ":$PATH:" != *":$LOCAL_BIN:"* ]]; then
  warn "$LOCAL_BIN is not on your PATH.\n" \
       "      Add this to your shell profile (~/.bashrc, ~/.zshrc, etc.):\n" \
       "        export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

# ─── Done ─────────────────────────────────────────────────────────────────────

echo
info "Yarrow installed. Run 'yarrow', 'yo' (or 'pi') to start."
if [[ -n "$CHECKOUT_DIR" ]]; then
  info "Loaded from $CHECKOUT_DIR — git pull there to update."
else
  info "Update with: pi update --extensions"
fi
