#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');

const secret = execSync(
  "docker inspect pos-server --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^POS_HOST_SECRET=' | cut -d= -f2-",
  { encoding: 'utf8' },
).trim();

const payload = JSON.stringify({
  channel: 'pos:creditReminders:listOpenOrders',
  args: [{ limit: 5 }],
});

(async () => {
  const res = await fetch('http://127.0.0.1:3333/rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: payload,
  });
  const text = await res.text();
  console.log('status', res.status);
  console.log(text.slice(0, 2000));
  if (!res.ok) process.exit(1);
  if (text.includes('Cannot find module')) process.exit(2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
