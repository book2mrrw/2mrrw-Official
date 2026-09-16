import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const appRoot = fileURLToPath(new URL('../../../../', import.meta.url));

// Trace flags are captured at module initialization. Exercise the real handler
// in fresh processes so both production settings remain covered by the suite.
for (const trace of ['0', '1']) {
  test(`queue completion preserves progression and lifecycle guards with trace=${trace}`, () => {
    const env = { ...process.env, NEXT_PUBLIC_PLAYBACK_TRACE: trace };
    // A child test runner must not inherit the parent's worker context.
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [
      '--import', './scripts/register-alias.mjs',
      '--test',
      '--test-name-pattern=locked-screen completion|late ended|preview completion|duplicate ended|completion respects',
      'src/lib/playback/__tests__/listening-continuity.test.js',
    ], {
      cwd: appRoot,
      env,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    if (trace === '1') {
      assert.match(result.stdout, /endedSlug: 'track-0'/);
      assert.match(result.stdout, /nextSlug: 'track-1'/);
    } else {
      assert.doesNotMatch(result.stdout, /tracklist:auto-advance/);
    }
  });
}
