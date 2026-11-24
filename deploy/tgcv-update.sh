#!/usr/bin/env bash
# tg-claude: the server's go-between with GitHub. Runs as root on the VPS, outside the containers, started by
# systemd: tgcv-update.path when the bot leaves a request or asks for a check, tgcv-update.timer once a day.
#   check:  asks GitHub which releases there are and leaves the answers in $DIR (tags.txt, release.json), so the
#           container never holds the GitHub token
#   update: moves the server to the tag in $DIR/request. The bot can only name a tag: which tags count, where the
#           code comes from and how it is started are all decided here. The new version must say it is alive
#           within $WAIT seconds, or the old one is put back
set -uo pipefail

SRC="${TGCV_SRC:?the checkout the installer made}"
DIR="${TGCV_UPDATE_DIR:-/var/lib/tgcv/update}"
DOCKER="${TGCV_DOCKER:-docker}"
WAIT="${TGCV_UPDATE_WAIT:-180}"
TOKEN_FILE="${TGCV_TOKEN_FILE:-/etc/tgcv/github-token}"
SELF="${TGCV_SELF:-/usr/local/sbin/tgcv-update}"
# Never a login prompt: with no access it fails and says so
export GIT_TERMINAL_PROMPT=0

cd "$SRC" || exit 1

# git and the files of the checkout as the user who owns it: root's git refuses someone else's repo, and files
# rewritten by root would lock that user out of their own checkout
OWNER="$(stat -c %U "$SRC" 2>/dev/null || id -un)"
as_owner() {
  if [ "$OWNER" = "$(id -un)" ]; then "$@"; else runuser -u "$OWNER" -- "$@"; fi
}
git() { as_owner command git "$@"; }

# $DIR belongs to the container and this runs as root: a link left there by a server taken over would send a write or a
# chown anywhere on the VPS. So nothing is written or chowned in there: what is left for the bot is made in a folder only
# root can reach, next to $DIR so a move is a rename, and a rename replaces a link instead of following it
WORK="$(mktemp -d "$(dirname "$DIR")/.tgcv-update.XXXXXX" 2>/dev/null || mktemp -d)" || exit 1
trap 'rm -rf "$WORK"' EXIT

# The bot runs as uid 1000 in its container: what is left for it must be readable there. -T: a folder in the way is
# no place to put it into. (macOS has no -T, for the tests)
leave() {
  chown --reference="$DIR" "$WORK/$1" 2>/dev/null || true
  mv -fT "$WORK/$1" "$DIR/$1" 2>/dev/null || { rm -rf "${DIR:?}/$1"; mv -f "$WORK/$1" "$DIR/$1"; }
}

check() {
  rm -f "$DIR/check"
  # The notes of the newest release first, when it has a GitHub Release (owner/name from the origin address):
  # the bot takes a new tags.txt as «the look is done»
  local slug token=""
  slug="$(git remote get-url origin 2>/dev/null | sed -n 's#.*github\.com[/:]\([^/]*/[^/]*\)$#\1#p' | sed 's/\.git$//')"
  [ -r "$TOKEN_FILE" ] && token="$(tr -d '[:space:]' < "$TOKEN_FILE")"
  if [ -n "$slug" ] && curl -fsSL --max-time 20 -H 'Accept: application/vnd.github+json' ${token:+-H "Authorization: Bearer $token"} \
      "https://api.github.com/repos/$slug/releases/latest" -o "$WORK/release.json" 2>/dev/null; then
    leave release.json
  else
    rm -f "$DIR/release.json"
  fi
  git ls-remote --tags origin > "$WORK/tags.txt" 2>/dev/null && leave tags.txt
}

[ -f "$DIR/request" ] || { check; exit 0; }

TAG="$(sed -n 's/.*"tag" *: *"\(v[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)".*/\1/p' "$DIR/request" | head -n 1)"
rm -f "$DIR/request"
FROM="$(sed -n 's/^ *"version" *: *"\([^"]*\)".*/\1/p' package.json | head -n 1)"
TO="${TAG#v}"

# The outcome for the bot: fixed texts only, so nothing needs escaping
result() {
  if [ "$1" = true ]; then
    printf '{"ok":true,"from":"%s","to":"%s"}\n' "$FROM" "$TO" > "$WORK/result"
  else
    printf '{"ok":false,"from":"%s","to":"%s","error":"%s"}\n' "$FROM" "$TO" "$2" > "$WORK/result"
  fi
  leave result
}

[ -n "$TAG" ] || { result false "the request has no version number"; exit 0; }
# Forward only: a server taken over can't ask for an older release with known holes
if [ "$FROM" = "$TO" ] || [ "$(printf '%s\n%s\n' "$FROM" "$TO" | sort -V | tail -n 1)" != "$TO" ]; then
  result false "version $TO is not newer than $FROM"
  exit 0
fi
git fetch -q --tags origin || { result false "could not fetch from GitHub: check the token (sudo bash deploy/install-server.sh)"; exit 0; }
git rev-parse -q --verify "refs/tags/$TAG^{commit}" >/dev/null || { result false "GitHub has no version $TAG"; exit 0; }
OLD="$(git rev-parse HEAD)"

# The code at a commit, its short id for /diag, built and started; the old containers run until the new ones replace them
deploy() {
  git checkout -q --detach "$1" || return 1
  local short
  short="$(git rev-parse --short HEAD)"
  as_owner sed -i '/^TGCV_VERSION=/d' deploy/.env && as_owner sh -c "echo TGCV_VERSION=$short >> deploy/.env"
  (cd deploy && $DOCKER compose up -d --build)
}

rm -f "$DIR/alive"
if deploy "refs/tags/$TAG"; then
  for _ in $(seq "$WAIT"); do
    if [ "$(head -c 64 "$DIR/alive" 2>/dev/null)" = "$TO" ]; then
      result true
      # The release the server now runs brings its own helper: the next look and the next update use it.
      # Only after a verified official release, so this is no more trust than the update itself
      [ -f "$SRC/deploy/tgcv-update.sh" ] && install -m 755 "$SRC/deploy/tgcv-update.sh" "$SELF" 2>/dev/null
      # The same for the message about SSH logins, where it was installed: this never turns it on
      ALERT="$(dirname "$SELF")/tgcv-ssh-alert"
      [ -f "$ALERT" ] && [ -f "$SRC/deploy/tgcv-ssh-alert.sh" ] && install -m 755 "$SRC/deploy/tgcv-ssh-alert.sh" "$ALERT" 2>/dev/null
      # Every build leaves its layers behind, tens of gigabytes after a few dozen releases. Enough stays that the slow
      # stage isn't built again each time; docker before 28 names the option differently. Never worth failing over
      $DOCKER builder prune -af --reserved-space 5GB >/dev/null 2>&1 || $DOCKER builder prune -af --keep-storage 5GB >/dev/null 2>&1 || true
      exit 0
    fi
    sleep 1
  done
  WHY="the new version did not come up within $WAIT s"
else
  WHY="the build of the new version failed"
fi
# Told before the old version starts again, so it finds the outcome when it comes up
result false "$WHY, rolled back to $FROM"
deploy "$OLD"
