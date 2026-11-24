#!/usr/bin/env bash
# tg-claude: this Mac joins your bot. The one line from /pair runs this; nothing else to install by hand and
# no admin rights: Node and the agent go to ~/.tg-claude-vps/agent, the agent starts with your session (launchd).
# Served by your own server for one pairing code; the code works once, for 10 minutes
set -euo pipefail

SERVER='__SERVER__'
WSS='__WSS__'
CODE='__CODE__'
NODE_VERSION='__NODE__'
DIR="${TGCV_HOME:-$HOME/.tg-claude-vps/agent}"

step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) OS=darwin ;;
  Linux) OS=linux ;;
  *) fail "This line is for macOS and Linux; /pair has a separate one for Windows." ;;
esac
case "$(uname -m)" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64) ARCH=x64 ;;
  *) fail "Unknown processor: $(uname -m)" ;;
esac
mkdir -p "$DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Node of its own, the version the server runs, checked against nodejs.org's own list of checksums
NODE="$DIR/node/bin/node"
if [ ! -x "$NODE" ] || [ "$("$NODE" --version)" != "$NODE_VERSION" ]; then
  # Braces: the Mac's bash 3.2 would take the first byte of a non-ASCII character right after a name for part of it
  step "Downloading Node ${NODE_VERSION}..."
  NAME="node-$NODE_VERSION-$OS-$ARCH"
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/$NAME.tar.gz" -o "$TMP/$NAME.tar.gz"
  WANT="$(curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" | awk -v f="$NAME.tar.gz" '$2 == f { print $1 }')"
  # shasum on a Mac, sha256sum on Linux, where shasum is often missing
  if command -v shasum >/dev/null 2>&1; then GOT="$(shasum -a 256 "$TMP/$NAME.tar.gz" | awk '{ print $1 }')"
  else GOT="$(sha256sum "$TMP/$NAME.tar.gz" | awk '{ print $1 }')"; fi
  [ -n "$WANT" ] && [ "$WANT" = "$GOT" ] || fail "Node downloaded with errors (checksum mismatch). Run the line again."
  tar -xzf "$TMP/$NAME.tar.gz" -C "$TMP"
  rm -rf "$DIR/node"
  mv "$TMP/$NAME" "$DIR/node"
fi

step "Downloading the agent from your server..."
curl -fsSL "$SERVER/install/$CODE/agent.tar.gz" -o "$TMP/agent.tar.gz" \
  || fail "The server did not hand over the agent: the code from /pair has expired or was already used. Get a new one: /pair"
rm -rf "$DIR/apps" "$DIR/packages" "$DIR/node_modules"
tar -xzf "$TMP/agent.tar.gz" -C "$DIR"
# The protocol package is linked in place
mkdir -p "$DIR/node_modules/@tgcv"
ln -sfn ../../packages/protocol "$DIR/node_modules/@tgcv/protocol"

step "Connecting this computer to the bot..."
"$NODE" "$DIR/apps/agent/src/main.ts" setup "$CODE" --server "$WSS" \
  || fail "Could not connect: see the message above. Get a new code (/pair) and run the line again."
printf '\n\033[32m✔ Done. The agent is installed in %s and starts by itself when you log in. You can close this window.\033[0m\n' "$DIR"
