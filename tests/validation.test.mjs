import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateCanonical } from '../src/validation/validate-canonical.mjs';

const repository = path.resolve(import.meta.dirname, '..');
const cases = JSON.parse(await readFile(new URL('./fixtures/semantic-cases.json', import.meta.url)));
async function sandbox() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'budokon-validation-'));
  for (const directory of ['schema', 'data']) await cp(path.join(repository, directory), path.join(root, directory), { recursive: true });
  return root;
}
async function change(file, mutate) {
  const value = JSON.parse(await readFile(file)); mutate(value); await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

test('all canonical files pass schema and semantic validation', async () => {
  const result = await validateCanonical(repository);
  assert.ok(result.judoka.length > 0); assert.ok(result.techniques.length > 0);
});

for (const fixture of cases) test(`rejects ${fixture.name}`, async () => {
  const root = await sandbox();
  const judokaDir = path.join(root, 'data/judoka');
  const techniqueDir = path.join(root, 'data/techniques');
  const firstJudoka = path.join(judokaDir, 'askley-mckenzie.json');
  if (fixture.kind === 'judoka') await change(firstJudoka, (record) => { record[fixture.field] = fixture.value; });
  if (fixture.kind === 'alias') await change(firstJudoka, (record) => { record.aliases = ['ilia-sulamanidize']; });
  if (fixture.kind === 'judoka-copy') {
    const original = JSON.parse(await readFile(firstJudoka));
    const other = JSON.parse(await readFile(path.join(judokaDir, 'ilia-sulamanidize.json')));
    other[fixture.field] = original[fixture.field];
    await writeFile(path.join(judokaDir, 'ilia-sulamanidize.json'), JSON.stringify(other));
  }
  if (fixture.kind === 'technique-copy') {
    const original = JSON.parse(await readFile(path.join(techniqueDir, 'ashi-garami.json')));
    const otherFile = path.join(techniqueDir, 'ashi-guruma.json');
    const other = JSON.parse(await readFile(otherFile)); other.id = original.id; await writeFile(otherFile, JSON.stringify(other));
  }
  await assert.rejects(validateCanonical(root), new RegExp(fixture.message));
});

test('schemas reject stat bounds, malformed timestamps, and extra properties', async () => {
  for (const [mutate, message] of [
    [(record) => { record.stats.power = 11; }, 'must be <= 10'],
    [(record) => { record.lastUpdated = '2025-01-01'; }, 'RFC 3339'],
    [(record) => { record.unexpected = true; }, 'additional property'],
  ]) {
    const root = await sandbox();
    await change(path.join(root, 'data/judoka/askley-mckenzie.json'), mutate);
    await assert.rejects(validateCanonical(root), new RegExp(message));
  }
});

test('rejects future timestamps', async () => {
  const root = await sandbox();
  await change(path.join(root, 'data/judoka/askley-mckenzie.json'), (record) => { record.lastUpdated = '2999-01-01T00:00:00Z'; });
  await assert.rejects(validateCanonical(root), /must not be in the future/);
});
