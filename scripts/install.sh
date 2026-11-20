#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="${HOME}/.local/bin"
TARGET="${BIN_DIR}/hefesto"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'faltando: %s\n' "$1" >&2
    exit 1
  fi
}

need node
need npm
need opencode

node - <<'NODE'
const [major] = process.versions.node.split(".").map(Number);
if (major < 26) {
  console.error(`Node.js 26+ é necessário; versão atual: ${process.versions.node}`);
  process.exit(1);
}
NODE

cd "$ROOT"
npm install
npm run build
mkdir -p "$BIN_DIR"
cat > "$TARGET" <<EOF
#!/usr/bin/env bash
exec node "$ROOT/bin/hefesto.mjs" "\$@"
EOF
chmod +x "$TARGET"

DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
ICON_DIR="${DATA_HOME}/icons/hicolor/scalable/apps"
APPS_DIR="${DATA_HOME}/applications"
mkdir -p "$ICON_DIR" "$APPS_DIR"
cp "$ROOT/docs/hefesto-icon.svg" "$ICON_DIR/hefesto.svg"
cat > "$APPS_DIR/hefesto.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Hefesto
Comment=A forja de agentes opencode
Exec="$TARGET" open
Icon=hefesto
Terminal=false
Categories=Development;
StartupNotify=false
DESKTOP
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
fi

printf '\nHefesto instalado em %s\n\n' "$TARGET"
printf 'Use:\n  hefesto\n  hefesto open\n  hefesto stop\n  hefesto upgrade\n\n'
printf 'Atalho criado em %s\n' "$APPS_DIR/hefesto.desktop"
case ":${PATH}:" in
  *":${BIN_DIR}:"*) ;;
  *)
    printf 'Adicione ao PATH se necessário:\n  export PATH="%s:$PATH"\n' "$BIN_DIR"
    ;;
esac
