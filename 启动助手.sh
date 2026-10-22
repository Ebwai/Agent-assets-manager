#!/usr/bin/env bash
set -u
cd -- "$(dirname -- "${BASH_SOURCE[0]}")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1 && [ -f "$HOME/.nvm/nvm.sh" ]; then
  set +u
  . "$HOME/.nvm/nvm.sh"
  set -u
fi
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' '请先安装 Node.js 20+，然后重新启动助手。'
  if [ -t 0 ]; then read -r -p '按 Enter 关闭…' _; fi
  exit 1
fi
node scripts/launch.mjs "$@"
status=$?
if [ "$status" -ne 0 ] && [ -t 0 ]; then read -r -p '启动失败，按 Enter 关闭…' _; fi
exit "$status"
