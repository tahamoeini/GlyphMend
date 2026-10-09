#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  echo 'The workflow actionlint installer requires Linux x86_64.' >&2
  exit 1
fi

install_dir="${RUNNER_TEMP:?}/glyphmend-actionlint-1.7.12"
archive="$install_dir/actionlint_1.7.12_linux_amd64.tar.gz"
mkdir -p "$install_dir"
curl --fail --location --silent --show-error --retry 3 --retry-all-errors \
  --connect-timeout 15 --max-time 60 --retry-max-time 180 \
  https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz \
  --output "$archive"
printf '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8  %s\n' "$archive" | sha256sum --check
tar -xzf "$archive" -C "$install_dir" actionlint
chmod +x "$install_dir/actionlint"
"$install_dir/actionlint" -version
printf '%s\n' "$install_dir" >> "${GITHUB_PATH:?}"
