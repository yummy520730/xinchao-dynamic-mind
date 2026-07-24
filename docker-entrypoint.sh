#!/bin/sh
set -eu

STATE_DIR=/app/state
mkdir -p "$STATE_DIR"

if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$STATE_DIR"
  if ! su-exec node test -w "$STATE_DIR"; then
    echo "fatal: /app/state is not writable by the node user; check the Zeabur volume mount" >&2
    exit 1
  fi
  exec su-exec node "$@"
fi

if [ ! -w "$STATE_DIR" ]; then
  echo "fatal: /app/state is not writable; check the Zeabur volume mount" >&2
  exit 1
fi
exec "$@"
