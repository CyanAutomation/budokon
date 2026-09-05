import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateCanonical, validateSchema } from '../src/validation/validate-canonical.js';
import { prohibitedGameStatePropertyNames } from '../src/contracts/game-state.js';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases = JSON.parse(await readFile(new URL('./fixtures/semantic-cases.json', import.meta.url), 'utf8'));
const textCases = JSON.parse(await readFile(new URL('./fixtures/semantic-text-cases.json', import.meta.url), 'utf8'));
const judokaSchema = JSON.parse(await readFile(new URL('../schema/judoka.schema.json', import.meta.url), 'utf8'));
const publicProfileFixture = JSON.parse(await readFile(new URL('./fixtures/canonical-minimal/data/judoka/fixture-judoka.json', import.meta.url), 'utf8'));
const canonicalDataset = JSON.parse(await readFile(new URL('../data/dataset.json', import.meta.url), 'utf8'));
async function fixtureSandbox() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'budokon-validation-fixture-'));
  await cp(path.join(repository, 'schema'), path.join(root, 'schema'), { recursive: true });
  await cp(new URL('./fixtures/canonical-minimal/data', import.meta.url), path.join(root, 'data'), { recursive: true });
  return root;
}
async function change(file, mutate) {
  const value = JSON.parse(await readFile(file, 'utf8')); mutate(value); await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

test('schema references fail clearly for unsupported or missing targets', () => {
  assert.throws(() => validateSchema('value', { $ref: 'other.json#/value' }), /unsupported \$ref format/);
  assert.throws(() => validateSchema('value', { $ref: '#\/$defs\/missing', $defs: {} }), /invalid \$ref path/);
});

describe('integration: canonical repository release gate', {
  skip: process.env.BUDOKON_SKIP_REPOSITORY_SMOKE === '1',
}, () => {
  test('aggregate smoke check returns populated collections with the canonical dataset identity', async () => {
    const result = await validateCanonical(repository);

    assert.ok(result.judoka.length > 0);
    assert.ok(result.techniques.length > 0);
    assert.ok(result.events.length > 0);
    assert.ok(Object.keys(result.countries).length > 0);
    assert.ok(result.weights.length > 0);
    assert.equal(result.dataset.datasetVersion, canonicalDataset.datasetVersion);
  });
});

test('validateCanonical loads a minimal canonical fixture with stable identifiers and normalized values', async () => {
  const root = await fixtureSandbox();
  const result = await validateCanonical(root);
  assert.deepEqual(result.judoka.map(({ id, slug, countryCode, weightClass, signatureMoveIds }) => (
    { id, slug, countryCode, weightClass, signatureMoveIds }
  )), [{
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'fixture-judoka',
    countryCode: 'GB',
    weightClass: '-73',
    signatureMoveIds: ['fixture-throw'],
  }]);
  assert.deepEqual(result.techniques.map(({ id, name }) => ({ id, name })), [{ id: 'fixture-throw', name: 'Fixture Throw' }]);
  assert.deepEqual(result.events.map(({ id, effects }) => ({ id, effects })), [{
    id: 'fixture-event', effects: [{ action: 'modify', target: 'score', value: 1 }],
  }]);
  assert.deepEqual(result.countries.GB, {
    country: 'United Kingdom', code: 'GB', lastUpdated: '2025-01-01T00:00:00Z', active: true,
  });
  assert.deepEqual(result.weights.map(({ gender, categories }) => ({
    gender, weights: categories.map(({ weight }) => weight),
  })), [{ gender: 'male', weights: ['-73'] }, { gender: 'female', weights: ['-63'] }]);
  assert.deepEqual(result.dataset, { datasetVersion: '2025.01.1' });
});

test('filenames match canonical slugs', async () => {
  const root = await fixtureSandbox();
  await change(path.join(root, 'data/judoka/fixture-judoka.json'), (record) => { record.slug = 'different-slug'; });
  await assert.rejects(validateCanonical(root), /filename must match canonical slug/);
});

test('technique filenames match canonical IDs', async () => {
  const root = await fixtureSandbox();
  await rename(path.join(root, 'data/techniques/fixture-throw.json'), path.join(root, 'data/techniques/not-fixture-throw.json'));
  await assert.rejects(validateCanonical(root), /filename must match canonical ID fixture-throw/);
});

test('fixture-based semantic text rules cover every canonical dataset and nested text', async () => {
  for (const fixture of textCases) {
    const root = await fixtureSandbox();
    await change(path.join(root, fixture.file), (record) => {
      let target = record;
      for (const segment of fixture.path.slice(0, -1)) target = target[segment];
      target[fixture.path.at(-1)] = fixture.value;
    });
    await assert.rejects(validateCanonical(root), new RegExp(fixture.message), fixture.name);
  }
});

test('semantic text validation rejects non-string values without crashing', async () => {
  const root = await fixtureSandbox();
  await change(path.join(root, 'schema/judoka.schema.json'), (schema) => { delete schema.$defs.text.type; });
  await change(path.join(root, 'data/judoka/fixture-judoka.json'), (record) => { record.firstname = null; });
  await assert.rejects(validateCanonical(root), /fixture-judoka\.firstname must contain meaningful text/);
});

test('prohibited game-state property names remain rejected if schemas expand', async () => {
  // Keep canonical data stateless even when schemas expand; game state belongs
  // only in the import described by migrations/README.md#ju-do-kon-judoka-import-contract.
  for (const property of prohibitedGameStatePropertyNames) {
    const root = await fixtureSandbox();
    await change(path.join(root, 'schema/dataset.schema.json'), schema => { schema.additionalProperties = true; });
    await change(path.join(root, 'data/dataset.json'), dataset => { dataset.futureSchema = { [property]: true }; });
    await assert.rejects(validateCanonical(root), new RegExp(`dataset\\.json\\.futureSchema\\.${property} is a prohibited game-state property`));
  }
});

test('fictional judoka are hidden by default', async () => {
  const root = await fixtureSandbox();
  await change(path.join(root, 'data/judoka/fixture-judoka.json'), (record) => { record.personType = 'fictional'; });
  await assert.rejects(validateCanonical(root), /fictional judoka must be hidden/);
});

test('required public profile fields are rejected when absent', async (t) => {
  const profilePath = 'data/judoka/fixture-judoka.json';
  const fields = [
    { name: 'stats', field: 'stats' },
    { name: 'signature moves', field: 'signatureMoveIds' },
    { name: 'rarity', field: 'rarity' },
    { name: 'biography', field: 'bio' },
    { name: 'profile URL', field: 'profileUrl' },
  ];

  for (const { name, field } of fields) await t.test(name, () => {
    const record = structuredClone(publicProfileFixture);
    delete record[field];

    assert.throws(() => validateSchema(record, judokaSchema, profilePath), (error: Error) => {
      assert.match(error.message, new RegExp(`missing required property ${field}`));
      assert.match(error.message, new RegExp(profilePath.replaceAll('.', '\\.')));
      return true;
    });
  });
});

for (const fixture of cases) test(`rejects ${fixture.name}`, async () => {
  const root = await fixtureSandbox();
  const judokaDir = path.join(root, 'data/judoka');
  const techniqueDir = path.join(root, 'data/techniques');
  const firstJudoka = path.join(judokaDir, 'fixture-judoka.json');
  if (fixture.kind === 'judoka') await change(firstJudoka, (record) => { record[fixture.field] = fixture.value; });
  if (fixture.kind === 'alias') {
    const original = JSON.parse(await readFile(firstJudoka, 'utf8'));
    const other = structuredClone(original);
    other.id = '00000000-0000-4000-8000-000000000002';
    other.slug = 'fixture-judoka-copy';
    other.firstname = 'Second';
    other.aliases = [`${original.firstname} ${original.surname}`];
    await writeFile(path.join(judokaDir, 'fixture-judoka-copy.json'), JSON.stringify(other));
  }
  if (fixture.kind === 'judoka-copy') {
    const original = JSON.parse(await readFile(firstJudoka, 'utf8'));
    const other = structuredClone(original);
    other.id = '00000000-0000-4000-8000-000000000002';
    other.slug = 'fixture-judoka-copy';
    other.firstname = 'Second';
    other[fixture.field] = original[fixture.field];
    await writeFile(path.join(judokaDir, 'fixture-judoka-copy.json'), JSON.stringify(other));
  }
  if (fixture.kind === 'technique-copy') {
    const original = JSON.parse(await readFile(path.join(techniqueDir, 'fixture-throw.json'), 'utf8'));
    const otherFile = path.join(techniqueDir, 'fixture-sweep.json');
    const other = structuredClone(original); other.id = original.id; await writeFile(otherFile, JSON.stringify(other));
  }
  await assert.rejects(validateCanonical(root), new RegExp(fixture.message));
});

test('schemas reject stat bounds, malformed timestamps, and extra properties', async () => {
  for (const [mutate, message] of [
    [(record) => { record.stats.power = 11; }, 'must be <= 10'],
    [(record) => { record.lastUpdated = '2025-01-01'; }, 'RFC 3339'],
    [(record) => { record.unexpected = true; }, 'additional property'],
  ] as Array<[(record: any) => void, string]>) {
    const root = await fixtureSandbox();
    await change(path.join(root, 'data/judoka/fixture-judoka.json'), mutate);
    await assert.rejects(validateCanonical(root), new RegExp(message));
  }
});

test('judoka provenance sources require an HTTPS URL, claim scope, and a checked timestamp', () => {
  const record = structuredClone(publicProfileFixture);
  record.sources = [{ url: 'http://example.test/profile', claims: ['biography'], checkedAt: '2026-01-01T00:00:00Z' }];
  assert.throws(() => validateSchema(record, judokaSchema, 'data/judoka/fixture-judoka.json'), /sources\[0\]\.url.*https/);
  record.sources = [{ url: 'https://example.test/profile', claims: [], checkedAt: '2026-01-01T00:00:00Z' }];
  assert.throws(() => validateSchema(record, judokaSchema, 'data/judoka/fixture-judoka.json'), /sources\[0\]\.claims.*at least 1/);
  record.sources = [{ url: 'https://example.test/profile', claims: ['biography'], checkedAt: '2999-01-01T00:00:00Z' }];
  assert.doesNotThrow(() => validateSchema(record, judokaSchema, 'data/judoka/fixture-judoka.json'));
});

test('date-time validation accepts supported fractions and rejects calendar overflow', async () => {
  for (const timestamp of ['2025-02-28T12:34:56Z', '2025-02-28T12:34:56.1Z', '2025-02-28T12:34:56.12Z', '2025-02-28T12:34:56.123Z']) {
    const root = await fixtureSandbox();
    await change(path.join(root, 'data/judoka/fixture-judoka.json'), (record) => { record.lastUpdated = timestamp; });
    await validateCanonical(root);
  }

  for (const timestamp of ['2025-02-29T12:34:56Z', '2025-13-01T12:34:56Z', '2025-01-01T24:00:00Z']) {
    const root = await fixtureSandbox();
    await change(path.join(root, 'data/judoka/fixture-judoka.json'), (record) => { record.lastUpdated = timestamp; });
    await assert.rejects(validateCanonical(root), /RFC 3339/);
  }
});

test('future timestamps are rejected', async () => {
  for (const fixture of [
    { name: 'country lastUpdated', file: 'data/reference/countries.json', path: ['GB', 'lastUpdated'] },
    { name: 'judoka lastUpdated', file: 'data/judoka/fixture-judoka.json', path: ['lastUpdated'] },
  ]) {
    const root = await fixtureSandbox();
    await change(path.join(root, fixture.file), (record) => {
      let target = record;
      for (const segment of fixture.path.slice(0, -1)) target = target[segment];
      target[fixture.path.at(-1)] = '2999-01-01T00:00:00Z';
    });
    await assert.rejects(validateCanonical(root), /must not be in the future/, fixture.name);
  }
});
