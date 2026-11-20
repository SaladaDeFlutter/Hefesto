#!/usr/bin/env bash
set -euo pipefail

HEFESTO_HOME="${HEFESTO_HOME:-$HOME/.hefesto}"
BIN_DIR="${HEFESTO_BIN_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
APPS_DIR="$DATA_HOME/applications"
ICON_DIR="$DATA_HOME/icons/hicolor/scalable/apps"
PURGE=0

for arg in "$@"; do
  case "$arg" in
    --purge) PURGE=1 ;;
    --help|-h)
      printf 'Uso: uninstall.sh [--purge]\n'
      printf 'Remove o comando hefesto, o atalho e a instalação em %s.\n' "$HEFESTO_HOME"
      printf 'Use --purge para remover também os dados em %s/hefesto.\n' "$DATA_HOME"
      exit 0
      ;;
    *) printf 'argumento desconhecido: %s\n' "$arg" >&2; exit 1 ;;
  esac
done

rm -f "$BIN_DIR/hefesto"
rm -f "$APPS_DIR/hefesto.desktop"
rm -f "$ICON_DIR/hefesto.svg"
rm -rf "$HEFESTO_HOME"

for file in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
  [ -f "$file" ] || continue
  awk '/# >>> hefesto >>>/ { skip = 1 } !skip { print } /# <<< hefesto <<</ { skip = 0 }' \
    "$file" > "$file.hefesto.tmp"
  mv "$file.hefesto.tmp" "$file"
done

if [ "$PURGE" = "1" ]; then
  rm -rf "$DATA_HOME/hefesto"
  printf 'Dados removidos de %s/hefesto\n' "$DATA_HOME"
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
fi

printf 'Hefesto removido.\n'
