#!/usr/bin/env bash
set -euo pipefail

# ─── Config ───────────────────────────────────────────────────────────────────

YARROW_REPO_URL="${YARROW_REPO_URL:-https://github.com/mikegsaunders/yarrow.git}"
YARROW_DIR="${YARROW_DIR:-$HOME/.yarrow}"
PI_AGENT_DIR="$HOME/.pi/agent"

red='\033[0;31m'
green='\033[0;32m'
yellow='\033[1;33m'
blue='\033[0;34m'
nc='\033[0m'

info()  { echo -e "${green}[yarrow]${nc} $*"; }
warn()  { echo -e "${yellow}[yarrow]${nc} $*"; }
error() { echo -e "${red}[yarrow]${nc} $*" >&2; }
die()   { error "$*"; exit 1; }

usage() {
  cat <<EOF
Usage: ${0##*/} [OPTIONS]

Bootstrap Yarrow on top of Pi.

Options:
  --copy          Copy files instead of symlinking
  --uninstall     Remove Yarrow from ~/.pi/agent/ and ~/.local/bin/yarrow
  -h, --help      Show this help

Environment:
  YARROW_REPO_URL   Git URL to clone (default: $YARROW_REPO_URL)
  YARROW_DIR        Where to clone (default: $YARROW_DIR)
EOF
  exit 0
}

# ─── Arg parse ────────────────────────────────────────────────────────────────

COPY=false
UNINSTALL=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --copy) COPY=true; shift ;;
    --uninstall) UNINSTALL=true; shift ;;
    -h|--help) usage ;;
    *) die "Unknown option: $1" ;;
  esac
done

# ─── Uninstall ────────────────────────────────────────────────────────────────

if $UNINSTALL; then
  info "Uninstalling Yarrow ..."

  rm -f "$PI_AGENT_DIR/extensions/yarrow.ts"
  rm -f "$PI_AGENT_DIR/extensions/openrouter-credits.ts"
  rm -rf "$PI_AGENT_DIR/extensions/web-search"
  rm -rf "$PI_AGENT_DIR/extensions/pi-permissions-custom"
  rm -rf "$PI_AGENT_DIR/skills/personal-wiki"
  rm -f "$HOME/.local/bin/yarrow"
  rm -f "$HOME/.local/bin/yo"

  for f in settings.json keybindings.json; do
    target="$PI_AGENT_DIR/$f"
    if [[ -L "$target" ]]; then
      real=$(readlink -f "$target" 2>/dev/null || true)
      if [[ "$real" == "$YARROW_DIR"/* ]]; then
        rm -f "$target"
        info "Removed symlink $f"
      fi
    fi
  done

  info "Uninstall complete. Pi is back to stock."
  info "Yarrow repo still at $YARROW_DIR — remove manually if desired."
  exit 0
fi

# ─── Remote bootstrap (when piped via curl) ───────────────────────────────────

# Detect if we're running from a local file or via curl | bash.
# When local, BASH_SOURCE[0] is the real path. When piped, it's "-" or empty.
REPO_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" ]] && [[ "${BASH_SOURCE[0]}" != "-" ]] && [[ -f "${BASH_SOURCE[0]}" ]]; then
  REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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
  for p in "$HOME/.bun/bin/pi" "$HOME/.local/bin/pi" "$HOME/.npm-global/bin/pi"; do
    if [[ -x "$p" ]]; then
      export PATH="$(dirname "$p"):$PATH"
      break
    fi
  done

  if ! command -v pi &>/dev/null; then
    die "Pi was installed but isn't on your PATH.\n" \
        "Add the global bin directory to your shell profile and restart your terminal."
  fi

  info "Pi installed: $(command -v pi)"
}

bootstrap_repo() {
  if [[ -d "$YARROW_DIR/.git" ]]; then
    info "Yarrow repo already at $YARROW_DIR"
    info "Pulling latest ..."
    git -C "$YARROW_DIR" pull --ff-only
  else
    if ! command -v git &>/dev/null; then
      die "git is required but not installed."
    fi
    info "Cloning Yarrow ..."
    git clone "$YARROW_REPO_URL" "$YARROW_DIR"
  fi
}

if [[ -z "$REPO_DIR" ]] || [[ ! -f "$REPO_DIR/extensions/yarrow.ts" ]]; then
  info "Yarrow remote installer"
  echo

  install_pi
  bootstrap_repo

  info "Running local install from $YARROW_DIR ..."
  echo
  exec bash "$YARROW_DIR/install.sh" "$([[ "$COPY" == true ]] && echo --copy)"
fi

# ─── Local install (run from within the repo) ─────────────────────────────────

if [[ ! -f "$REPO_DIR/extensions/yarrow.ts" ]]; then
  die "This doesn't look like the Yarrow repo (missing extensions/yarrow.ts).\n" \
      "Run via curl:\n" \
      "  curl -fsSL ${YARROW_REPO_URL%.git}/raw/main/install.sh | bash"
fi

info "Installing Yarrow from $REPO_DIR ..."

if [[ ! -d "$PI_AGENT_DIR" ]]; then
  die "Pi agent directory not found: $PI_AGENT_DIR\n" \
      "Install Pi first, or run this script via curl to auto-install Pi."
fi

# ─── Helpers ──────────────────────────────────────────────────────────────────

link_or_copy() {
  local src="$1" dst="$2"
  if $COPY; then
    rm -rf "$dst"
    if [[ -d "$src" ]]; then
      cp -R "$src" "$dst"
    else
      cp -f "$src" "$dst"
    fi
    info "Copied $(basename "$src")"
  else
    rm -rf "$dst"
    ln -s "$src" "$dst"
    info "Linked $(basename "$src")"
  fi
}

# ─── Extensions ───────────────────────────────────────────────────────────────

link_or_copy "$REPO_DIR/extensions/yarrow.ts"              "$PI_AGENT_DIR/extensions/yarrow.ts"
link_or_copy "$REPO_DIR/extensions/openrouter-credits.ts"  "$PI_AGENT_DIR/extensions/openrouter-credits.ts"
link_or_copy "$REPO_DIR/extensions/web-search"             "$PI_AGENT_DIR/extensions/web-search"
link_or_copy "$REPO_DIR/extensions/pi-permissions-custom"  "$PI_AGENT_DIR/extensions/pi-permissions-custom"

# ─── Skills ───────────────────────────────────────────────────────────────────

link_or_copy "$REPO_DIR/skills/personal-wiki"              "$PI_AGENT_DIR/skills/personal-wiki"

# ─── Config ───────────────────────────────────────────────────────────────────

for f in settings.json keybindings.json; do
  dst="$PI_AGENT_DIR/$f"
  if [[ -e "$dst" && ! -L "$dst" ]]; then
    warn "$f already exists as a real file. Skipping.\n" \
         "      Remove it manually if you want Yarrow's version: rm $dst"
  else
    link_or_copy "$REPO_DIR/config/$f" "$dst"
  fi
done

# ─── models.json ──────────────────────────────────────────────────────────────

if [[ ! -f "$PI_AGENT_DIR/models.json" ]]; then
  if [[ -f "$REPO_DIR/config/models.json" ]]; then
    warn "No models.json found in Pi. Copying from repo (CHECK FOR API KEYS!)."
    cp "$REPO_DIR/config/models.json" "$PI_AGENT_DIR/models.json"
  else
    warn "No models.json found. If you need custom providers:"
    warn "  cp $REPO_DIR/config/models.json.example $PI_AGENT_DIR/models.json"
  fi
else
  info "models.json already exists — left untouched."
fi

# ─── yarrow wrapper binary ────────────────────────────────────────────────────

LOCAL_BIN="$HOME/.local/bin"
mkdir -p "$LOCAL_BIN"

if $COPY; then
  cp -f "$REPO_DIR/bin/yarrow" "$LOCAL_BIN/yarrow"
else
  rm -f "$LOCAL_BIN/yarrow"
  ln -s "$REPO_DIR/bin/yarrow" "$LOCAL_BIN/yarrow"
fi
chmod +x "$LOCAL_BIN/yarrow"
info "Installed yarrow wrapper → $LOCAL_BIN/yarrow"

# ─── yo alias ─────────────────────────────────────────────────────────────────

rm -f "$LOCAL_BIN/yo"
if $COPY; then
  cp -f "$LOCAL_BIN/yarrow" "$LOCAL_BIN/yo"
else
  ln -s "$LOCAL_BIN/yarrow" "$LOCAL_BIN/yo"
fi
info "Installed yo alias → $LOCAL_BIN/yo"

if [[ ":$PATH:" != *":$LOCAL_BIN:"* ]]; then
  warn "$LOCAL_BIN is not on your PATH.\n" \
       "      Add this to your shell profile (~/.bashrc, ~/.zshrc, etc.):\n" \
       "        export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

# ─── Done ─────────────────────────────────────────────────────────────────────

echo
info "Yarrow installed. Run 'yarrow', 'yo' (or 'pi') to start."
info "Repo is at $REPO_DIR — cd there and git pull to update."
