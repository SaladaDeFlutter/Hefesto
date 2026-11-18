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

printf '\nHefesto instalado em %s\n\n' "$TARGET"
printf 'Use:\n  hefesto\n  hefesto upgrade\n\n'
case ":${PATH}:" in
  *":${BIN_DIR}:"*) ;;
  *)
    printf 'Adicione ao PATH se necessário:\n  export PATH="%s:$PATH"\n' "$BIN_DIR"
    ;;
esac
