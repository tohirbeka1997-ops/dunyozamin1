#!/bin/sh
set -e
# Named volume bo'sh mount bo'lganda odatda root tegishli — pos (uid 1001) yozolmaydi.
chown -R pos:pos /var/lib/pos
exec /usr/bin/tini -- runuser -u pos -g pos -- "$@"
