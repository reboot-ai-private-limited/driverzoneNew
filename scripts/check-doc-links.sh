#!/usr/bin/env bash
# Every relative markdown link in the repo must resolve to a file that exists.
#
# This exists because commit d274855 moved eleven docs into docs/LLD/ and updated nothing that
# pointed at them: 44 links broke silently and nothing failed. A dead link in a handbook is a
# reader who stops trusting the handbook.
#
# Anchors (#section) and absolute URLs are not checked — only relative paths to files.
set -uo pipefail
cd "$(dirname "$0")/.."

broken=0
while IFS= read -r file; do
  dir=$(dirname "$file")
  while IFS= read -r target; do
    [ -z "$target" ] && continue
    if [ ! -e "$dir/${target%%#*}" ]; then
      echo "BROKEN  $file -> $target"
      broken=$((broken + 1))
    fi
  done < <(grep -oE '\]\([^)]+\)' "$file" |
           sed -E 's/^\]\(//; s/\)$//' |
           grep -vE '^(https?:|mailto:|#)')
done < <(find . -name '*.md' -not -path './node_modules/*' -not -path './.turbo/*' -not -path './*/node_modules/*')

if [ "$broken" -gt 0 ]; then
  echo
  echo "$broken broken link(s)."
  exit 1
fi
echo "All relative markdown links resolve."
