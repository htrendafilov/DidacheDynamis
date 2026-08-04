#!/usr/bin/env bash
# Fetch the reviewed CrossWire KJV module and export it to the IMP input consumed by bibleimport.
# The generated KJV.imp.gz is intentionally git-ignored and must never enter the public repository.
set -euo pipefail

SCRIPT_DIR="${BASH_SOURCE[0]%/*}"
if [ "$SCRIPT_DIR" = "${BASH_SOURCE[0]}" ]; then
  SCRIPT_DIR="."
fi
ROOT="$SCRIPT_DIR/.."
OUTPUT="${1:-$ROOT/data/sources/KJV.imp.gz}"

KJV_URL="https://crosswire.org/ftpmirror/pub/sword/packages/rawzip/KJV.zip"
# Both pins are on content that is byte-identical everywhere: the archive CrossWire serves and
# the IMP export mod2imp produces from it. The gzip this script writes around that export is
# deliberately NOT pinned — gzip output is implementation-defined (Apple gzip and GNU gzip
# compress these same bytes to different files), so a pinned container checksum passes only on
# the machine that produced it. bibleimport verifies this input by its decompressed content.
KJV_ZIP_SHA256="873815aa4b4123025616d1f41eae75f412111275f4c3884e36f92d4f46dcba1d"
KJV_IMP_SHA256="6b2a9ab832b597ffb90929d3c7ac0b2756991cdc6bf5d30eab046308aedca7ed"

for executable in cp curl unzip mod2imp gzip awk; do
  if ! command -v "$executable" >/dev/null 2>&1; then
    echo "missing required executable: $executable" >&2
    echo "Install curl, unzip, gzip, and the SWORD utilities (mod2imp), then retry." >&2
    exit 1
  fi
done

if command -v sha256sum >/dev/null 2>&1; then
  SHA256=(sha256sum)
elif command -v shasum >/dev/null 2>&1; then
  SHA256=(shasum -a 256)
else
  echo "missing required SHA-256 tool: install sha256sum or shasum" >&2
  exit 1
fi

sha256_file() {
  "${SHA256[@]}" "$1" | awk '{print $1}'
}

sha256_expanded_gzip() {
  gzip -cd "$1" | "${SHA256[@]}" | awk '{print $1}'
}

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/didachedynamis-kjv.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

compress_and_install() {
  local input="$1"
  local candidate="$TMP_DIR/KJV.imp.gz"

  # -n so the output carries no timestamp or original filename: the file still varies by gzip
  # implementation, but not by *when* or *where* a given implementation ran it.
  gzip -cd "$input" | gzip -n -9 > "$candidate"
  if [ "$(sha256_expanded_gzip "$candidate")" != "$KJV_IMP_SHA256" ]; then
    echo "generated KJV IMP checksum mismatch" >&2
    exit 1
  fi

  mkdir -p "$(dirname "$OUTPUT")"
  mv -f "$candidate" "$OUTPUT"
  echo "verified KJV build input: $OUTPUT"
}

# Private archive checkouts may retain the former tracked source locally. Reuse it only when its
# expanded content matches the reviewed export.
if [ -f "$OUTPUT" ] && [ "$(sha256_expanded_gzip "$OUTPUT")" = "$KJV_IMP_SHA256" ]; then
  compress_and_install "$OUTPUT"
  exit 0
fi

ARCHIVE="$TMP_DIR/KJV.zip"
if [ -n "${KJV_ARCHIVE:-}" ]; then
  cp "$KJV_ARCHIVE" "$ARCHIVE"
else
  # --proto-redir as well as --proto: --proto governs the first request only, so without it a
  # redirect could still walk the download down to plain HTTP. The checksum below makes that
  # non-exploitable either way; this keeps the bytes off the wire in the clear regardless.
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --location --retry 3 \
    --max-filesize 20000000 --output "$ARCHIVE" "$KJV_URL"
fi

if [ "$(sha256_file "$ARCHIVE")" != "$KJV_ZIP_SHA256" ]; then
  echo "CrossWire KJV archive checksum mismatch; refusing to extract it" >&2
  exit 1
fi

MODULE_DIR="$TMP_DIR/module"
mkdir -p "$MODULE_DIR"
unzip -q "$ARCHIVE" -d "$MODULE_DIR"

RAW_IMP="$TMP_DIR/KJV.imp"
SWORD_PATH="$MODULE_DIR" mod2imp KJV > "$RAW_IMP"
if [ "$(sha256_file "$RAW_IMP")" != "$KJV_IMP_SHA256" ]; then
  echo "CrossWire KJV IMP export checksum mismatch" >&2
  exit 1
fi

gzip -n -9 < "$RAW_IMP" > "$TMP_DIR/downloaded.imp.gz"
compress_and_install "$TMP_DIR/downloaded.imp.gz"
