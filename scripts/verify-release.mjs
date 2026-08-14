import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

try {
  const manifest = JSON.parse(await readFile(new URL('../data/dataset.json', import.meta.url)));
  const tag = process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME;

  if (!tag) throw new Error('Set RELEASE_TAG (or GITHUB_REF_NAME) to the release tag');
  assert.equal(tag, `dataset-v${manifest.datasetVersion}`, `release tag must be dataset-v${manifest.datasetVersion}`);
  console.log(`${tag} identifies dataset ${manifest.datasetVersion}.`);
} catch (error) {
  if (error instanceof SyntaxError) {
    throw new Error('Failed to parse dataset.json: invalid JSON format');
  }
  throw error;
}
