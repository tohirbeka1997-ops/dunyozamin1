#!/bin/bash
cd /opt/pos || exit 1
echo "=== Host filesystem ==="
node scripts/compare-db-paths.cjs
echo "=== Inside docker pos-server ==="
docker exec pos-server node /tmp/compare-inside-docker.cjs
