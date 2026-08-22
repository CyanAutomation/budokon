import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateCanonical, validateSchema } from '../src/validation/validate-canonical.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases = JSON.parse(await readFile(new URL('./fixtures/semantic-cases.json', import.meta.url)));
const textCases = JSON.parse(await readFile(new URL('./fixtures/semantic-text-cases.json', import.meta.url)));
async function sandbox() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'budokon-validation-'));
  for (const directory of ['schema', 'data']) await cp(path.join(repository, directory), path.join(root, directory), { recursive: true });
  return root;
}
async function change(file, mutate) {
  const value = JSON.parse(await readFile(file)); mutate(value); await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

test('schema references fail clearly for unsupported or missing targets', () => {
  assert.throws(() => validateSchema('value', { $ref: 'other.json#/value' }), /unsupported \$ref format/);
  assert.throws(() => validateSchema('value', { $ref: '#\/$defs\/missing', $defs: {} }), /invalid \$ref path/);
});

test('arrays without an items constraint are valid', () => {
  assert.doesNotThrow(() => validateSchema(['anything'], { type: 'array' }));
});

test('all canonical files pass schema and semantic validation', async () => {
  const result = await validateCanonical(repository);
  assert.ok(result.judoka.length > 0); assert.ok(result.techniques.length > 0);
});

test('filenames match canonical slugs', async () => {
  const root = await sandbox();
  await change(path.join(root, 'data/judoka/ashley-mckenzie.json'), (record) => { record.slug = 'different-slug'; });
  await assert.rejects(validateCanonical(root), /filename must match canonical slug/);
});

test('technique filenames match canonical IDs', async () => {
  const root = await sandbox();
  await rename(path.join(root, 'data/techniques/ashi-garami.json'), path.join(root, 'data/techniques/not-ashi-garami.json'));
  await assert.rejects(validateCanonical(root), /filename must match canonical ID ashi-garami/);
});

test('fixture-based semantic text rules cover every canonical dataset and nested text', async () => {
  for (const fixture of textCases) {
    const root = await sandbox();
    await change(path.join(root, fixture.file), (record) => {
      let target = record;
      for (const segment of fixture.path.slice(0, -1)) target = target[segment];
      target[fixture.path.at(-1)] = fixture.value;
    });
    await assert.rejects(validateCanonical(root), new RegExp(fixture.message), fixture.name);
  }
});

test('semantic text validation rejects non-string values without crashing', async () => {
  const root = await sandbox();
  await change(path.join(root, 'schema/collection.schema.json'), (schema) => { delete schema.properties.name.type; });
  await change(path.join(root, 'data/collections/featured-judoka.json'), (record) => { record.name = null; });
  await assert.rejects(validateCanonical(root), /featured-judoka\.name must contain meaningful text/);
});

test('future country timestamps are rejected', async () => {
  const root = await sandbox();
  await change(path.join(root, 'data/reference/countries.json'), countries => { countries.JP.lastUpdated = '2999-01-01T00:00:00Z'; });
  await assert.rejects(validateCanonical(root), /countries\.JP\.lastUpdated must not be in the future/);
});

test('prohibited game-state property names remain rejected if schemas expand', async () => {
  for (const property of ['matchesWon', 'matchesLost', 'matchesDrawn', 'playerOwnership', 'experiencePoints', 'cardInstanceId', 'gameScore']) {
    const root = await sandbox();
    await change(path.join(root, 'schema/dataset.schema.json'), schema => { schema.additionalProperties = true; });
    await change(path.join(root, 'data/dataset.json'), dataset => { dataset.futureSchema = { [property]: true }; });
    await assert.rejects(validateCanonical(root), new RegExp(`dataset\\.json\\.futureSchema\\.${property} is a prohibited game-state property`));
  }
});

test('collections reject invalid references, duplicate IDs and duplicate members', async () => {
  const invalid = await sandbox();
  await change(path.join(invalid, 'data/collections/featured-judoka.json'), record => { record.members[0] = '00000000-0000-4000-8000-000000000000'; });
  await assert.rejects(validateCanonical(invalid), /references unknown judoka UUID/);

  const duplicateId = await sandbox();
  const featured = JSON.parse(await readFile(path.join(duplicateId, 'data/collections/featured-judoka.json')));
  await writeFile(path.join(duplicateId, 'data/collections/japanese-judoka.json'), `${JSON.stringify({ ...featured }, null, 2)}\n`);
  await assert.rejects(validateCanonical(duplicateId), /duplicate collection ID/);

  const duplicateMember = await sandbox();
  await change(path.join(duplicateMember, 'data/collections/featured-judoka.json'), record => { record.members.push(record.members[0]); });
  await assert.rejects(validateCanonical(duplicateMember), /must contain unique items/);
});

test('fictional judoka are hidden by default', async () => {
  const root = await sandbox();
  await change(path.join(root, 'data/judoka/mystery-judoka.json'), (record) => { record.isHidden = false; });
  await assert.rejects(validateCanonical(root), /fictional judoka must be hidden/);
});

for (const fixture of cases) test(`rejects ${fixture.name}`, async () => {
  const root = await sandbox();
  const judokaDir = path.join(root, 'data/judoka');
  const techniqueDir = path.join(root, 'data/techniques');
  const firstJudoka = path.join(judokaDir, 'ashley-mckenzie.json');
  if (fixture.kind === 'judoka') await change(firstJudoka, (record) => { record[fixture.field] = fixture.value; });
  if (fixture.kind === 'alias') await change(firstJudoka, (record) => { record.aliases = ['Ilia Sulamanidze']; });
  if (fixture.kind === 'judoka-copy') {
    const original = JSON.parse(await readFile(firstJudoka));
    const other = JSON.parse(await readFile(path.join(judokaDir, 'ilia-sulamanidze.json')));
    other[fixture.field] = original[fixture.field];
    await writeFile(path.join(judokaDir, 'ilia-sulamanidze.json'), JSON.stringify(other));
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
    await change(path.join(root, 'data/judoka/ashley-mckenzie.json'), mutate);
    await assert.rejects(validateCanonical(root), new RegExp(message));
  }
});

test('date-time validation accepts supported fractions and rejects calendar overflow', async () => {
  for (const timestamp of ['2025-02-28T12:34:56Z', '2025-02-28T12:34:56.1Z', '2025-02-28T12:34:56.12Z', '2025-02-28T12:34:56.123Z']) {
    const root = await sandbox();
    await change(path.join(root, 'data/judoka/ashley-mckenzie.json'), (record) => { record.lastUpdated = timestamp; });
    await validateCanonical(root);
  }

  for (const timestamp of ['2025-02-29T12:34:56Z', '2025-13-01T12:34:56Z', '2025-01-01T24:00:00Z']) {
    const root = await sandbox();
    await change(path.join(root, 'data/judoka/ashley-mckenzie.json'), (record) => { record.lastUpdated = timestamp; });
    await assert.rejects(validateCanonical(root), /RFC 3339/);
  }
});

test('rejects future timestamps', async () => {
  const root = await sandbox();
  await change(path.join(root, 'data/judoka/ashley-mckenzie.json'), (record) => { record.lastUpdated = '2999-01-01T00:00:00Z'; });
  await assert.rejects(validateCanonical(root), /must not be in the future/);
});
