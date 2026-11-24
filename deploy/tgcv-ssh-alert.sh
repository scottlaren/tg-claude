#!/usr/bin/env bash
# tg-claude: tells the main account about an SSH login from an address not seen lately. Run as root by pam_exec when a
# session opens, as an optional step: whatever happens here, the login goes on. It talks to Telegram itself, because the
# bot may be stopped or taken over, and it does so before the shell opens: whoever gets root can remove this, but only
# after the message has gone. Logins through a container are not SSH and don't reach it.
#   session optional pam_exec.so /usr/local/sbin/tgcv-ssh-alert <the server's .env>
set -u

[ "${PAM_TYPE:-}" = open_session ] || exit 0

ENV_FILE="${1:-}"
CHAT_FILE="${TGCV_ALERT_CHAT:-/etc/tgcv/alert-chat}"
OWNER_FILE="${TGCV_ALERT_OWNER:-/var/lib/tgcv/update/main-owner}"
LANG_FILE="${TGCV_ALERT_LANG:-/var/lib/tgcv/update/lang}"
SEEN="${TGCV_ALERT_SEEN:-/var/lib/tgcv/ssh-seen}"
SEEN_DAYS="${TGCV_ALERT_SEEN_DAYS:-30}"
API="${TGCV_ALERT_API:-https://api.telegram.org}"

setting() { sed -n "s/^$1=//p" "$ENV_FILE" 2>/dev/null | head -n 1 | tr -d "\"' \r"; }

# Letters and digits an address can have: this comes from the network and becomes a file name
RHOST="$(printf %s "${PAM_RHOST:-unknown}" | tr -cd '0-9A-Za-z:._-' | head -c 64)"
RUSER="$(printf %s "${PAM_USER:-unknown}" | tr -cd '0-9A-Za-z._-' | head -c 32)"

# Every command of a working session is a login: only an address not seen for a while is worth a message
install -d -m 700 "$SEEN" 2>/dev/null
if [ -n "$(find "$SEEN/$RHOST" -mtime "-$SEEN_DAYS" 2>/dev/null)" ]; then
  touch "$SEEN/$RHOST" 2>/dev/null
  exit 0
fi
touch "$SEEN/$RHOST" 2>/dev/null

# Whose it is, once and for good: the bot leaves it in a folder that a server taken over could rewrite
CHAT="$(tr -cd 0-9 < "$CHAT_FILE" 2>/dev/null)"
[ -n "$CHAT" ] || CHAT="$(setting OWNER_IDS | cut -d, -f1 | tr -cd 0-9)"
if [ -z "$CHAT" ]; then
  CHAT="$(tr -cd 0-9 < "$OWNER_FILE" 2>/dev/null)"
  [ -n "$CHAT" ] && { printf %s "$CHAT" > "$CHAT_FILE"; chmod 600 "$CHAT_FILE"; } 2>/dev/null
fi
TOKEN="$(setting TG_TOKEN)"
[ -n "$CHAT" ] && [ -n "$TOKEN" ] || exit 0

# RUSER and RHOST hold nothing HTML could take for markup: they were cut down to plain characters above
WHEN="$(date -u '+%d.%m %H:%M UTC')"
if [ "$(head -c 2 "$LANG_FILE" 2>/dev/null)" = ru ]; then
  TEXT="🚨 <b>Вход на VPS по SSH</b>

Кто: <code>$RUSER</code>
Откуда: <code>$RHOST</code>
Когда: $WHEN

Не ты? Сразу выключи VPS в панели хостинга."
else
  TEXT="🚨 <b>SSH login to the VPS</b>

Who: <code>$RUSER</code>
From: <code>$RHOST</code>
When: $WHEN

Not you? Power the VPS off in the hosting panel right away."
fi

# In the background: a login never waits on Telegram. The URL goes through stdin, so the token is not in any process list
(
  printf 'url = "%s/bot%s/sendMessage"\n' "$API" "$TOKEN" |
    curl -fsS --max-time 10 -K - --data-urlencode "chat_id=$CHAT" --data-urlencode "parse_mode=HTML" --data-urlencode "text=$TEXT"
) >/dev/null 2>&1 </dev/null &

exit 0
