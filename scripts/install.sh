#!/usr/bin/env bash
# Spotcheck installer for macOS and Linux.
# Usage: curl -fsSL https://raw.githubusercontent.com/relauts/spotcheck/main/scripts/install.sh | bash

set -euo pipefail

SPOTCHECK_HOME="${SPOTCHECK_HOME:-$HOME/spotcheck}"
NODE_DIR="$SPOTCHECK_HOME/.node"
BIN_DIR="${SPOTCHECK_BIN_DIR:-$HOME/.local/bin}"
WRAPPER="$BIN_DIR/spotcheck"
NODE_VERSION="${SPOTCHECK_NODE_VERSION:-24.20.0}"
MIN_NODE_MAJOR=18
MIN_NODE_MINOR=18
PACKAGE="@relauts/spotcheck"
UI_URL="http://127.0.0.1:18733"

info() { printf '%s\n' "$*"; }
err() { printf 'Error: %s\n' "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || err "Missing required command: $1"
}

node_version_ok() {
  local ver major minor
  ver="$(node -p "process.versions.node" 2>/dev/null)" || return 1
  major="${ver%%.*}"
  minor="${ver#*.}"
  minor="${minor%%.*}"
  if [ "$major" -gt "$MIN_NODE_MAJOR" ]; then
    return 0
  fi
  if [ "$major" -eq "$MIN_NODE_MAJOR" ] && [ "$minor" -ge "$MIN_NODE_MINOR" ]; then
    return 0
  fi
  return 1
}

detect_platform() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$arch" in
    x86_64 | amd64) arch="x64" ;;
    aarch64 | arm64) arch="arm64" ;;
    *) err "Unsupported CPU: $arch" ;;
  esac
  case "$os" in
    darwin | linux) printf '%s-%s' "$os" "$arch" ;;
    *) err "Unsupported OS: $os (this script is for macOS and Linux)" ;;
  esac
}

download() {
  local url="$1" dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$dest"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$dest" "$url"
  else
    err "Need curl or wget to download files"
  fi
}

ensure_portable_node() {
  local platform tarball url tmp extract_name
  if [ -x "$NODE_DIR/bin/node" ] && PATH="$NODE_DIR/bin:$PATH" node_version_ok; then
    info "Using Node at $NODE_DIR"
    return
  fi

  need_cmd tar
  platform="$(detect_platform)"
  tarball="node-v${NODE_VERSION}-${platform}.tar.gz"
  url="https://nodejs.org/dist/v${NODE_VERSION}/${tarball}"
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/spotcheck-node.XXXXXX")"
  extract_name="node-v${NODE_VERSION}-${platform}"

  info "Downloading Node.js v${NODE_VERSION} (${platform})..."
  download "$url" "$tmp/$tarball"
  tar -xzf "$tmp/$tarball" -C "$tmp"
  rm -rf "$NODE_DIR"
  mkdir -p "$SPOTCHECK_HOME"
  mv "$tmp/$extract_name" "$NODE_DIR"
  rm -rf "$tmp"
  info "Installed Node.js to $NODE_DIR"
}

ensure_node() {
  mkdir -p "$SPOTCHECK_HOME"
  if command -v node >/dev/null 2>&1 && node_version_ok; then
    info "Using system Node $(node -p "process.versions.node")"
    return
  fi
  ensure_portable_node
  export PATH="$NODE_DIR/bin:$PATH"
}

ensure_path_in_profile() {
  local marker='# spotcheck PATH'
  local line="export PATH=\"$BIN_DIR:\$PATH\" $marker"
  local shell_name candidates=() file

  case ":$PATH:" in
    *":$BIN_DIR:"*) return ;;
  esac

  shell_name="$(basename "${SHELL:-}")"
  case "$shell_name" in
    zsh) candidates=("$HOME/.zshrc" "$HOME/.zprofile" "$HOME/.profile") ;;
    bash) candidates=("$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile") ;;
    *) candidates=("$HOME/.profile" "$HOME/.zshrc" "$HOME/.bashrc") ;;
  esac

  for file in "${candidates[@]}"; do
    if [ -f "$file" ] && grep -Fq "$marker" "$file" 2>/dev/null; then
      return
    fi
  done

  for file in "${candidates[@]}"; do
    if [ -f "$file" ] || [ "$file" = "$HOME/.profile" ]; then
      printf '\n%s\n' "$line" >>"$file"
      info "Added $BIN_DIR to PATH in $file"
      info "Open a new terminal (or run: export PATH=\"$BIN_DIR:\$PATH\")"
      return
    fi
  done
}

write_wrapper() {
  local home_q package_q
  home_q="$(printf '%q' "$SPOTCHECK_HOME")"
  package_q="$(printf '%q' "$PACKAGE")"
  mkdir -p "$BIN_DIR"
  cat >"$WRAPPER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
SPOTCHECK_HOME=$home_q
NODE_DIR="\$SPOTCHECK_HOME/.node"
if [ -x "\$NODE_DIR/bin/node" ]; then
  export PATH="\$NODE_DIR/bin:\$PATH"
fi
cd "\$SPOTCHECK_HOME"
exec npx --yes $package_q "\$@"
EOF
  chmod +x "$WRAPPER"
  info "Installed command: spotcheck ($WRAPPER)"
  ensure_path_in_profile
}

main() {
  info "Spotcheck installer"
  info "Install folder: $SPOTCHECK_HOME"
  ensure_node
  write_wrapper
  export PATH="$BIN_DIR:$PATH"
  if [ -x "$NODE_DIR/bin/node" ]; then
    export PATH="$NODE_DIR/bin:$PATH"
  fi

  info ""
  info "Starting Spotcheck..."
  info "Open $UI_URL in your browser."
  info "Later, just type: spotcheck"
  info ""
  cd "$SPOTCHECK_HOME"
  exec npx --yes "$PACKAGE"
}

main "$@"
