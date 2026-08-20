import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyArtifactConsistency } from './check-artifacts.mjs';

const commit = '1234567890abcdef1234567890abcdef12345678';
const checksum = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

function artifacts(payload = 'canonical\n', overrides = {}) {
  const manifest = {
    datasetVersion: '2026.08.1', serviceVersion: '0.1.0', sourceGitCommit: commit,
    recordCounts: { judoka: 1 }, checksums: { 'judoka.json': checksum(payload) }, ...overrides,
  };
  return { 'judoka.json': payload, 'manifest.json': `${JSON.stringify(manifest, null, 2)}\n` };
}

async function fixture(t, files = artifacts()) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'budokon-artifacts-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await Promise.all(Object.entries(files).map(([name, bytes]) => writeFile(path.join(directory, name), bytes)));
  return directory;
}

test('artifact check accepts exact compiler output', async (t) => {
  const expectedArtifacts = artifacts();
  const artifactDirectory = await fixture(t, expectedArtifacts);
  await assert.doesNotReject(verifyArtifactConsistency({ artifactDirectory, expectedArtifacts, sourceGitCommit: commit }));
});

test('artifact check rejects a stale source commit', async (t) => {
  const expectedArtifacts = artifacts();
  const artifactDirectory = await fixture(t, artifacts('canonical\n', { sourceGitCommit: '0'.repeat(40) }));
  await assert.rejects(verifyArtifactConsistency({ artifactDirectory, expectedArtifacts, sourceGitCommit: commit }), /Stale source commit/);
});

test('artifact check rejects a modified artifact even with its checksum updated', async (t) => {
  const expectedArtifacts = artifacts();
  const artifactDirectory = await fixture(t, artifacts('modified\n'));
  await assert.rejects(verifyArtifactConsistency({ artifactDirectory, expectedArtifacts, sourceGitCommit: commit }), /differs from canonical compiler output/);
});

test('artifact check rejects an absent artifact', async (t) => {
  const expectedArtifacts = artifacts();
  const artifactDirectory = await fixture(t, { 'manifest.json': expectedArtifacts['manifest.json'] });
  await assert.rejects(verifyArtifactConsistency({ artifactDirectory, expectedArtifacts, sourceGitCommit: commit }), /Missing dist artifacts: judoka.json/);
});

test('artifact check clearly reports an absent manifest', async (t) => {
  const expectedArtifacts = artifacts();
  const artifactDirectory = await fixture(t, { 'judoka.json': expectedArtifacts['judoka.json'] });
  await assert.rejects(
    verifyArtifactConsistency({ artifactDirectory, expectedArtifacts, sourceGitCommit: commit }),
    /dist\/manifest\.json is missing/,
  );
});

test('artifact check rejects an unlisted extra artifact', async (t) => {
  const expectedArtifacts = artifacts();
  const artifactDirectory = await fixture(t, { ...expectedArtifacts, 'extra.json': '{}\n' });
  await assert.rejects(verifyArtifactConsistency({ artifactDirectory, expectedArtifacts, sourceGitCommit: commit }), /Unlisted dist artifacts: extra.json/);
});

test('artifact check rejects a checksum mismatch', async (t) => {
  const expectedArtifacts = artifacts();
  const artifactDirectory = await fixture(t, artifacts('canonical\n', { checksums: { 'judoka.json': 'sha256:deadbeef' } }));
  await assert.rejects(verifyArtifactConsistency({ artifactDirectory, expectedArtifacts, sourceGitCommit: commit }), /Checksum mismatch for judoka.json/);
});
