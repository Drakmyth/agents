#!/usr/bin/env sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
source_file="$root/GLOBAL_AGENTS.md"
destination="$root/AGENTS.md"

if [ -e "$destination" ] || [ -L "$destination" ]; then
  printf 'Already present: %s\n' "$destination"
  exit 0
fi

ln -s "GLOBAL_AGENTS.md" "$destination"
printf 'Created symbolic link: %s\n' "$destination"
