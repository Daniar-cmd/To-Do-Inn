#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s "Project name"\n' "$0" >&2
  exit 1
fi

name=$1
case "$name" in
  ''|.|..|*/*)
    printf 'Project name must be a single directory name.\n' >&2
    exit 1
    ;;
esac

projects_dir=${PROJECTS_DIR:-"$HOME/Documents/projects"}
if [[ ! -d "$projects_dir" ]]; then
  printf 'Projects directory does not exist: %s\n' "$projects_dir" >&2
  exit 1
fi

project_dir="$projects_dir/$name"
if [[ -e "$project_dir" ]]; then
  printf 'Project directory already exists: %s\n' "$project_dir" >&2
  exit 1
fi

mkdir -- "$project_dir"
mkdir -p -- \
  "$project_dir/public/css" \
  "$project_dir/public/js" \
  "$project_dir/public/api" \
  "$project_dir/src/scss" \
  "$project_dir/includes" \
  "$project_dir/database"

printf 'Created project directories: %s\n' "$project_dir"
