import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateCanonical, validateSchema } from '../src/validation/validate-canonical.js';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases = JSON.parse(await readFile(new URL('./fixtures/semantic-cases.json', import.meta.url), 'utf8'));
const textCases = JSON.parse(await readFile(new URL('./fixtures/semantic-text-cases.json', import.meta.url), 'utf8'));
const judokaSchema = JSON.parse(await readFile(new URL('../schema/judoka.schema.json', import.meta.url), 'utf8'));
const publicProfileFixture = JSON.parse(await readFile(new URL('../data/judoka/ashley-mckenzie.json', import.meta.url), 'utf8'));
async function sandbox() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'budokon-validation-'));
  for (const directory of ['schema', 'data']) await cp(path.join(repository, directory), path.join(root, directory), { recursive: true });
  return root;
}
async function change(file, mutate) {
  const value = JSON.parse(await readFile(file, 'utf8')); mutate(value); await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

test('schema references fail clearly for unsupported or missing targets', () => {
  assert.throws(() => validateSchema('value', { $ref: 'other.json#/value' }), /unsupported \$ref format/);
  assert.throws(() => validateSchema('value', { $ref: '#\/$defs\/missing', $defs: {} }), /invalid \$ref path/);
});

test('all canonical files pass schema and semantic validation', async () => {
  const result = await validateCanonical(repository);
  assert.deepEqual(Object.keys(result).sort(), ['countries', 'dataset', 'events', 'judoka', 'techniques', 'weights']);
  assert.ok(Array.isArray(result.judoka));
  assert.ok(Array.isArray(result.techniques));
  assert.ok(Array.isArray(result.events));
  assert.ok(result.countries && typeof result.countries === 'object' && !Array.isArray(result.countries));
  assert.ok(Array.isArray(result.weights));
  assert.match(result.dataset.datasetVersion, /^[0-9]{4}\.(?:0[1-9]|1[0-2])\.[1-9][0-9]*$/);
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
  await change(path.join(root, 'schema/judoka.schema.json'), (schema) => { delete schema.$defs.text.type; });
  await change(path.join(root, 'data/judoka/ashley-mckenzie.json'), (record) => { record.firstname = null; });
  await assert.rejects(validateCanonical(root), /ashley-mckenzie\.firstname must contain meaningful text/);
});

test('prohibited game-state property names remain rejected if schemas expand', async () => {
  for (const property of ['cardCode', 'matchesWon', 'matchesLost', 'matchesDrawn']) {
    const root = await sandbox();
    await change(path.join(root, 'data/judoka/ashley-mckenzie.json'), (record) => { record[property] = true; });
    await assert.rejects(
      validateCanonical(root),
      new RegExp(`(?:additional property ${property}|ashley-mckenzie\\.json\\.${property} is a prohibited game-state property)`),
    );
  }

  for (const property of ['matchesWon', 'matchesLost', 'matchesDrawn', 'playerOwnership', 'experiencePoints', 'cardInstanceId', 'gameScore']) {
    const root = await sandbox();
    await change(path.join(root, 'schema/dataset.schema.json'), schema => { schema.additionalProperties = true; });
    await change(path.join(root, 'data/dataset.json'), dataset => { dataset.futureSchema = { [property]: true }; });
    await assert.rejects(validateCanonical(root), new RegExp(`dataset\\.json\\.futureSchema\\.${property} is a prohibited game-state property`));
  }
});

test('fictional judoka are hidden by default', async () => {
  const root = await sandbox();
  await change(path.join(root, 'data/judoka/mystery-judoka.json'), (record) => { record.isHidden = false; });
  await assert.rejects(validateCanonical(root), /fictional judoka must be hidden/);
});

test('required public profile fields are rejected when absent', async (t) => {
  const profilePath = 'data/judoka/ashley-mckenzie.json';
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
  const root = await sandbox();
  const judokaDir = path.join(root, 'data/judoka');
  const techniqueDir = path.join(root, 'data/techniques');
  const firstJudoka = path.join(judokaDir, 'ashley-mckenzie.json');
  if (fixture.kind === 'judoka') await change(firstJudoka, (record) => { record[fixture.field] = fixture.value; });
  if (fixture.kind === 'alias') await change(firstJudoka, (record) => { record.aliases = ['Ilia Sulamanidze']; });
  if (fixture.kind === 'judoka-copy') {
    const original = JSON.parse(await readFile(firstJudoka, 'utf8'));
    const other = JSON.parse(await readFile(path.join(judokaDir, 'ilia-sulamanidze.json'), 'utf8'));
    other[fixture.field] = original[fixture.field];
    await writeFile(path.join(judokaDir, 'ilia-sulamanidze.json'), JSON.stringify(other));
  }
  if (fixture.kind === 'technique-copy') {
    const original = JSON.parse(await readFile(path.join(techniqueDir, 'ashi-garami.json'), 'utf8'));
    const otherFile = path.join(techniqueDir, 'ashi-guruma.json');
    const other = JSON.parse(await readFile(otherFile, 'utf8')); other.id = original.id; await writeFile(otherFile, JSON.stringify(other));
  }
  await assert.rejects(validateCanonical(root), new RegExp(fixture.message));
});

test('schemas reject stat bounds, malformed timestamps, and extra properties', async () => {
  for (const [mutate, message] of [
    [(record) => { record.stats.power = 11; }, 'must be <= 10'],
    [(record) => { record.lastUpdated = '2025-01-01'; }, 'RFC 3339'],
    [(record) => { record.unexpected = true; }, 'additional property'],
  ] as Array<[(record: any) => void, string]>) {
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

test('future timestamps are rejected', async () => {
  for (const fixture of [
    { name: 'country lastUpdated', file: 'data/reference/countries.json', path: ['JP', 'lastUpdated'] },
    { name: 'judoka lastUpdated', file: 'data/judoka/ashley-mckenzie.json', path: ['lastUpdated'] },
  ]) {
    const root = await sandbox();
    await change(path.join(root, fixture.file), (record) => {
      let target = record;
      for (const segment of fixture.path.slice(0, -1)) target = target[segment];
      target[fixture.path.at(-1)] = '2999-01-01T00:00:00Z';
    });
    await assert.rejects(validateCanonical(root), /must not be in the future/, fixture.name);
  }
});
