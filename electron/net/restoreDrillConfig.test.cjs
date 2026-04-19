/**
 * Smoke test for the Bosqich 18 restore-drill wiring.
 *   node electron/net/restoreDrillConfig.test.cjs
 *
 * Pure static checks — no SSH, no docker, no rclone. We just verify the
 * _configuration surface_ is consistent so a future diff can't silently
 * break the pipeline. All the semantics are exercised by the real drill
 * on the server and by CI scheduled runs.
 *
 * What we guard:
 *   1. restore-drill-prom.sh exists, is bash, references the expected
 *      Prom metric names and writes to the textfile collector path.
 *   2. docker-compose.monitoring.yaml mounts the textfile dir into
 *      node-exporter with matching --collector.textfile.directory.
 *   3. alerts.yml declares BOTH tenant alerts (Stale + LastRunFailed),
 *      and references the same metric names as the script.
 *   4. .github/workflows/restore-drill.yml has a valid schedule + uses
 *      the same DEPLOY_* secrets the backend deploy relies on.
 *   5. setup-monitoring.sh creates the textfile directory.
 *
 * Rationale: three files (script, compose, alerts) contain magic strings
 * that MUST agree. One drift = silent breakage; this test catches it in
 * <100ms during `npm run test:smoke`.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

const FILES = {
  promScript:   path.join(ROOT, 'deploy/scripts/restore-drill-prom.sh'),
  drillScript:  path.join(ROOT, 'deploy/scripts/restore-drill.sh'),
  compose:      path.join(ROOT, 'docker-compose.monitoring.yaml'),
  alerts:       path.join(ROOT, 'deploy/monitoring/alerts.yml'),
  workflow:     path.join(ROOT, '.github/workflows/restore-drill.yml'),
  setupMon:     path.join(ROOT, 'deploy/scripts/setup-monitoring.sh'),
};

// The "magic strings" that must stay consistent across files. Breaking any
// ONE of these would silently decouple the dashboard from reality.
const TEXTFILE_DIR = '/var/lib/pos/node-exporter-textfile';
const METRICS = [
  'pos_backup_restore_drill_last_run_timestamp_seconds',
  'pos_backup_restore_drill_last_success_timestamp_seconds',
  'pos_backup_restore_drill_last_duration_seconds',
  'pos_backup_restore_drill_last_status',
];

let passed = 0, failed = 0;
function run(name, fn) {
  try { fn(); console.log(`  ok  - ${name}`); passed++; }
  catch (e) { console.error(`  FAIL - ${name}\n    ${e.message}`); failed++; }
}
function read(file) {
  if (!fs.existsSync(file)) throw new Error(`missing file: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

console.log('# restore-drill config contract (Bosqich 18)');

// -----------------------------------------------------------------------------
run('restore-drill-prom.sh exists and is bash', () => {
  const s = read(FILES.promScript);
  assert.ok(/^#!\/usr\/bin\/env bash/m.test(s), 'missing bash shebang');
  // We deliberately skip `set -e` so failures from the wrapped script
  // propagate through the metric write + AM push. Guard against someone
  // "helpfully" re-adding it.
  assert.ok(!/^set -e\b/m.test(s),
    'restore-drill-prom.sh must not use `set -e` — it needs to continue after the drill fails');
});

run('wrapper emits ALL four Prom gauges', () => {
  const s = read(FILES.promScript);
  for (const m of METRICS) {
    assert.ok(s.includes(m), `metric not emitted: ${m}`);
    // Every metric must also declare HELP + TYPE (textfile collector is
    // strict about prefix lines) — easy to forget when copy-pasting.
    assert.ok(s.includes(`HELP ${m} `), `metric ${m} missing HELP line`);
    assert.ok(s.includes(`TYPE ${m} gauge`), `metric ${m} missing TYPE gauge`);
  }
});

run('wrapper writes atomically (temp file + rename)', () => {
  const s = read(FILES.promScript);
  // Plain `>` writes race with node-exporter's 15s poll. Require both:
  //   a) a temp-path variable that includes $$ (PID suffix), AND
  //   b) an mv -f over the final path.
  assert.ok(/\.\$\$/.test(s),
    'wrapper must stage to a *.$$ temp path before renaming');
  assert.ok(/\bmv -f\b.*TEXTFILE_(TMP|OUT)|mv -f "\$TEXTFILE_TMP" "\$TEXTFILE_OUT"/.test(s),
    'wrapper must atomically mv -f the temp file onto the final path');
});

run('wrapper preserves last_success on failure', () => {
  const s = read(FILES.promScript);
  // Critical: when the drill fails, keep the PREVIOUS last_success value.
  // Without this, PosRestoreDrillStale can't distinguish "never passed"
  // from "passed last Sunday but failed today".
  assert.ok(/pos_backup_restore_drill_last_success_timestamp_seconds\b[\s\S]{0,400}?prev=/.test(s) ||
            s.includes('preserve the previous last_success'),
    'wrapper must preserve prior last_success on failed runs');
});

run('wrapper pushes failure alert to Alertmanager', () => {
  const s = read(FILES.promScript);
  assert.ok(s.includes('/api/v2/alerts'),
    'wrapper must POST to /api/v2/alerts on failure');
  assert.ok(/alertname":\s*"PosRestoreDrillFailed"/.test(s),
    'failure alert must use alertname=PosRestoreDrillFailed (matches alerts.yml)');
  assert.ok(/severity":\s*"page"/.test(s),
    'drill failure must be severity=page');
});

// -----------------------------------------------------------------------------
run('docker-compose mounts textfile dir into node-exporter', () => {
  const y = read(FILES.compose);
  assert.ok(y.includes(`--collector.textfile.directory=${TEXTFILE_DIR}`),
    `node-exporter missing --collector.textfile.directory=${TEXTFILE_DIR}`);
  assert.ok(y.includes(`${TEXTFILE_DIR}:${TEXTFILE_DIR}:ro`),
    `node-exporter missing read-only volume mount for ${TEXTFILE_DIR}`);
});

// -----------------------------------------------------------------------------
run('setup-monitoring.sh creates the textfile directory', () => {
  const s = read(FILES.setupMon);
  assert.ok(s.includes(TEXTFILE_DIR),
    `setup-monitoring.sh does not reference ${TEXTFILE_DIR}`);
  assert.ok(/install -d -m 07[0-9]{2} \/var\/lib\/pos\/node-exporter-textfile/.test(s),
    'setup-monitoring.sh must `install -d` the textfile dir with an explicit mode');
});

// -----------------------------------------------------------------------------
run('alerts.yml declares both restore-drill rules', () => {
  const a = read(FILES.alerts);
  assert.ok(/alert:\s*PosRestoreDrillStale\b/.test(a),
    'missing PosRestoreDrillStale rule');
  assert.ok(/alert:\s*PosRestoreDrillLastRunFailed\b/.test(a),
    'missing PosRestoreDrillLastRunFailed rule');
  // Stale must reference the success-timestamp gauge.
  assert.ok(/pos_backup_restore_drill_last_success_timestamp_seconds/.test(a),
    'alerts.yml missing success-timestamp gauge reference');
  // LastRunFailed must reference the status gauge.
  assert.ok(/pos_backup_restore_drill_last_status == 0/.test(a),
    'alerts.yml missing last_status==0 predicate');
});

run('drill alerts carry severity=page (not warning)', () => {
  const a = read(FILES.alerts);
  // Find the PosRestoreDrillStale block specifically.
  const block = a.match(/alert:\s*PosRestoreDrillStale[\s\S]*?(?=\n\s*- alert:|\n\s*- name:|$)/);
  assert.ok(block, 'could not isolate PosRestoreDrillStale block');
  assert.ok(/severity:\s*page\b/.test(block[0]),
    'PosRestoreDrillStale must be severity=page — an unverified backup is a critical problem');
});

// -----------------------------------------------------------------------------
run('restore-drill.yml workflow is present with cron schedule', () => {
  const w = read(FILES.workflow);
  assert.ok(/^name:\s*Restore drill/m.test(w), 'workflow name missing');
  assert.ok(/cron:\s*'[^']+'/.test(w), 'schedule.cron entry missing');
  // Sunday == day-of-week 0. Allow any hour but require the weekly cadence.
  const cronMatch = w.match(/cron:\s*'(\S+\s+\S+\s+\S+\s+\S+\s+\S+)'/);
  assert.ok(cronMatch, 'cron expression not a valid 5-field schedule');
  const fields = cronMatch[1].split(/\s+/);
  assert.strictEqual(fields.length, 5, `cron must have 5 fields, got ${fields.length}`);
  // Field 4 = day-of-month, field 5 = day-of-week. Must be weekly or less.
  assert.ok(fields[4] !== '*' || fields[2] !== '*',
    'cron fires every day — too noisy; use weekly (e.g. "0 4 * * 0")');
});

run('restore-drill.yml uses the shared DEPLOY_* secrets', () => {
  const w = read(FILES.workflow);
  for (const secret of ['DEPLOY_HOST', 'DEPLOY_USER', 'DEPLOY_SSH_KEY']) {
    assert.ok(w.includes(`secrets.${secret}`),
      `workflow missing secrets.${secret}`);
  }
});

run('restore-drill.yml invokes the wrapper (not the raw drill)', () => {
  const w = read(FILES.workflow);
  assert.ok(w.includes('restore-drill-prom.sh'),
    'workflow should call the Prom-exporting wrapper, not restore-drill.sh directly');
});

run('restore-drill.yml has concurrency and timeout guards', () => {
  const w = read(FILES.workflow);
  assert.ok(/^concurrency:/m.test(w), 'missing concurrency: block — two drills could collide');
  assert.ok(/timeout-minutes:\s*\d+/.test(w), 'missing timeout-minutes — a hung drill would run forever');
});

// -----------------------------------------------------------------------------
run('restore-drill.sh (wrapped script) still exists', () => {
  // Bosqich 10 artifact; the wrapper depends on it.
  assert.ok(fs.existsSync(FILES.drillScript), 'inner restore-drill.sh is missing');
});

// -----------------------------------------------------------------------------
console.log(`\n# results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
