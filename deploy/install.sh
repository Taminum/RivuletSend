#!/usr/bin/env bash
# RivuletSend one-command server install (Debian/Ubuntu).
#
#   curl -fsSL https://raw.githubusercontent.com/Taminum/RivuletSend/master/deploy/install.sh \
#     | sudo bash -s -- --domain send.example.com --email you@example.com
#
# Installs Docker if missing, fetches the repo, generates secrets, and brings up
# the stack behind Caddy with automatic HTTPS.
#
# Re-running is safe: existing secrets in .env are never regenerated (rotating
# JWT_SECRET would log everyone out; rotating the DB password would lock the
# API out of its own Postgres volume).
set -euo pipefail

REPO_URL="${RS_REPO_URL:-https://github.com/Taminum/RivuletSend.git}"
BRANCH="${RS_BRANCH:-master}"
INSTALL_DIR="${RS_INSTALL_DIR:-/opt/rivuletsend}"
DOMAIN="${RS_DOMAIN:-}"
EMAIL="${ACME_EMAIL:-}"
TURN_URL="${TURN_URL:-}"
TURN_USERNAME="${TURN_USERNAME:-}"
TURN_CREDENTIAL="${TURN_CREDENTIAL:-}"
PUBLIC_IP="${PUBLIC_IP:-}"
TURN_MIN_PORT="${TURN_MIN_PORT:-49160}"
TURN_MAX_PORT="${TURN_MAX_PORT:-49200}"
NO_TURN=0
ASSUME_YES=0
# Behind an existing reverse proxy (Nginx Proxy Manager, Traefik, ...): don't
# bind 80/443 or fetch a certificate; serve plain HTTP on a loopback port that
# the outer proxy forwards to.
BEHIND_PROXY=0
HTTP_PORT="${RS_HTTP_PORT:-8088}"
# When the reverse proxy itself runs in Docker, join its network so it can reach
# the app by container name (see docker-compose.npm-network.yml).
PROXY_NETWORK="${RS_PROXY_NETWORK:-}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: install.sh --domain <domain> --email <address> [options]

Required:
  --domain <domain>        Public domain pointing at this server (A/AAAA record)
  --email <address>        Contact address for Let's Encrypt

A TURN relay (coturn) is installed alongside the app by default — without one,
transfers fail for peers behind symmetric NAT.

Optional:
  --dir <path>             Install directory (default: /opt/rivuletsend)
  --branch <name>          Git branch to deploy (default: master)
  --public-ip <addr>       Public IP for the relay (default: detected)
  --turn-ports <min-max>   Relay UDP port range (default: 49160-49200)
  --turn-url <url>         Use an EXTERNAL TURN relay instead of installing one
  --turn-user <name>       External TURN username
  --turn-pass <secret>     External TURN credential
  --no-turn                Install no relay at all (not recommended)
  --behind-proxy           Run behind an existing reverse proxy (Nginx Proxy
                           Manager, Traefik, ...): don't bind 80/443 or fetch a
                           certificate; serve plain HTTP on a loopback port for
                           that proxy to forward to. TLS is the outer proxy's job.
  --http-port <port>       Loopback port for --behind-proxy (default: 8088)
  --proxy-network <name>   Reverse proxy runs in Docker too: join this existing
                           docker network so the proxy reaches the app by
                           container name (rivuletsend-caddy-1:80). Implies
                           --behind-proxy. Find it with `docker network ls`
                           (often npm_default / nginxproxymanager_default).
  -y, --yes                Don't stop for confirmations
  -h, --help               Show this help

Every option can also be given as an environment variable
(RS_DOMAIN, ACME_EMAIL, TURN_URL, ...).
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    --dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --turn-url) TURN_URL="${2:-}"; shift 2 ;;
    --turn-user) TURN_USERNAME="${2:-}"; shift 2 ;;
    --turn-pass) TURN_CREDENTIAL="${2:-}"; shift 2 ;;
    --public-ip) PUBLIC_IP="${2:-}"; shift 2 ;;
    --turn-ports)
      TURN_MIN_PORT="${2%%-*}"
      TURN_MAX_PORT="${2##*-}"
      shift 2
      ;;
    --no-turn) NO_TURN=1; shift ;;
    --behind-proxy) BEHIND_PROXY=1; shift ;;
    --http-port) HTTP_PORT="${2:-}"; shift 2 ;;
    --proxy-network) PROXY_NETWORK="${2:-}"; BEHIND_PROXY=1; shift 2 ;;
    -y|--yes) ASSUME_YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done

# --- Preflight ---------------------------------------------------------------

[ "$(id -u)" -eq 0 ] || die "run as root (prefix the command with sudo)"

[ -r /etc/os-release ] || die "unsupported OS: /etc/os-release not found"
# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}${ID_LIKE:-}" in
  *debian*|*ubuntu*) ;;
  *) warn "tested on Debian/Ubuntu; '${ID:-unknown}' may need manual Docker setup" ;;
esac

# When piped from curl, stdin is the script itself — prompt on the terminal.
ask() {
  local prompt="$1" reply=""
  [ -e /dev/tty ] || return 1
  printf '%s' "$prompt" > /dev/tty
  read -r reply < /dev/tty || return 1
  printf '%s' "$reply"
}

if [ -z "$DOMAIN" ]; then
  DOMAIN="$(ask 'Domain (e.g. send.example.com): ')" \
    || die "no --domain given and no terminal to ask on"
fi
if [ -z "$EMAIL" ]; then
  EMAIL="$(ask "Email for Let's Encrypt: ")" \
    || die "no --email given and no terminal to ask on"
fi

[ -n "$DOMAIN" ] || die "domain is empty"
[ -n "$EMAIL" ] || die "email is empty"
case "$DOMAIN" in
  *.*) ;;
  *) die "'$DOMAIN' is not a domain name — HTTPS needs a real one, an IP won't do" ;;
esac
case "$DOMAIN" in
  http*|*/*) die "give the bare domain, without scheme or path: send.example.com" ;;
esac
case "$EMAIL" in
  *@*.*) ;;
  *) die "'$EMAIL' is not an email address" ;;
esac

# Relay: a local coturn unless an external one was supplied (or TURN refused).
if [ "$NO_TURN" -eq 1 ]; then
  TURN_MODE=none
elif [ -n "$TURN_URL" ]; then
  TURN_MODE=external
  [ -n "$TURN_USERNAME" ] && [ -n "$TURN_CREDENTIAL" ] \
    || die "--turn-url needs --turn-user and --turn-pass"
else
  TURN_MODE=local
fi

case "$TURN_MODE" in
  local) turn_label="coturn on this server (ports $TURN_MIN_PORT-$TURN_MAX_PORT/udp)" ;;
  external) turn_label="external ($TURN_URL)" ;;
  none) turn_label="none — transfers will fail behind symmetric NAT" ;;
esac

# Compose file set: the prod stack, plus the proxy overlay when running behind
# an existing reverse proxy. Every compose command below uses $COMPOSE.
COMPOSE="docker compose -f docker-compose.prod.yml"
if [ "$BEHIND_PROXY" -eq 1 ]; then
  COMPOSE="$COMPOSE -f docker-compose.proxy.yml"
  case "$HTTP_PORT" in
    ''|*[!0-9]*) die "--http-port must be a number (got '$HTTP_PORT')" ;;
  esac
  if [ -n "$PROXY_NETWORK" ]; then
    COMPOSE="$COMPOSE -f docker-compose.npm-network.yml"
    serve_label="behind a dockerized proxy — on network '$PROXY_NETWORK' as rivuletsend-caddy-1:80"
  else
    serve_label="behind a reverse proxy — plain HTTP on 127.0.0.1:$HTTP_PORT"
  fi
else
  serve_label="Caddy on 80/443 with automatic HTTPS"
fi

bold "RivuletSend installer"
info "domain     $DOMAIN"
info "email      $EMAIL"
info "directory  $INSTALL_DIR"
info "branch     $BRANCH"
info "serving    $serve_label"
info "TURN       $turn_label"
echo

# --- Dependencies ------------------------------------------------------------

export DEBIAN_FRONTEND=noninteractive
apt_updated=0
apt_install() {
  if [ "$apt_updated" -eq 0 ]; then
    bold "Updating package lists"
    apt-get update -qq
    apt_updated=1
  fi
  apt-get install -y -qq "$@" >/dev/null
}

command -v curl >/dev/null 2>&1 || apt_install curl ca-certificates
command -v git >/dev/null 2>&1 || apt_install git
command -v openssl >/dev/null 2>&1 || apt_install openssl

if ! command -v docker >/dev/null 2>&1; then
  bold "Installing Docker"
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 \
  || die "docker compose v2 plugin missing — install docker-compose-plugin and re-run"
systemctl enable --now docker >/dev/null 2>&1 || true

# --- Address checks ----------------------------------------------------------

# Let's Encrypt validates over HTTP, so a domain that doesn't resolve here means
# certificate issuance will fail. Warn early instead of failing deep in Caddy.
[ -n "$PUBLIC_IP" ] || PUBLIC_IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
resolved="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1 {print $1}' || true)"
if [ -z "$resolved" ]; then
  warn "$DOMAIN does not resolve yet — HTTPS will fail until the DNS record exists"
elif [ -n "$PUBLIC_IP" ] && [ "$resolved" != "$PUBLIC_IP" ]; then
  warn "$DOMAIN resolves to $resolved but this server looks like $PUBLIC_IP"
  warn "if that is not a proxy (Cloudflare etc.), certificate issuance will fail"
fi

# coturn must advertise the address peers can actually reach. On a cloud VM the
# interface usually holds a private address behind 1:1 NAT, so a wrong value
# here produces relay candidates nobody can connect to.
if [ "$TURN_MODE" = local ] && [ -z "$PUBLIC_IP" ]; then
  if [ -n "$resolved" ]; then
    PUBLIC_IP="$resolved"
    warn "could not detect this server's public IP; using $PUBLIC_IP from DNS"
  else
    die "could not detect the public IP for the relay — pass --public-ip <addr>"
  fi
fi
if [ "$ASSUME_YES" -eq 0 ] && [ -e /dev/tty ]; then
  case "$(ask 'Continue? [Y/n] ')" in
    [nN]*) die "aborted" ;;
  esac
fi

# --- Fetch the repo ----------------------------------------------------------

if [ -d "$INSTALL_DIR/.git" ]; then
  bold "Updating $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$INSTALL_DIR" checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  bold "Cloning into $INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# --- Secrets and .env --------------------------------------------------------

# Read a value already present in .env, so re-runs keep working secrets.
existing() {
  [ -f .env ] || return 0
  sed -n "s/^$1=//p" .env | head -1
}

JWT_SECRET="$(existing JWT_SECRET)"
INTERNAL_SECRET="$(existing INTERNAL_SECRET)"
POSTGRES_PASSWORD="$(existing POSTGRES_PASSWORD)"
TURN_SECRET="$(existing TURN_SECRET)"
[ -n "$JWT_SECRET" ] || JWT_SECRET="$(openssl rand -hex 32)"
[ -n "$INTERNAL_SECRET" ] || INTERNAL_SECRET="$(openssl rand -hex 32)"
[ -n "$TURN_SECRET" ] || TURN_SECRET="$(openssl rand -hex 32)"
if [ -z "$POSTGRES_PASSWORD" ]; then
  # Hex only: the password is interpolated into a postgres:// URL, where '@'
  # or '/' from a random base64 string would corrupt the connection string.
  POSTGRES_PASSWORD="$(openssl rand -hex 24)"
fi

# With a local relay the API mints credentials for it, and the browser fetches
# them at runtime — nothing TURN-related is baked into the web bundle.
# COMPOSE_PROFILES is read from .env by docker compose, so plain
# `docker compose -f docker-compose.prod.yml up -d` in this directory keeps
# starting coturn too.
if [ "$TURN_MODE" = local ]; then
  TURN_URLS="turn:$DOMAIN:3478?transport=udp,turn:$DOMAIN:3478?transport=tcp"
  COMPOSE_PROFILES=coturn
else
  TURN_URLS=""
  COMPOSE_PROFILES=""
fi
# Inert unless coturn runs, but compose interpolates it either way.
[ -n "$PUBLIC_IP" ] || PUBLIC_IP=0.0.0.0

bold "Writing .env"
umask 077
cat > .env <<EOF
# Generated by deploy/install.sh — keep this file secret.
RS_DOMAIN=$DOMAIN
ACME_EMAIL=$EMAIL
# Loopback HTTP port when running behind an external reverse proxy
# (docker-compose.proxy.yml). Ignored in the default 80/443 mode.
RS_HTTP_PORT=$HTTP_PORT
# External docker network of a dockerized reverse proxy, joined via
# docker-compose.npm-network.yml. Empty unless --proxy-network was used.
RS_PROXY_NETWORK=$PROXY_NETWORK

JWT_SECRET=$JWT_SECRET
INTERNAL_SECRET=$INTERNAL_SECRET
POSTGRES_PASSWORD=$POSTGRES_PASSWORD

# --- TURN relay ---
# Empty COMPOSE_PROFILES means no local coturn. If you enable it by hand, make
# sure PUBLIC_IP is this server's real public address.
COMPOSE_PROFILES=$COMPOSE_PROFILES
PUBLIC_IP=$PUBLIC_IP
TURN_MIN_PORT=$TURN_MIN_PORT
TURN_MAX_PORT=$TURN_MAX_PORT
# Shared with coturn; the API derives expiring credentials from it. Never
# reaches the browser.
TURN_SECRET=$TURN_SECRET
# Relay URLs the API hands to clients (local relay only).
TURN_URLS=$TURN_URLS

# External relay instead of the local one: these ARE compiled into the web
# bundle, so anyone can read them. Only for a provider you trust to rate-limit.
TURN_URL=$TURN_URL
TURN_USERNAME=$TURN_USERNAME
TURN_CREDENTIAL=$TURN_CREDENTIAL
EOF
chmod 600 .env
umask 022

# --- Firewall ----------------------------------------------------------------

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "^Status: active"; then
  bold "Opening ports in ufw"
  # Behind an external proxy the app binds only 127.0.0.1:$HTTP_PORT, and the
  # proxy already owns 80/443 — no web ports to open here.
  if [ "$BEHIND_PROXY" -eq 0 ]; then
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
    ufw allow 443/udp >/dev/null
  fi
  if [ "$TURN_MODE" = local ]; then
    # 3478 is the relay's control port; the range carries the relayed media.
    ufw allow 3478/tcp >/dev/null
    ufw allow 3478/udp >/dev/null
    ufw allow "$TURN_MIN_PORT:$TURN_MAX_PORT/udp" >/dev/null
  fi
fi

# --- Pull and start ----------------------------------------------------------

# The app images (api/signaling/web) are prebuilt in CI and published to GHCR,
# so the server only downloads them — no pnpm install, no tsc, no vite build on
# the VPS. This is what makes install/update fast even on a small machine.
bold "Pulling images and starting the stack"
$COMPOSE pull
$COMPOSE up -d

# --- Verify ------------------------------------------------------------------

# Behind a proxy, TLS and the public hostname belong to that proxy (which may
# not be wired up yet), so health-check the app's own loopback port instead.
if [ "$BEHIND_PROXY" -eq 1 ]; then
  health_url="http://127.0.0.1:$HTTP_PORT/api/health"
  live_where="on 127.0.0.1:$HTTP_PORT (point your reverse proxy here)"
else
  health_url="https://$DOMAIN/api/health"
  live_where="at https://$DOMAIN"
fi

bold "Waiting for the app to answer"
ok=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 5 "$health_url" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 5
done

echo
if [ "$ok" -eq 1 ]; then
  bold "RivuletSend is answering $live_where"
else
  warn "the stack is up but $health_url did not answer yet"
  if [ "$BEHIND_PROXY" -eq 0 ]; then
    warn "certificate issuance can take a minute; check the logs if it persists:"
  else
    warn "check the logs if it persists:"
  fi
  info "$COMPOSE logs -f caddy"
fi

case "$TURN_MODE" in
  local)
    # A relay that isn't reachable is worse than none: peers wait on it, then
    # fail. Check the control port from the outside before declaring success.
    if command -v ss >/dev/null 2>&1 && ! ss -lun 2>/dev/null | grep -q ":3478"; then
      warn "coturn is not listening on 3478/udp — check: docker compose -f docker-compose.prod.yml logs coturn"
    fi
    echo
    info "TURN relay: turn:$DOMAIN:3478 (udp+tcp), media on $TURN_MIN_PORT-$TURN_MAX_PORT/udp"
    info "If this server sits behind a cloud firewall or security group, allow"
    info "those ports there too — ufw rules alone are not enough."
    ;;
  none)
    echo
    warn "no TURN relay — transfers will fail for peers behind symmetric NAT"
    warn "(some mobile networks, corporate wifi). Re-run without --no-turn to add one."
    ;;
esac

if [ "$BEHIND_PROXY" -eq 1 ]; then
  if [ -n "$PROXY_NETWORK" ]; then
    fwd_host="rivuletsend-caddy-1   (container name, on network '$PROXY_NETWORK')"
    fwd_port=80
  else
    fwd_host="127.0.0.1   (or this server's IP / host.docker.internal)"
    fwd_port="$HTTP_PORT"
  fi
  cat <<EOF

Behind your reverse proxy — create a proxy host for $DOMAIN pointing at this app:
  Forward Hostname / IP:  $fwd_host
  Forward Port:           $fwd_port
  Scheme:                 http
  Websockets Support:     ON        (required — /ws is the signaling channel)
  SSL:                    request/force a certificate on the proxy (it does TLS)

The app already routes /api and /ws internally, so one proxy host is enough.
EOF
fi

cat <<EOF

Manage it with (note both -f files are needed):
  cd $INSTALL_DIR
  $COMPOSE ps
  $COMPOSE logs -f
  $COMPOSE down

Update to the latest version (fast — just pulls the new images):
  cd $INSTALL_DIR && git pull
  $COMPOSE pull && $COMPOSE up -d
EOF
