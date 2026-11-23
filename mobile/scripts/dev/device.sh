#!/usr/bin/env bash
# Small adb wrapper for debugging Kissly on a connected Android device.
#
# Usage:
#   bash scripts/dev/device.sh <command> [args]
#
# Commands:
#   devices                 list connected devices
#   pid                     print the app pid
#   screenshot [path]       save a PNG screenshot (default /tmp/kissly-screen.png)
#   tap <x> <y>             tap a physical-pixel coordinate
#   swipe <x1> <y1> <x2> <y2> [ms]
#   key <keycode>           send a key event (e.g. 4 = back)
#   logs [lines]            dump the app's logcat (default 400 lines)
#   reload                  force-stop and relaunch the app
#   open <route-or-url>     deep link, e.g. "player?videoId=abc" or a full URL
#   install [apk]           install a debug APK and keep app data
#   forward                 forward the WebView devtools socket to tcp:$KISSLY_CDP_PORT
#   targets                 list WebView debug targets (via cdp.mjs)
#
# Environment:
#   ANDROID_HOME / ANDROID_SDK_ROOT / ADB   how to find adb
#   KISSLY_PACKAGE                         default com.knny.kisssubtitle
#   KISSLY_ACTIVITY                        default com.knny.kisssubtitle/.MainActivity
#   KISSLY_CDP_PORT                        default 9222
#
# This script is development-only. It assumes a debug build.

set -euo pipefail

PKG="${KISSLY_PACKAGE:-com.knny.kisssubtitle}"
ACTIVITY="${KISSLY_ACTIVITY:-com.knny.kisssubtitle/.MainActivity}"
CDP_PORT="${KISSLY_CDP_PORT:-9222}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

find_adb() {
  if [ -n "${ADB:-}" ] && [ -e "$ADB" ]; then
    printf '%s\n' "$ADB"
    return
  fi
  if command -v adb >/dev/null 2>&1; then
    command -v adb
    return
  fi
  for candidate in \
    "${ANDROID_HOME:-}/platform-tools/adb" \
    "${ANDROID_SDK_ROOT:-}/platform-tools/adb" \
    "${LOCALAPPDATA:-}/Android/Sdk/platform-tools/adb.exe" \
    "$HOME/Library/Android/sdk/platform-tools/adb" \
    "$HOME/Android/Sdk/platform-tools/adb"; do
    if [ -n "$candidate" ] && [ -e "$candidate" ]; then
      printf '%s\n' "$candidate"
      return
    fi
  done
  echo "adb not found. Set ANDROID_HOME, ANDROID_SDK_ROOT or ADB." >&2
  exit 1
}

ADB_BIN="$(find_adb)"

app_pid() {
  "$ADB_BIN" shell pidof "$PKG" 2>/dev/null | tr -d '\r' || true
}

require_device() {
  if ! "$ADB_BIN" devices | awk 'NR>1 && $2=="device" {found=1} END {exit !found}'; then
    echo "No authorized device/emulator. Run: $ADB_BIN devices -l" >&2
    exit 1
  fi
}

usage() {
  sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'
}

cmd="${1:-help}"
shift || true

case "$cmd" in
  help|-h|--help)
    usage
    ;;
  devices)
    "$ADB_BIN" devices -l
    ;;
  pid)
    app_pid
    ;;
  screenshot|shot)
    require_device
    out="${1:-/tmp/kissly-screen.png}"
    "$ADB_BIN" exec-out screencap -p > "$out"
    echo "$out"
    ;;
  tap)
    require_device
    if [ "$#" -lt 2 ]; then echo "usage: device.sh tap <x> <y>" >&2; exit 1; fi
    "$ADB_BIN" shell input tap "$1" "$2"
    ;;
  swipe)
    require_device
    if [ "$#" -lt 4 ]; then
      echo "usage: device.sh swipe <x1> <y1> <x2> <y2> [durationMs]" >&2
      exit 1
    fi
    "$ADB_BIN" shell input swipe "$1" "$2" "$3" "$4" "${5:-300}"
    ;;
  key)
    require_device
    if [ "$#" -lt 1 ]; then echo "usage: device.sh key <keycode>" >&2; exit 1; fi
    "$ADB_BIN" shell input keyevent "$1"
    ;;
  logs|logcat)
    require_device
    lines="${1:-400}"
    pid="$(app_pid)"
    if [ -n "$pid" ]; then
      "$ADB_BIN" logcat -d --pid="$pid" -t "$lines"
    else
      echo "App is not running; showing the last $lines device log lines." >&2
      "$ADB_BIN" logcat -d -t "$lines"
    fi
    ;;
  reload)
    require_device
    "$ADB_BIN" shell am force-stop "$PKG" >/dev/null 2>&1 || true
    "$ADB_BIN" shell am start -n "$ACTIVITY" >/dev/null
    echo "reloaded $PKG"
    ;;
  open)
    require_device
    if [ "$#" -lt 1 ]; then
      echo "usage: device.sh open <route-or-url>  (e.g. player?videoId=abc)" >&2
      exit 1
    fi
    arg="$1"
    case "$arg" in
      *://*) url="$arg" ;;
      *) url="kissly:///${arg#/}" ;;
    esac
    "$ADB_BIN" shell am start -a android.intent.action.VIEW -d "$url" >/dev/null
    echo "opened $url"
    ;;
  install)
    require_device
    apk="${1:-android/app/build/outputs/apk/debug/app-debug.apk}"
    if [ ! -f "$apk" ]; then
      echo "APK not found: $apk" >&2
      exit 1
    fi
    "$ADB_BIN" install -r "$apk"
    ;;
  forward)
    require_device
    pid="$(app_pid)"
    if [ -z "$pid" ]; then
      echo "App is not running. Start it first: device.sh reload" >&2
      exit 1
    fi
    "$ADB_BIN" forward --remove "tcp:$CDP_PORT" >/dev/null 2>&1 || true
    "$ADB_BIN" forward "tcp:$CDP_PORT" "localabstract:webview_devtools_remote_$pid" >/dev/null
    echo "WebView devtools: http://127.0.0.1:$CDP_PORT/json (pid $pid)"
    curl -s --max-time 5 "http://127.0.0.1:$CDP_PORT/json" || true
    echo
    ;;
  targets)
    node "$SCRIPT_DIR/cdp.mjs" targets "${1:-}"
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    usage >&2
    exit 1
    ;;
esac
