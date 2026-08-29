#!/bin/sh
set -eu

VERSION='0.2.0-preview.1'
TAG="v$VERSION"
REPOSITORY='Ricardo121380/only-my-pi'
NODE_VERSION='24.19.0'
NODE_ARCHIVE="node-v$NODE_VERSION-darwin-arm64.tar.gz"
NODE_SHA256='8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d'
PAYLOAD='thin'
APPROVED=0
PLAN_ONLY=0
TERMINATE_PI=0
CONFIGURE_SHELL=0

die() {
  printf '%s\n' "only-my-pi installer: $1" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --release)
      [ "$#" -ge 2 ] || die '--release requires an exact version'
      [ "$2" = "$VERSION" ] || die "this bootstrap supports only $VERSION"
      shift 2
      ;;
    --payload)
      [ "$#" -ge 2 ] || die '--payload requires thin or full'
      case "$2" in thin|full) PAYLOAD=$2 ;; *) die '--payload requires thin or full' ;; esac
      shift 2
      ;;
    --yes) APPROVED=1; shift ;;
    --plan) PLAN_ONLY=1; shift ;;
    --terminate-pi) TERMINATE_PI=1; shift ;;
    --configure-shell) CONFIGURE_SHELL=1; shift ;;
    *) die "unsupported argument: $1" ;;
  esac
done

[ "$(uname -s)" = 'Darwin' ] || die 'Public Preview supports only macOS 14+ on Apple Silicon'
[ "$(uname -m)" = 'arm64' ] || die 'Public Preview requires native Apple Silicon; Rosetta is not supported'
MACOS_MAJOR=$(sw_vers -productVersion | awk -F. '{print $1}')
case "$MACOS_MAJOR" in ''|*[!0-9]*) die 'could not determine the macOS version' ;; esac
[ "$MACOS_MAJOR" -ge 14 ] || die 'Public Preview requires macOS 14 or newer'
for tool in curl shasum tar awk mktemp; do command -v "$tool" >/dev/null 2>&1 || die "required system tool is unavailable: $tool"; done

if [ "$PLAN_ONLY" -eq 0 ] && [ "$APPROVED" -eq 0 ]; then
  if [ -t 0 ] && [ -t 1 ]; then
    printf '%s' "Install only-my-pi $VERSION ($PAYLOAD) into the current user's home? Type 'yes': "
    IFS= read -r answer
    [ "$answer" = 'yes' ] || die 'installation was not approved'
    APPROVED=1
  else
    die 'noninteractive installation requires --yes'
  fi
fi

WORK=$(mktemp -d "${TMPDIR:-/tmp}/only-my-pi-install.XXXXXXXX")
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT HUP INT TERM
DOWNLOAD="$WORK/release"
mkdir -m 700 "$DOWNLOAD"
BASE="https://github.com/$REPOSITORY/releases/download/$TAG"

download() {
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --output "$2" "$1"
}

download "$BASE/SHA256SUMS" "$DOWNLOAD/SHA256SUMS"
download "$BASE/release-index.json" "$DOWNLOAD/release-index.json"
download "$BASE/stack-manifest.json" "$DOWNLOAD/stack-manifest.json"
ASSET="only-my-pi-$VERSION-darwin-arm64-$PAYLOAD.tar.gz"
EXPECTED=$(awk -v asset="$ASSET" '$2 == asset { count += 1; digest = $1 } END { if (count == 1) print digest }' "$DOWNLOAD/SHA256SUMS")
case "$EXPECTED" in [0-9a-f][0-9a-f]*) [ "${#EXPECTED}" -eq 64 ] || die 'release checksum has an invalid length' ;; *) die 'release checksum is missing or invalid' ;; esac
download "$BASE/$ASSET" "$DOWNLOAD/$ASSET"
ACTUAL=$(shasum -a 256 "$DOWNLOAD/$ASSET" | awk '{print $1}')
[ "$ACTUAL" = "$EXPECTED" ] || die 'release asset checksum verification failed'

EXTRACTED="$WORK/extracted"
mkdir -m 700 "$EXTRACTED"
tar -xzf "$DOWNLOAD/$ASSET" -C "$EXTRACTED"
PAYLOAD_ROOT="$EXTRACTED/only-my-pi"
[ -f "$PAYLOAD_ROOT/only-my-pi.tgz" ] || die 'release payload does not contain the only-my-pi artifact'

if [ "$PAYLOAD" = 'full' ]; then
  NODE_ROOT="$PAYLOAD_ROOT/node"
else
  NODE_DOWNLOAD="$WORK/$NODE_ARCHIVE"
  download "https://nodejs.org/download/release/v$NODE_VERSION/$NODE_ARCHIVE" "$NODE_DOWNLOAD"
  ACTUAL_NODE=$(shasum -a 256 "$NODE_DOWNLOAD" | awk '{print $1}')
  [ "$ACTUAL_NODE" = "$NODE_SHA256" ] || die 'official Node archive checksum verification failed'
  NODE_EXTRACTED="$WORK/node"
  mkdir -m 700 "$NODE_EXTRACTED"
  tar -xzf "$NODE_DOWNLOAD" -C "$NODE_EXTRACTED"
  NODE_ROOT="$NODE_EXTRACTED/node-v$NODE_VERSION-darwin-arm64"
fi

NODE="$NODE_ROOT/bin/node"
NPM="$NODE_ROOT/lib/node_modules/npm/bin/npm-cli.js"
[ -x "$NODE" ] || die 'verified payload did not provide the embedded Node executable'
[ -f "$NPM" ] || die 'verified payload did not provide the embedded npm CLI'
BOOTSTRAP="$WORK/bootstrap"
BOOTSTRAP_HOME="$WORK/bootstrap-home"
BOOTSTRAP_CACHE="$WORK/bootstrap-cache"
mkdir -m 700 "$BOOTSTRAP" "$BOOTSTRAP_HOME" "$BOOTSTRAP_CACHE"
env -i \
  PATH="$NODE_ROOT/bin:/usr/bin:/bin" \
  HOME="$BOOTSTRAP_HOME" \
  TMPDIR="$WORK" \
  npm_config_cache="$BOOTSTRAP_CACHE" \
  npm_config_ignore_scripts=true \
  npm_config_audit=false \
  npm_config_fund=false \
  npm_config_offline=true \
  "$NODE" "$NPM" install --offline --ignore-scripts --no-audit --no-fund --omit=dev --omit=peer --legacy-peer-deps --package-lock=false --no-save --prefix "$BOOTSTRAP" -- "$PAYLOAD_ROOT/only-my-pi.tgz" >/dev/null

OMP="$BOOTSTRAP/node_modules/only-my-pi/bin/omp.mjs"
[ -f "$OMP" ] || die 'only-my-pi bootstrap package did not expose its CLI'
set -- "$NODE" "$OMP" stack install --bundle "$DOWNLOAD/$ASSET"
if [ "$PLAN_ONLY" -eq 0 ]; then set -- "$@" --apply --yes; fi
if [ "$TERMINATE_PI" -eq 1 ]; then set -- "$@" --terminate-pi; fi
if [ "$CONFIGURE_SHELL" -eq 1 ]; then set -- "$@" --configure-shell; fi
set -- "$@" --json

RUNTIME_PATH="$NODE_ROOT/bin:/usr/bin:/bin:/usr/sbin:/sbin"
env -i \
  PATH="$RUNTIME_PATH" \
  HOME="$HOME" \
  SHELL="${SHELL:-/bin/zsh}" \
  TMPDIR="${TMPDIR:-/tmp}" \
  NO_COLOR=1 \
  TERM=dumb \
  "$@"
