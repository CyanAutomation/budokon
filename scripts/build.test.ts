import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { createHash } from 'node:crypto';

import {
  expandJudokaCountries,
  uuidPattern,
  validateCountries,
  validateCountryReferences,
  validateTechniqueReferences,
} from './build.js';
import { compileArtifacts } from './build.js';
import algorithmContract from '../src/draw/algorithm-contract.json' with { type: 'json' };

const uppercaseUuid = '84D3B821-0CA8-42DE-B42C-2EB8D42C9C3B';

test('build validation accepts uppercase UUID hexadecimal digits', () => {
  assert.match(uppercaseUuid, uuidPattern);
});

test('schema accepts uppercase UUID hexadecimal digits', async () => {
  const schema = JSON.parse(await readFile(new URL('../schema/judoka.schema.json', import.meta.url), 'utf8'));
  assert.match(uppercaseUuid, new RegExp(schema.properties.id.pattern));
});

test('judoka schema rejects undeclared game-specific properties', async () => {
  const schema = JSON.parse(await readFile(new URL('../schema/judoka.schema.json', import.meta.url), 'utf8'));

  assert.equal(schema.additionalProperties, false);
  for (const property of ['cardCode', 'matchesWon', 'matchesLost', 'matchesDrawn']) {
    assert.equal(Object.hasOwn(schema.properties, property), false);
  }
});

test('game-specific judoka values are preserved only in the JU-DO-KON import', async () => {
  const directory = new URL('../data/judoka/', import.meta.url);
  const files = (await readdir(directory)).filter((file) => file.endsWith('.json'));
  const records = await Promise.all(files.map(async (file) => JSON.parse(await readFile(new URL(file, directory), 'utf8'))));
  const gameImport = JSON.parse(await readFile(new URL('../migrations/ju-do-kon-judoka-import.json', import.meta.url), 'utf8'));
  const canonicalOnlyRecord = { id: '00000000-0000-4000-8000-000000000000' };

  assert.equal(Object.hasOwn(gameImport, canonicalOnlyRecord.id), false);

  for (const record of [...records, canonicalOnlyRecord]) {
    assert.deepEqual(
      ['cardCode', 'matchesWon', 'matchesLost', 'matchesDrawn'].filter((property) => Object.hasOwn(record, property)),
      [],
    );
    if (gameImport[record.id]) {
      assert.deepEqual(Object.keys(gameImport[record.id]), ['cardCode', 'matchesWon', 'matchesLost', 'matchesDrawn']);
    }
  }
});

test('technique reference validation enforces README.md#referential-validation for every signature move', () => {
  const cases = [
    {
      name: 'multiple known techniques',
      record: { slug: 'valid-judoka', signatureMoveIds: ['uchi-mata', 'seoi-nage'] },
      techniqueIds: new Set(['uchi-mata', 'seoi-nage']),
      error: undefined,
    },
    {
      name: 'a later unknown technique',
      record: { slug: 'invalid-judoka', signatureMoveIds: ['uchi-mata', 'unknown-move'] },
      techniqueIds: new Set(['uchi-mata']),
      error: /Judoka invalid-judoka references unknown technique "unknown-move"/,
    },
  ];

  for (const { name, record, techniqueIds, error } of cases) {
    const validate = () => validateTechniqueReferences([record], techniqueIds);
    if (error) assert.throws(validate, error, name);
    else assert.doesNotThrow(validate, name);
  }
});

test('country catalogue keys match uppercase embedded alpha-2 codes', async () => {
  const countries = JSON.parse(await readFile(new URL('../data/reference/countries.json', import.meta.url), 'utf8'));
  assert.doesNotThrow(() => validateCountries(countries));
  assert.throws(() => validateCountries({ jp: { code: 'jp', country: 'Japan', active: true } }), /Country key/);
  assert.throws(() => validateCountries({ JP: { code: 'US', country: 'Japan', active: true } }), /does not match/);
});

test('country schemas require uppercase codes and a country on every judoka', async () => {
  const countrySchema = JSON.parse(await readFile(new URL('../schema/countries.schema.json', import.meta.url), 'utf8'));
  const judokaSchema = JSON.parse(await readFile(new URL('../schema/judoka.schema.json', import.meta.url), 'utf8'));

  assert.equal(countrySchema.propertyNames.pattern, '^[A-Z]{2}$');
  assert.equal(countrySchema.additionalProperties.properties.code.pattern, '^[A-Z]{2}$');
  assert.ok(judokaSchema.required.includes('countryCode'));
});

test('every canonical judoka references an active catalogue country', async () => {
  const directory = new URL('../data/judoka/', import.meta.url);
  const files = (await readdir(directory)).filter((file) => file.endsWith('.json'));
  const records = await Promise.all(files.map(async (file) => JSON.parse(await readFile(new URL(file, directory), 'utf8'))));
  const countries = JSON.parse(await readFile(new URL('../data/reference/countries.json', import.meta.url), 'utf8'));

  assert.doesNotThrow(() => validateCountryReferences(records, countries));
  assert.equal(records.some((record) => Object.hasOwn(record, 'country')), false);
});

test('country reference validation rejects unknown and inactive countries', () => {
  const countries = {
    JP: { code: 'JP', country: 'Japan', active: false },
  };
  assert.throws(
    () => validateCountryReferences([{ slug: 'unknown', countryCode: 'US' }], countries),
    /references unknown country "US"/,
  );
  assert.throws(
    () => validateCountryReferences([{ slug: 'inactive', countryCode: 'JP' }], countries),
    /references inactive country "JP"/,
  );
});

test('generated judoka views resolve country display names from the catalogue', () => {
  const records = [{ slug: 'shozo-fujii', countryCode: 'JP' }];
  const expanded = expandJudokaCountries(records, { JP: { country: 'Japan' } });

  assert.deepEqual(expanded, [{ slug: 'shozo-fujii', countryCode: 'JP', country: 'Japan' }]);
  assert.equal(Object.hasOwn(records[0], 'country'), false);
});

test('compiler produces a versioned manifest with counts and artifact checksums', async () => {
  const commit = '1234567890abcdef1234567890abcdef12345678';
  const artifacts = await compileArtifacts(commit);
  assert.deepEqual(artifacts, await compileArtifacts(commit), 'two builds must be byte-for-byte identical');
  const dataset = JSON.parse(await readFile(new URL('../data/dataset.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(artifacts['manifest.json']);
  const aggregate = JSON.parse(artifacts['budokon.json']);
  assert.equal(manifest.datasetVersion, dataset.datasetVersion);
  assert.match(manifest.serviceVersion, /^\d+\.\d+\.\d+$/);
  assert.match(manifest.sourceGitCommit, /^[0-9a-f]{40}$/);
  assert.deepEqual(manifest.drawAlgorithms, algorithmContract.supported);
  assert.equal(manifest.defaultDrawAlgorithm, algorithmContract.default);
  assert.deepEqual(Object.keys(aggregate), ['datasetVersion', 'judoka', 'techniques', 'events', 'countries', 'weightCategories']);
  assert.equal(aggregate.datasetVersion, dataset.datasetVersion);
  assert.deepEqual(aggregate.judoka, JSON.parse(artifacts['judoka.json']));
  assert.deepEqual(aggregate.techniques, JSON.parse(artifacts['techniques.json']));
  assert.deepEqual(aggregate.events, JSON.parse(artifacts['events.json']));
  assert.deepEqual(aggregate.countries, JSON.parse(artifacts['countries.json']));
  assert.deepEqual(aggregate.weightCategories, JSON.parse(artifacts['weight-categories.json']));
  assert.deepEqual(Object.keys(aggregate.countries), [...Object.keys(aggregate.countries)].sort());
  assert.deepEqual(aggregate.judoka.map(({ id }) => id), aggregate.judoka.map(({ id }) => id).sort());
  assert.deepEqual(aggregate.techniques.map(({ id }) => id), aggregate.techniques.map(({ id }) => id).sort());
  assert.deepEqual(aggregate.events.map(({ id }) => id), aggregate.events.map(({ id }) => id).sort());
  assert.deepEqual(aggregate.weightCategories.map(({ gender }) => gender), aggregate.weightCategories.map(({ gender }) => gender).sort());
  for (const group of aggregate.weightCategories) {
    assert.deepEqual(group.categories.map(({ weight }) => weight), group.categories.map(({ weight }) => weight).sort());
  }
  assert.deepEqual(manifest.recordCounts, {
    judoka: aggregate.judoka.length,
    techniques: aggregate.techniques.length,
    events: aggregate.events.length,
    countries: Object.keys(aggregate.countries).length,
    weightCategories: aggregate.weightCategories.reduce((total, group) => total + group.categories.length, 0),
  });
  const emittedPayloads = Object.keys(artifacts).filter((name) => name !== 'manifest.json');
  assert.deepEqual(Object.keys(manifest.checksums), emittedPayloads);
  for (const name of emittedPayloads) {
    const content = artifacts[name];
    assert.equal(manifest.checksums[name], `sha256:${createHash('sha256').update(content).digest('hex')}`);
  }
  assert.equal(Object.keys(manifest).some(key => /time|date/i.test(key)), false);
});
