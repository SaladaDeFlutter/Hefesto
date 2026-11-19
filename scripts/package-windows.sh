#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCH="${1:-x64}"
case "$ARCH" in
  x64 | arm64) ;;
  *)
    echo "uso: $0 [x64|arm64]" >&2
    exit 1
    ;;
esac

NODE_CHANNEL="${NODE_CHANNEL:-latest-v26.x}"
OPENCODE_VERSION="${OPENCODE_VERSION:-1.19.6}"
OUT_DIR="${OUT_DIR:-$ROOT/dist}"
VERSION="${HEFESTO_VERSION:-$(node -e 'console.log(require(process.argv[1] + "/package.json").version)' "$ROOT")}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
APP="$WORK/Hefesto"
mkdir -p "$APP/packages"

cp -R "$ROOT/bin" "$ROOT/scripts" "$ROOT/docs" "$APP/"
cp "$ROOT/README.md" "$ROOT/package.json" "$ROOT/package-lock.json" "$ROOT/.env.example" "$APP/"

for pkg in core engine server connectors; do
  cp -R "$ROOT/packages/$pkg" "$APP/packages/$pkg"
done
mkdir -p "$APP/packages/web"
cp -R "$ROOT/packages/web/dist" "$APP/packages/web/dist"
cp "$ROOT/packages/web/package.json" "$APP/packages/web/package.json"

find "$APP" -type d -name node_modules -prune -exec rm -rf {} +

if [ ! -f "$APP/packages/web/dist/index.html" ]; then
  echo "build da web ausente; rode: npm run build" >&2
  exit 1
fi

echo "> dependências de produção (win32-$ARCH)"
(cd "$APP" && npm install \
  --omit=dev \
  --ignore-scripts \
  --os="win32" \
  --cpu="$ARCH" \
  --no-audit \
  --no-fund \
  --loglevel=error)

# npm workspaces criam symlinks que o zip do Windows não preserva de forma confiável.
find "$APP" -type l -delete

if [ ! -f "$APP/node_modules/@esbuild/win32-$ARCH/esbuild.exe" ]; then
  echo "esbuild para win32-$ARCH não foi instalado" >&2
  exit 1
fi

echo "> Node.js ($NODE_CHANNEL, win-$ARCH)"
SUMS="$(curl -fsSL "https://nodejs.org/dist/$NODE_CHANNEL/SHASUMS256.txt")"
LINE="$(printf '%s\n' "$SUMS" | grep "win-$ARCH.zip\$" | head -n 1)"
if [ -z "$LINE" ]; then
  echo "Node.js indisponível para win-$ARCH" >&2
  exit 1
fi
EXPECTED="${LINE%% *}"
FILE="${LINE##* }"
curl -fsSL -o "$WORK/node.zip" "https://nodejs.org/dist/$NODE_CHANNEL/$FILE"
ACTUAL="$(sha256sum "$WORK/node.zip" | cut -d' ' -f1)"
if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "checksum do Node.js não confere" >&2
  exit 1
fi
unzip -q "$WORK/node.zip" -d "$WORK/node"
mv "$WORK/node/${FILE%.zip}" "$APP/node"

echo "> opencode $OPENCODE_VERSION (windows-$ARCH)"
curl -fsSL -o "$WORK/opencode.tgz" \
  "https://registry.npmjs.org/opencode-windows-$ARCH/-/opencode-windows-$ARCH-$OPENCODE_VERSION.tgz"
mkdir -p "$APP/opencode"
tar -xzf "$WORK/opencode.tgz" -C "$WORK" package/bin/opencode.exe
mv "$WORK/package/bin/opencode.exe" "$APP/opencode/opencode.exe"

printf '%s\r\n' \
  '@echo off' \
  'setlocal' \
  'set "HEFESTO_HOME=%~dp0"' \
  'set "PATH=%~dp0node;%~dp0opencode;%PATH%"' \
  'if not exist "%~dp0node\node.exe" (' \
  '  echo Node portátil ausente. Extraia o zip novamente.' \
  '  exit /b 1' \
  ')' \
  '"%~dp0node\node.exe" "%~dp0bin\hefesto.mjs" %*' \
  >"$APP/hefesto.cmd"

printf '%s\r\n' \
  'Hefesto para Windows' \
  '' \
  'Execute hefesto.cmd para abrir o Hefesto.' \
  'O navegador abre sozinho em http://127.0.0.1:4100' \
  '' \
  'Para usar de qualquer pasta, crie um atalho para hefesto.cmd' \
  'ou adicione esta pasta ao seu PATH de usuário.' \
  >"$APP/LEIA-ME.txt"

mkdir -p "$OUT_DIR"
ZIP="$OUT_DIR/hefesto-windows-$ARCH.zip"
rm -f "$ZIP"
(cd "$WORK" && zip -qr "$ZIP" Hefesto)

echo
echo "$ZIP"
sha256sum "$ZIP"

if command -v makensis >/dev/null 2>&1; then
  echo
  echo "> instalador NSIS (win-$ARCH, versão $VERSION)"
  SETUP="$OUT_DIR/Hefesto-Setup-$ARCH.exe"
  rm -f "$SETUP"
  makensis -V2 \
    -DAPP_SOURCE="$APP" \
    -DAPP_VERSION="$VERSION" \
    -DAPP_ARCH="$ARCH" \
    -DOUTFILE="$SETUP" \
    "$ROOT/scripts/installer.nsi"
  echo "$SETUP"
  sha256sum "$SETUP"
else
  echo "! makensis não encontrado; instalador .exe não foi gerado" >&2
fi
