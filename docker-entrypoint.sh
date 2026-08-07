#!/bin/sh
set -eu

uploads_dir=/app/uploads
runtime_uid=10001

mkdir -p "$uploads_dir"
if [ "$(stat -c %u "$uploads_dir")" != "$runtime_uid" ]; then
  chown -R app:app "$uploads_dir"
fi

exec su-exec app:app "$@"
