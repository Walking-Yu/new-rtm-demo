#!/bin/sh

# RTM 场景实验室一键启动脚本。缺依赖时先安装，然后起开发服务器。

set -eu

usage() {
  echo "Usage: ./start-demo.sh [--no-open|--check|--help]"
  echo "Default URL: http://127.0.0.1:8080/"
}

mode="start"
case "${1:-}" in
  "") ;;
  --no-open) mode="no-open" ;;
  --check) mode="check" ;;
  --help|-h)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$project_dir"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js 20 or newer is required." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is required." >&2
  exit 1
fi

node_major=$(node -p "Number(process.versions.node.split('.')[0])")
if [ "$node_major" -lt 20 ]; then
  echo "Error: Node.js 20 or newer is required. Current version: $(node --version)" >&2
  exit 1
fi

if [ ! -x node_modules/.bin/vite ]; then
  if [ "$mode" = "check" ]; then
    echo "Error: dependencies are not installed. Run ./start-demo.sh once." >&2
    exit 1
  fi
  echo "Installing dependencies..."
  npm install
fi

rtm_version=$(node -p "require('./node_modules/agora-rtm/package.json').version")
rtc_version=$(node -p "require('./node_modules/agora-rtc-sdk-ng/package.json').version")

if [ "$mode" = "check" ]; then
  echo "Demo environment is ready (Node $(node --version))."
  echo "Scenario lab: root src/ (scenes/voice-room)"
  echo "SDKs: agora-rtm@$rtm_version, agora-rtc-sdk-ng@$rtc_version"
  echo "Default URL: http://127.0.0.1:8080/"
  exit 0
fi

demo_host=${RTM_DEMO_HOST:-127.0.0.1}
demo_port=${RTM_DEMO_PORT:-8080}

echo "Starting Agora RTM scenario lab..."
echo "URL: http://$demo_host:$demo_port/"

if [ "$mode" = "no-open" ]; then
  exec npm run dev -- --host "$demo_host" --port "$demo_port"
fi

exec npm run dev -- --host "$demo_host" --port "$demo_port" --open
