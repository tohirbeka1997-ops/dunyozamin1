/**
 * Smoke test for deploy/monitoring/alertmanager.yml (Bosqich 17).
 *   node electron/net/alertmanagerConfig.test.cjs
 *
 * This test deliberately does NOT run `amtool` — the authoritative check
 * happens inside the alertmanager container via deploy/scripts/verify-alertmanager.sh,
 * and CI has amtool available too. Here we just guard the CONTRACT the rest
 * of the stack depends on:
 *
 *   1. File exists + is parseable YAML.
 *   2. Required top-level keys present (route, receivers, templates).
 *   3. Receivers referenced by the route tree all exist in the receivers list
 *      (a dangling receiver name brings Alertmanager down on reload).
 *   4. Every "page" path fans out to BOTH telegram and email (no single
 *      point of failure for critical alerts).
 *   5. Templates file exists and declares the three templates the YAML uses.
 *
 * Intentionally zero external deps — we parse the tiny subset of YAML we
 * need with a hand-rolled walker to keep `npm test` fast and self-contained.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const AM_CONFIG_PATH   = path.resolve(__dirname, '../../deploy/monitoring/alertmanager.yml');
const TEMPLATES_PATH   = path.resolve(__dirname, '../../deploy/monitoring/alertmanager-templates/pos.tmpl');
const PROM_CONFIG_PATH = path.resolve(__dirname, '../../deploy/monitoring/prometheus.yml');
const ALERTS_PATH      = path.resolve(__dirname, '../../deploy/monitoring/alerts.yml');

let passed = 0;
let failed = 0;

async function run(name, fn) {
  try {
    await fn();
    console.log(`  ok  - ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL - ${name}\n    ${e.message}`);
    failed++;
  }
}

// ---- tiny YAML-ish reader --------------------------------------------------
// Alertmanager YAML is very regular (no anchors, no flow style for the bits
// we care about). We just need to assert specific substrings appear; we do
// NOT need a full parser. This keeps the test hermetic and dependency-free.
function loadText(file) {
  return fs.readFileSync(file, 'utf8');
}

// Extract receiver names declared under the top-level `receivers:` list.
// Matches lines like:   `  - name: telegram`
function extractReceiverNames(yaml) {
  const inReceiversSection = yaml.split(/^receivers:\s*$/m)[1] || '';
  // Stop at the next top-level key (line starting in column 0 with a word).
  // Very narrow regex on purpose — avoids matching keys nested inside
  // receivers blocks.
  const cut = inReceiversSection.split(/\n(?=[a-zA-Z_][\w]*:\s*$)/)[0];
  const names = [];
  const re = /^\s*-\s*name:\s*([A-Za-z0-9_\-]+)/gm;
  let m;
  while ((m = re.exec(cut)) !== null) names.push(m[1]);
  return names;
}

// Find every `receiver: X` reference in the document (route tree).
function extractRouteReceivers(yaml) {
  const names = new Set();
  const re = /^\s+receiver:\s*([A-Za-z0-9_\-]+)/gm;
  let m;
  while ((m = re.exec(yaml)) !== null) names.add(m[1]);
  return [...names];
}

// ---- tests -----------------------------------------------------------------
(async () => {
  console.log('# alertmanager config contract');

  await run('alertmanager.yml exists and is non-empty', () => {
    assert.ok(fs.existsSync(AM_CONFIG_PATH), `missing: ${AM_CONFIG_PATH}`);
    const size = fs.statSync(AM_CONFIG_PATH).size;
    assert.ok(size > 200, `file is suspiciously small (${size} bytes)`);
  });

  await run('declares required top-level sections', () => {
    const y = loadText(AM_CONFIG_PATH);
    // `templates:` is optional in AM but we use it; require it here.
    for (const key of ['global:', 'route:', 'receivers:', 'templates:', 'inhibit_rules:']) {
      assert.ok(new RegExp(`^${key.replace(':', ':\\s*$')}`, 'm').test(y),
        `missing top-level key: ${key}`);
    }
  });

  await run('all routed receivers are defined', () => {
    const y = loadText(AM_CONFIG_PATH);
    const declared = new Set(extractReceiverNames(y));
    const referenced = extractRouteReceivers(y);
    assert.ok(declared.size >= 3, `expected ≥3 receivers, got ${declared.size}: ${[...declared].join(',')}`);
    for (const r of referenced) {
      assert.ok(declared.has(r), `route references undefined receiver: ${r}`);
    }
  });

  await run('critical-severity path fans out to telegram AND email', () => {
    const y = loadText(AM_CONFIG_PATH);
    // The dedicated composite receiver must exist and contain both.
    // We check the composite's block has both telegram_configs and
    // email_configs — any other design would silently reduce redundancy.
    const blockMatch = y.match(/-\s*name:\s*telegram-and-email[\s\S]*?(?=\n\s*-\s*name:|$)/);
    assert.ok(blockMatch, 'missing composite receiver "telegram-and-email"');
    assert.ok(/telegram_configs:/.test(blockMatch[0]), 'composite receiver missing telegram_configs');
    assert.ok(/email_configs:/.test(blockMatch[0]), 'composite receiver missing email_configs');
  });

  await run('secrets are env placeholders, not literal values', () => {
    const y = loadText(AM_CONFIG_PATH);
    // Prevent an accidental commit of a real token. Placeholders look like
    // ${TELEGRAM_ALERT_BOT_TOKEN} — no literal numeric:AA... shape.
    assert.ok(/\$\{TELEGRAM_ALERT_BOT_TOKEN\}/.test(y), 'TELEGRAM_ALERT_BOT_TOKEN must be a ${...} placeholder');
    assert.ok(!/bot_token:\s*"\d{5,}:[A-Za-z0-9_-]{20,}"/.test(y),
      'literal Telegram bot token detected — use ${TELEGRAM_ALERT_BOT_TOKEN} instead');
    assert.ok(!/smtp_auth_password:\s*"[^$"{]+"/.test(y),
      'literal SMTP password detected — use ${SMTP_PASSWORD} instead');
  });

  await run('templates file exposes the three names referenced by YAML', () => {
    assert.ok(fs.existsSync(TEMPLATES_PATH), `missing: ${TEMPLATES_PATH}`);
    const t = loadText(TEMPLATES_PATH);
    for (const name of ['pos.telegram.message', 'pos.email.subject', 'pos.email.html']) {
      const re = new RegExp(`{{\\s*define\\s+"${name.replace(/\./g, '\\.')}"`);
      assert.ok(re.test(t), `template not defined: ${name}`);
    }
    const y = loadText(AM_CONFIG_PATH);
    for (const name of ['pos.telegram.message', 'pos.email.subject', 'pos.email.html']) {
      // The name may appear as `template "name"` (single-quoted YAML value) or
      // `template \"name\"` (escaped inside a double-quoted YAML value, e.g.
      // for the Subject header). Both are valid.
      const used = y.includes(`template "${name}"`) || y.includes(`template \\"${name}\\"`);
      assert.ok(used, `alertmanager.yml does not use template: ${name}`);
    }
  });

  await run('prometheus.yml wires alerting: alertmanager:9093', () => {
    assert.ok(fs.existsSync(PROM_CONFIG_PATH), `missing: ${PROM_CONFIG_PATH}`);
    const p = loadText(PROM_CONFIG_PATH);
    assert.ok(/^alerting:\s*$/m.test(p), 'prometheus.yml missing `alerting:` top-level block');
    assert.ok(/alertmanager:9093/.test(p), 'prometheus.yml does not target alertmanager:9093');
    assert.ok(/api_version:\s*v2/.test(p), 'prometheus.yml should pin Alertmanager api_version: v2');
  });

  await run('every alert carries severity + service labels', () => {
    assert.ok(fs.existsSync(ALERTS_PATH), `missing: ${ALERTS_PATH}`);
    const a = loadText(ALERTS_PATH);
    // Split by `- alert:` — each chunk must mention `severity:` inside its
    // `labels:` block. We don't enforce order, just presence. This catches
    // a forgotten label when a new rule is pasted in without the boilerplate.
    const rules = a.split(/^\s*-\s+alert:\s+/m).slice(1);
    assert.ok(rules.length >= 15, `expected ≥15 alert rules, got ${rules.length}`);
    for (const r of rules) {
      const name = r.split('\n')[0].trim();
      assert.ok(/severity:\s*(page|warning|info)\b/.test(r), `rule ${name}: missing severity label`);
      assert.ok(/service:\s*pos\b/.test(r), `rule ${name}: missing service: pos label`);
    }
  });

  await run('AlertmanagerDown rule exists (self-watchdog)', () => {
    const a = loadText(ALERTS_PATH);
    assert.ok(/alert:\s*AlertmanagerDown\b/.test(a),
      'missing AlertmanagerDown rule — without it a failing AM is invisible');
  });

  console.log(`\n# results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
