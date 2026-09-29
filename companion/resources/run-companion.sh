#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export GLYPHMEND_TESSDATA_DIR="$SCRIPT_DIR/tessdata"
case "$(uname -s)" in
  Darwin) export DYLD_LIBRARY_PATH="$SCRIPT_DIR/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}" ;;
  *) export LD_LIBRARY_PATH="$SCRIPT_DIR/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" ;;
esac
exec "$SCRIPT_DIR/glyphmend-companion" "$@"
