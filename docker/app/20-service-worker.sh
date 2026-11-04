#!/bin/sh
set -eu


case "${STRIDE_PWA_ENABLED:-true}" in
    true) worker=/opt/stride/sw-pwa.js ;;
    false) worker=/opt/stride/sw-online.js ;;
    *) echo 'STRIDE_PWA_ENABLED must be true or false' >&2; exit 1 ;;
esac
cp "$worker" /usr/share/nginx/html/sw.js
