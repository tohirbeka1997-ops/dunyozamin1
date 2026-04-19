#!/bin/sh
set -e
# Named volume bo'sh mount bo'lganda odatda root tegishli — pos (uid 1001) yozolmaydi.
chown -R pos:pos /var/lib/pos
# cap_drop ALL bo'lsa, SETUID/SETGID compose'da qo'shilishi shart (runuser ham shu capabilitylarga muhtoj).
exec /usr/bin/tini -- setpriv --reuid=1001 --regid=1001 --clear-groups -- "$@"
