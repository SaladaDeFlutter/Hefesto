#!/usr/bin/env bash
set -Eeuo pipefail

HEFESTO_HOME="${HEFESTO_HOME:-$HOME/.hefesto}"
SRC_DIR="$HEFESTO_HOME/src"
NODE_DIR="$HEFESTO_HOME/node"
OPENCODE_PREFIX="$HEFESTO_HOME/opencode"
BIN_DIR="${HEFESTO_BIN_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}"
TARGET="$BIN_DIR/hefesto"
REPO_TARBALL="${HEFESTO_REPO_TARBALL:-https://github.com/SaladaDeFlutter/Hefesto/archive/refs/heads/main.tar.gz}"
MODE="install"
TMP=""

for arg in "$@"; do
  case "$arg" in
    --upgrade) MODE="upgrade" ;;
    --help|-h)
      printf 'Uso: bootstrap.sh [--upgrade]\n'
      printf 'Instala Node 26, opencode e Hefesto em %s (sem sudo).\n' "$HEFESTO_HOME"
      exit 0
      ;;
    *) printf 'argumento desconhecido: %s\n' "$arg" >&2; exit 1 ;;
  esac
done

if [ -t 1 ]; then
  RESET=$'\033[0m'; BOLD=$'\033[1m'; DIM=$'\033[2m'
  AMBER=$'\033[38;5;214m'; GREEN=$'\033[38;5;114m'
  RED=$'\033[38;5;203m'; BLUE=$'\033[38;5;117m'; MUTED=$'\033[38;5;244m'
else
  RESET=""; BOLD=""; DIM=""; AMBER=""; GREEN=""; RED=""; BLUE=""; MUTED=""
fi

step() { printf '\n%s▸%s %s%s%s\n' "$AMBER" "$RESET" "$BOLD" "$*" "$RESET"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '  %s!%s %s\n' "$AMBER" "$RESET" "$*"; }
die()  { printf '\n  %s✗%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }
cleanup() { [ -n "$TMP" ] && rm -rf "$TMP"; }
trap cleanup EXIT

banner() {
  printf '\n%s' "$AMBER"
  cat <<'ART'
██╗  ██╗███████╗███████╗███████╗███████╗████████╗ ███████╗
██║  ██║██╔════╝██╔════╝██╔════╝██╔════╝╚══██╔══╝██╔═══██╗
███████║█████╗  █████╗  █████╗  ███████╗   ██║   ██║   ██║
██╔══██║██╔══╝  ██╔══╝  ██╔══╝  ╚════██║   ██║   ██║   ██║
██║  ██║███████╗██║     ███████╗███████║   ██║   ╚██████╔╝
╚═╝  ╚═╝╚══════╝╚═╝     ╚══════╝╚══════╝   ╚═╝    ╚══════╝
ART
  printf '%s' "$RESET"
  printf '  %sa forja de agentes opencode%s\n' "$MUTED" "$RESET"
  printf '  %sinstalador Linux · user-space · sem sudo%s\n\n' "$DIM" "$RESET"
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "faltando: $1"
}

check_space() {
  mkdir -p "$HEFESTO_HOME"
  local avail_kb
  avail_kb="$(df -Pk "$HEFESTO_HOME" | awk 'NR == 2 {print $4}')"
  if [ -n "$avail_kb" ] && [ "$avail_kb" -lt 900000 ]; then
    die "espaço insuficiente em $HEFESTO_HOME: $((avail_kb / 1024)) MB livres; libere pelo menos ~900 MB."
  fi
}

node_ok() {
  [ -x "$NODE_DIR/bin/node" ] || return 1
  [ -x "$NODE_DIR/bin/npm" ] || return 1
  "$NODE_DIR/bin/node" -e 'const [m]=process.versions.node.split(".").map(Number); process.exit(m>=26?0:1)' >/dev/null 2>&1
}

opencode_ok() {
  [ -x "$OPENCODE_PREFIX/bin/opencode" ]
}

install_node() {
  step "1/4  Node.js 26 portátil"
  local sums archive url
  sums="$(curl -fsSL 'https://nodejs.org/dist/latest-v26.x/SHASUMS256.txt')" || die "não consegui consultar o Node.js"
  archive="$(printf '%s\n' "$sums" | awk -v a="$ARCH" '$2 ~ ("linux-" a "\\.tar\\.gz$") {print $2; exit}')"
  [ -n "$archive" ] || die "Node.js indisponível para linux-$ARCH"
  url="https://nodejs.org/dist/latest-v26.x/$archive"
  printf '  %sbaixando %s%s\n' "$MUTED" "$archive" "$RESET"
  curl -fL --progress-bar "$url" -o "$TMP/$archive" || die "falhou o download do Node.js"
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$TMP" && printf '%s\n' "$sums" | awk -v f="$archive" '$2 == f {print}' | sha256sum -c - >/dev/null) \
      || die "checksum do Node.js não confere"
  fi
  rm -rf "$NODE_DIR"
  mkdir -p "$NODE_DIR"
  tar -xzf "$TMP/$archive" -C "$NODE_DIR" --strip-components=1
  ok "$("$NODE_DIR/bin/node" -v) instalado em $NODE_DIR"
}

install_opencode() {
  step "2/4  opencode"
  local pkg="opencode-linux-$ARCH"
  local bin="$OPENCODE_PREFIX/lib/node_modules/$pkg/bin/opencode"
  rm -rf "$OPENCODE_PREFIX"
  "$NODE_DIR/bin/npm" install -g "$pkg@latest" --prefix "$OPENCODE_PREFIX" \
    --no-fund --no-audit --loglevel=error || die "falhou a instalação do opencode"
  [ -x "$bin" ] || die "binário do opencode não encontrado em $bin"
  mkdir -p "$OPENCODE_PREFIX/bin"
  ln -sfn "$bin" "$OPENCODE_PREFIX/bin/opencode"
  ok "opencode $("$OPENCODE_PREFIX/bin/opencode" --version) instalado em $OPENCODE_PREFIX"
}

install_hefesto() {
  step "3/4  Hefesto"
  local new_src="$HEFESTO_HOME/src.new"
  local old_src="$HEFESTO_HOME/src.old"
  rm -rf "$new_src" "$TMP/source"
  mkdir -p "$TMP/source"
  printf '  %sbaixando código do Hefesto%s\n' "$MUTED" "$RESET"
  curl -fL --progress-bar "$REPO_TARBALL" -o "$TMP/hefesto.tar.gz" || die "falhou o download do Hefesto"
  tar -xzf "$TMP/hefesto.tar.gz" -C "$TMP/source" --strip-components=1
  mkdir -p "$new_src"
  cp -a "$TMP/source/." "$new_src/"
  cd "$new_src"
  "$NODE_DIR/bin/npm" install --no-fund --no-audit --loglevel=error || die "falhou o npm install do Hefesto"
  "$NODE_DIR/bin/npm" run build || die "falhou o build da interface"
  [ -f "$new_src/packages/web/dist/index.html" ] || die "build da web não foi gerado"
  rm -rf "$old_src"
  if [ -d "$SRC_DIR" ]; then mv "$SRC_DIR" "$old_src"; fi
  mv "$new_src" "$SRC_DIR"
  rm -rf "$old_src"
  ok "Hefesto instalado em $SRC_DIR"
}

install_command() {
  step "4/4  comando hefesto"
  mkdir -p "$BIN_DIR"
  cat > "$TARGET" <<WRAP
#!/usr/bin/env bash
export HEFESTO_HOME="$HEFESTO_HOME"
export HEFESTO_BIN_DIR="$BIN_DIR"
export HEFESTO_BOOTSTRAP=1
export PATH="$NODE_DIR/bin:$OPENCODE_PREFIX/bin:\$PATH"
exec "$NODE_DIR/bin/node" "$SRC_DIR/bin/hefesto.mjs" "\$@"
WRAP
  chmod +x "$TARGET"
  ok "comando criado em $TARGET"

  if [ "${HEFESTO_NO_RC:-0}" != "1" ]; then
    add_path "$HOME/.bashrc"
    add_path "$HOME/.zshrc"
    add_path "$HOME/.profile"
  fi
}

add_path() {
  local file="$1"
  [ -f "$file" ] || return 0
  if grep -q '# >>> hefesto >>>' "$file" 2>/dev/null; then return 0; fi
  printf '\n# >>> hefesto >>>\nexport PATH="%s:$PATH"\n# <<< hefesto <<<\n' "$BIN_DIR" >> "$file"
}

case "$(uname -s)" in
  Linux) ;;
  *) die "este instalador é Linux-only por enquanto" ;;
esac

case "$(uname -m)" in
  x86_64|amd64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) die "arquitetura não suportada: $(uname -m)" ;;
esac

need curl
need tar
need gzip
need awk
need sed

banner
printf '\n  %sdestino%s  %s\n' "$BOLD" "$RESET" "$HEFESTO_HOME"
printf '  %smode%s     %s\n' "$BOLD" "$RESET" "$MODE"

TMP="$(mktemp -d)"
check_space

if [ "$MODE" = "upgrade" ]; then
  step "0/4  verificando dependências"
  node_ok || install_node
  opencode_ok || install_opencode
  ok "Node e opencode prontos"
else
  node_ok || install_node
  opencode_ok || install_opencode
fi

export PATH="$NODE_DIR/bin:$OPENCODE_PREFIX/bin:$PATH"
install_hefesto
install_command

printf '\n%s  Hefesto pronto.%s\n\n' "$GREEN$BOLD" "$RESET"
printf '  %shefesto%s          inicia e abre o navegador\n' "$AMBER" "$RESET"
printf '  %shefesto upgrade%s  atualiza para a versão atual\n' "$AMBER" "$RESET"
printf '  %shefesto help%s     mostra os comandos\n\n' "$AMBER" "$RESET"

if [ "${HEFESTO_NO_RC:-0}" != "1" ]; then
  case ":${PATH}:" in
    *":${BIN_DIR}:"*) ;;
    *) printf '  %sabra um novo terminal ou rode:%s export PATH="%s:$PATH"\n\n' "$MUTED" "$RESET" "$BIN_DIR" ;;
  esac
fi
