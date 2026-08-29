import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

try {
  const dist = path.join(root, 'dist');
  const manifest = JSON.parse(await readFile(path.join(dist, 'manifest.json')));
  const aggregate = JSON.parse(await readFile(path.join(dist, 'budokon.json')));
  const tag = process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME;

  if (!tag) throw new Error('Set RELEASE_TAG (or GITHUB_REF_NAME) to the release tag');
  if (!/^dataset-v[0-9]{4}\.[0-9]{2}\.[0-9]+$/.test(tag)) {
    throw new Error('Release tag must use the format dataset-vYYYY.MM.N');
  }
  if (typeof manifest?.datasetVersion !== 'string') {
    throw new Error('Invalid dataset manifest: missing datasetVersion');
  }
  assert.equal(tag, `dataset-v${manifest.datasetVersion}`, `release tag must be dataset-v${manifest.datasetVersion}`);
  assert.equal(aggregate.datasetVersion, manifest.datasetVersion, 'aggregate and manifest dataset versions must match');
  const artifactNames = (await readdir(dist, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name !== 'manifest.json').map((entry) => entry.name).sort();
  assert.deepEqual(Object.keys(manifest.checksums ?? {}).sort(), artifactNames, 'manifest must checksum every release artifact');
  for (const name of artifactNames) {
    assert.equal(manifest.checksums[name], sha256(await readFile(path.join(dist, name))), `${name} checksum must match its committed bytes`);
  }
  console.log(`${tag} identifies dataset ${manifest.datasetVersion}; ${artifactNames.length} artifact hashes verified.`);
} catch (error) {
  if (error instanceof SyntaxError) {
    throw new Error('Failed to parse a release artifact: invalid JSON format');
  }
  throw error;
}
