#!/usr/bin/env bash
# Every reference to a markdown doc — link OR prose — must name a file that exists.
#
# PASS 1 checks relative markdown links. It exists because commit d274855 moved eleven docs into
# docs/LLD/ and updated nothing that pointed at them: 44 links broke silently and nothing failed.
#
# PASS 2 checks bare mentions, and it is the one that matters more. When the numeric prefixes were
# dropped from every doc, 207 references needed rewriting and only 52 of them — a quarter — were
# markdown links. The rest were prose in code comments: `(docs/LLD/architecture.md §Driver
# location)`, backticked filenames, `§Section` citations. Pass 1 is blind to all of it, which is
# how 8 references broke silently on the previous move despite this script already existing.
#
# Anchors (#section) and absolute URLs are not checked — only that the file is real.
set -uo pipefail
cd "$(dirname "$0")/.."

SEARCH_PATHS=(docs apps packages scripts README.md CHANGELOG.md docker-compose.dev.yml docker-compose.prod.yml)
broken=0
ambiguous=0

# ── Pass 1: relative markdown links resolve as paths ────────────────────────────────────────
while IFS= read -r file; do
  dir=$(dirname "$file")
  while IFS= read -r target; do
    [ -z "$target" ] && continue
    if [ ! -e "$dir/${target%%#*}" ]; then
      echo "BROKEN LINK   $file -> $target"
      broken=$((broken + 1))
    fi
  done < <(grep -oE '\]\([^)]+\)' "$file" |
           sed -E 's/^\]\(//; s/\)$//' |
           grep -vE '^(https?:|mailto:|#)')
done < <(find . -name '*.md' -not -path './node_modules/*' -not -path './.turbo/*' -not -path './*/node_modules/*')

# ── Pass 2: every `something.md` mentioned anywhere names a real doc ─────────────────────────
#
# Builds the set of known basenames once, then checks each mention against it. Deliberately
# basename-based rather than path-resolving: the majority of prose references carry no usable
# path at all (a comment saying `see architecture.md`), and a rename is exactly what this needs
# to catch. A mention carrying a path is additionally required to resolve.
known=$(find docs -name '*.md' -type f -printf '%f\n' 2>/dev/null; ls -1 *.md 2>/dev/null)

# A basename that matches two or more docs is reported, not failed: it is the ambiguity the
# prefix removal was meant to end, and it should stay visible if it ever comes back.
# README.md is excluded: one per directory is the convention everywhere, not a collision.
dupes=$(echo "$known" | sort | uniq -d | grep -vxF 'README.md')

while IFS= read -r file; do
  while IFS= read -r ref; do
    [ -z "$ref" ] && continue
    base="${ref##*/}"
    base="${base%%#*}"

    if ! echo "$known" | grep -qxF "$base"; then
      echo "BROKEN REF    $file -> $ref"
      broken=$((broken + 1))
      continue
    fi

    # If the reference carries a directory, that path has to be real too — this is what catches
    # `docs/roadmap.md` when the file actually lives at `docs/LLD/roadmap.md`.
    if [[ "$ref" == */* ]]; then
      path="${ref%%#*}"
      case "$path" in
        /*) continue ;;                      # absolute: not ours to resolve
        ../*|./*) resolved="$(dirname "$file")/$path" ;;
        *) resolved="$path"                  # repo-root-relative, e.g. docs/LLD/auth.md
           [ -e "$resolved" ] || resolved="$(dirname "$file")/$path" ;;
      esac
      if [ ! -e "$resolved" ]; then
        echo "BROKEN PATH   $file -> $ref"
        broken=$((broken + 1))
      fi
    fi
  done < <(grep -oE '[A-Za-z0-9._/-]*[A-Za-z0-9_-]\.md' "$file" |
           grep -vE '^(https?|CHANGELOG)' | sort -u)
done < <(grep -rIl --include='*.md' --include='*.ts' --include='*.tsx' --include='*.cjs' --include='*.js' \
              --include='*.mjs' --include='*.yml' --include='*.yaml' --include='*.example' \
              -e '\.md' "${SEARCH_PATHS[@]}" 2>/dev/null |
         grep -vE 'node_modules|/\.turbo/|/dist/|/\.next/|/\.expo/')

if [ -n "$dupes" ]; then
  echo
  echo "AMBIGUOUS basenames (a bare mention cannot say which is meant):"
  echo "$dupes" | sed 's/^/  /'
  ambiguous=1
fi

if [ "$broken" -gt 0 ]; then
  echo
  echo "$broken broken doc reference(s)."
  exit 1
fi

if [ "$ambiguous" -gt 0 ]; then
  echo
  echo "Links resolve, but the ambiguous basenames above should be renamed."
fi

echo "All doc references resolve."
