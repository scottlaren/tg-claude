#!/usr/bin/env bash
# tg-claude server on a Linux VPS in one command. Run it again to update.
#   curl -fsSL <url>/install-server.sh | bash        or, from a checkout:   bash deploy/install-server.sh
# Asks only for the bot token (and a domain, if you have one); everything else is set up by itself and then
# in Telegram. Needs ports 80 and 443 open: Caddy gets the HTTPS certificate computers connect through.
set -euo pipefail

REPO="${TGCV_REPO:-https://github.com/scottlaren/tg-claude.git}"
BRANCH="${TGCV_BRANCH:-main}"
DIR="${TGCV_DIR:-/opt/tgcv}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n✖ %s\n' "$*" >&2; exit 1; }
# Piped through curl, stdin is the script itself: questions are read from the terminal
ask() { local answer; read -r -p "$1" answer </dev/tty; printf '%s' "$answer"; }
SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo"

[ "$(uname -s)" = "Linux" ] || die "This installer is for a Linux server (Ubuntu, Debian...)."

# --- Docker ---------------------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker..."
  curl -fsSL https://get.docker.com | $SUDO sh
fi
$SUDO docker compose version >/dev/null 2>&1 || die "No docker compose: update Docker."

# --- Access to the code: a private repo takes a GitHub token that can only read it --------------------------
# Kept in one file for this user and root (the update helper fetches with it), never in .env or a container.
# git reads it through a credential helper, so the token is in no URL and no git config
command -v git >/dev/null 2>&1 || { $SUDO apt-get update -qq && $SUDO apt-get install -y -qq git; }
export GIT_TERMINAL_PROMPT=0
TOKEN_FILE=/etc/tgcv/github-token
CRED_HELPER='!f() { test "$1" = get && echo username=x-access-token && echo "password=$(cat /etc/tgcv/github-token)"; }; f'
GIT_AUTH=()
if ! git -c credential.helper= ls-remote "$REPO" >/dev/null 2>&1; then
  GIT_AUTH=(-c credential.helper= -c "credential.helper=$CRED_HELPER")
  if ! git "${GIT_AUTH[@]}" ls-remote "$REPO" >/dev/null 2>&1; then
    say "Access to the code on GitHub"
    echo "The repository is private: it needs a read-only token."
    echo "GitHub → Settings → Developer settings → Fine-grained tokens → access to this repository only, Contents: Read-only."
    while :; do
      GH="${GITHUB_TOKEN:-$(ask 'GitHub token: ')}"
      GITHUB_TOKEN=""
      $SUDO install -d -m 755 /etc/tgcv
      printf '%s\n' "$GH" | $SUDO tee "$TOKEN_FILE" >/dev/null
      $SUDO chown "$(id -u):$(id -g)" "$TOKEN_FILE" && $SUDO chmod 600 "$TOKEN_FILE"
      git "${GIT_AUTH[@]}" ls-remote "$REPO" >/dev/null 2>&1 && break
      echo "GitHub does not let this token into ${REPO}, try again."
    done
  fi
fi

# --- Code: this checkout, or a fresh clone in $DIR --------------------------------------------------
here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [ -n "$here" ] && [ -f "$here/compose.yml" ] && [ -f "$here/../package.json" ]; then
  SRC="$(cd "$here/.." && pwd)"
else
  SRC="$DIR/src"
  if [ -d "$SRC/.git" ]; then
    say "Updating the code..."
    git "${GIT_AUTH[@]}" -C "$SRC" fetch -q origin "$BRANCH" && git -C "$SRC" checkout -q "$BRANCH" && git -C "$SRC" reset -q --hard "origin/$BRANCH"
  else
    say "Downloading the code..."
    $SUDO mkdir -p "$DIR" && $SUDO chown "$(id -u):$(id -g)" "$DIR"
    git "${GIT_AUTH[@]}" clone -q --branch "$BRANCH" "$REPO" "$SRC"
  fi
fi
# Later fetches (this installer again, the update helper as root) find the token the same way
if [ ${#GIT_AUTH[@]} -gt 0 ]; then
  git -C "$SRC" config --unset-all credential.helper || true
  git -C "$SRC" config --add credential.helper ""
  git -C "$SRC" config --add credential.helper "$CRED_HELPER"
fi
cd "$SRC/deploy"
ENV_FILE="$SRC/deploy/.env"

# --- First run: the few questions -------------------------------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  say "Setup (once)"
  echo "Create a bot with @BotFather in Telegram (/newbot), turn on Threaded Mode in its settings, copy the token."
  while :; do
    TOKEN="$(ask 'Bot token: ')"
    BOT="$(curl -fsS "https://api.telegram.org/bot${TOKEN}/getMe" 2>/dev/null | sed -n 's/.*"username":"\([^"]*\)".*/\1/p' || true)"
    [ -n "$BOT" ] && break
    echo "Telegram did not accept this token, try again."
  done
  echo "Bot @${BOT} found."

  DOMAIN="$(ask 'Domain of this server (Enter if there is none): ')"
  if [ -z "$DOMAIN" ]; then
    IP="$(curl -fsS https://api.ipify.org || true)"
    [ -n "$IP" ] || die "Could not find out the public address of the server: enter a domain."
    # A name that points at this IP with no registration, so Caddy can still get a real certificate
    DOMAIN="${IP//./-}.sslip.io"
  fi

  CLAIM="$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n' | cut -c1-12)"
  BACKUP_KEY="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
  # ~0.4 GB per running Claude task on the server: as many as the memory allows, 2 to 10
  RAM_GB="$(awk '/MemTotal/ {print int($2/1024/1024 + 0.5)}' /proc/meminfo)"
  PARALLEL=$(( RAM_GB < 2 ? 2 : (RAM_GB > 10 ? 10 : RAM_GB) ))

  umask 077
  cat > "$ENV_FILE" <<EOF
TG_TOKEN=$TOKEN
CLAIM_CODE=$CLAIM
DOMAIN=$DOMAIN
PUBLIC_WS_URL=wss://$DOMAIN/device
BACKUP_KEY=$BACKUP_KEY
MAX_PARALLEL=$PARALLEL
EOF
  FIRST_RUN=1
fi

# --- The cloud workspace: asked once, on a first run and on the first update that knows about it ----------
if ! grep -q '^CLOUD_KEY=' "$ENV_FILE"; then
  say "Cloud"
  echo "The cloud is a computer for code right on this server: it works while your computers are off."
  echo "Git, GitHub, Node.js, Python; no After Effects, Blender or other desktop apps there. Needs ~1 GB of disk."
  CLOUD="$(ask 'Turn on the cloud? [Y/n] ')"
  RAM_GB="$(awk '/MemTotal/ {print int($2/1024/1024 + 0.5)}' /proc/meminfo)"
  # Half the memory for builds and tests in the cloud, 1 to 8 GB: the rest stays for the bot and Claude
  CLOUD_GB=$(( RAM_GB / 2 < 1 ? 1 : (RAM_GB / 2 > 8 ? 8 : RAM_GB / 2) ))
  umask 077
  {
    echo "CLOUD_KEY=$(head -c 32 /dev/urandom | base64 | tr -d '\n=' | tr '+/' '-_')"
    echo "CLOUD_MEMORY=${CLOUD_GB}g"
    case "$CLOUD" in [nN]*) ;; *) echo "COMPOSE_PROFILES=cloud" ;; esac
  } >> "$ENV_FILE"
fi

# --- Sandbox: what the containers may reach ---------------------------------------------------------------
# No container reaches the provider's metadata service (it tells the VPS's keys and setup scripts), the VPS itself
# or any private network, whatever a DNS name says: the server's web fetches can't be turned inward, and the cloud,
# where Claude has a shell, reaches only the server's gateway and the internet. The rules live in chains of their
# own, rebuilt whole on every run, so an update never leaves them out of order; the unit rebuilds them after a reboot
say "Sandbox for the containers..."
$SUDO tee /usr/local/sbin/tgcv-firewall >/dev/null <<'EOF'
#!/bin/sh
# tg-claude: what the containers may reach (deploy/compose.yml fixes both subnets)
set -e
CLOUD=10.213.250.0/24
MAIN=10.213.251.0/24
PRIVATE="10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16 224.0.0.0/4"

# Between containers and out to the internet: FORWARD → DOCKER-USER → TGCV
iptables -N TGCV 2>/dev/null || iptables -F TGCV
# Replies on connections already let through (Caddy's answers, downloads)
iptables -A TGCV -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
# The provider's metadata service, from any container at all
iptables -A TGCV -d 169.254.0.0/16 -j DROP
# Inside each network: the cloud to the server's gateway, Caddy to the server
iptables -A TGCV -s "$CLOUD" -d "$CLOUD" -j RETURN
iptables -A TGCV -s "$MAIN" -d "$MAIN" -j RETURN
# Every other private address: other networks, the VPS's LAN, other containers
for src in "$CLOUD" "$MAIN"; do for dst in $PRIVATE; do iptables -A TGCV -s "$src" -d "$dst" -j DROP; done; done
iptables -C DOCKER-USER -j TGCV 2>/dev/null || iptables -I DOCKER-USER -j TGCV

# The VPS itself (SSH, Docker, anything listening on it): containers open no connections to it
iptables -N TGCV-IN 2>/dev/null || iptables -F TGCV-IN
iptables -A TGCV-IN -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
iptables -A TGCV-IN -s "$CLOUD" -j DROP
iptables -A TGCV-IN -s "$MAIN" -j DROP
iptables -C INPUT -j TGCV-IN 2>/dev/null || iptables -I INPUT -j TGCV-IN
EOF
$SUDO chmod 755 /usr/local/sbin/tgcv-firewall
$SUDO tee /etc/systemd/system/tgcv-firewall.service >/dev/null <<'EOF'
[Unit]
Description=tg-claude: what the containers may reach
After=docker.service
Requires=docker.service
PartOf=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/tgcv-firewall
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
$SUDO systemctl daemon-reload
$SUDO systemctl enable tgcv-firewall.service >/dev/null 2>&1 || true
# restart, not start: an update must rebuild the rules even when the unit already ran
$SUDO systemctl restart tgcv-firewall.service || $SUDO /usr/local/sbin/tgcv-firewall
$SUDO iptables -C DOCKER-USER -j TGCV >/dev/null 2>&1 || die "The sandbox did not come up: the iptables rules were not applied."

# --- A message about SSH logins ------------------------------------------------------------------------------
# Optional in PAM: whatever happens in the script, nobody is locked out. It reads the bot token and the owner when it runs
say "A message about SSH logins..."
$SUDO install -m 755 "$SRC/deploy/tgcv-ssh-alert.sh" /usr/local/sbin/tgcv-ssh-alert
if [ -f /etc/pam.d/sshd ] && ! $SUDO grep -q tgcv-ssh-alert /etc/pam.d/sshd; then
  echo "session optional pam_exec.so /usr/local/sbin/tgcv-ssh-alert $ENV_FILE" | $SUDO tee -a /etc/pam.d/sshd >/dev/null
fi

# --- Updates from the bot ---------------------------------------------------------------------------------
# The bot leaves a release tag in a folder it shares with this helper; the helper (root, outside the containers)
# checks it, switches the code, rebuilds and puts the old version back if the new one doesn't come up. A copy of
# the script outside the checkout: a later checkout can't change what root runs until the next install
say "Updates from the bot..."
UPDATE_DIR=/var/lib/tgcv/update
$SUDO install -d -m 700 -o 1000 -g 1000 "$UPDATE_DIR"
$SUDO install -m 755 "$SRC/deploy/tgcv-update.sh" /usr/local/sbin/tgcv-update
$SUDO tee /etc/systemd/system/tgcv-update.service >/dev/null <<EOF
[Unit]
Description=tg-claude: switch to a newer release asked for in the bot

[Service]
Type=oneshot
Environment=TGCV_SRC=$SRC
Environment=TGCV_UPDATE_DIR=$UPDATE_DIR
Environment=TGCV_TOKEN_FILE=$TOKEN_FILE
TimeoutStartSec=30min
ExecStart=/usr/local/sbin/tgcv-update
EOF
# A request to update, or to look for releases now (/update in the bot)
$SUDO tee /etc/systemd/system/tgcv-update.path >/dev/null <<EOF
[Unit]
Description=tg-claude: update requests from the bot

[Path]
PathExists=$UPDATE_DIR/request
PathExists=$UPDATE_DIR/check
Unit=tgcv-update.service

[Install]
WantedBy=multi-user.target
EOF
# …and a look once a day on its own
$SUDO tee /etc/systemd/system/tgcv-update.timer >/dev/null <<EOF
[Unit]
Description=tg-claude: look for new releases once a day

[Timer]
OnBootSec=3min
OnUnitActiveSec=1d
RandomizedDelaySec=1h

[Install]
WantedBy=timers.target
EOF
$SUDO systemctl daemon-reload
$SUDO systemctl enable --now tgcv-update.path tgcv-update.timer >/dev/null 2>&1 || die "The update helper (tgcv-update) did not start."
# install replaces whatever is there: on a run after the first, the folder is the container's and may hold a link
echo 1 | $SUDO install -o 1000 -g 1000 -m 644 /dev/stdin "$UPDATE_DIR/ready"

# --- Build and start ------------------------------------------------------------------------------------
VERSION="$(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo unknown)"
# compose reads .env for the build argument too: the version shows up in /diag
sed -i '/^TGCV_VERSION=/d' "$ENV_FILE" && echo "TGCV_VERSION=$VERSION" >> "$ENV_FILE"
say "Building and starting (version ${VERSION})..."
$SUDO docker compose up -d --build 2>&1 | tail -n 5
# The bot knows about new releases from the start
$SUDO systemctl start --no-block tgcv-update.service || true

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
BOT="${BOT:-$(curl -fsS "https://api.telegram.org/bot${TG_TOKEN}/getMe" | sed -n 's/.*"username":"\([^"]*\)".*/\1/p')}"

say "Done. Server: wss://$DOMAIN/device"
if [ "${FIRST_RUN:-}" = 1 ]; then
  cat <<EOF

1. Make the bot yours: open https://t.me/$BOT?start=$CLAIM and press Start.
2. Sign in to Claude (soon with a button in the bot):
     cd $SRC/deploy && $SUDO docker compose exec -it server npm run login
3. Connect a computer: send /pair to the bot and it gives you the command.
EOF
  if grep -q '^COMPOSE_PROFILES=.*cloud' "$ENV_FILE"; then
    echo "4. The cloud is already online. GitHub is connected to it in the bot: /github"
  fi
  cat <<EOF

Backup key: save it in a password manager, the backups cannot be read without it:
  $BACKUP_KEY
It is also in ${ENV_FILE}.
EOF
else
  echo "Updated. Logs: cd $SRC/deploy && $SUDO docker compose logs -f server"
fi
