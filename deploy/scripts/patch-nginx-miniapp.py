#!/usr/bin/env python3
"""
pos.conf: Mini App uchun root va /v1/ (public-api 3334).
Ishlatish: python3 deploy/scripts/patch-nginx-miniapp.py /etc/nginx/sites-enabled/pos.conf
"""
from __future__ import annotations

import re
import sys

V1_BLOCK = """    location /v1/ {
        proxy_pass http://127.0.0.1:3334;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        client_max_body_size 2m;
    }

"""


def main() -> None:
    path = sys.argv[1]
    with open(path, encoding="utf-8") as f:
        s = f.read()

    # 1) kassa dist → mini-app dist
    s = s.replace("root /var/www/pos;", "root /opt/pos/mini-app/dist;")
    s = s.replace("root /var/www/pos ;", "root /opt/pos/mini-app/dist;")

    # 2) HTTPS server ichida birinchi index index.html; dan keyin /v1/
    if "location /v1/" not in s:
        idx = s.find("listen 443 ssl")
        if idx == -1:
            print("ERROR: listen 443 ssl topilmadi", file=sys.stderr)
            sys.exit(1)
        sub = s[idx:]
        m = re.search(r"^\s+index\s+index\.html;\s*$", sub, re.MULTILINE)
        if not m:
            print("ERROR: HTTPS blokda index index.html; topilmadi", file=sys.stderr)
            sys.exit(1)
        ins = idx + m.end()
        s = s[:ins] + "\n\n" + V1_BLOCK + s[ins:]

    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(s)
    print("OK:", path)


if __name__ == "__main__":
    main()
