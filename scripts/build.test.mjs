import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  expandJudokaCountries,
  uuidPattern,
  validateCountries,
  validateCountryReferences,
  validateTechniqueReferences,
} from './build.mjs';

const uppercaseUuid = '84D3B821-0CA8-42DE-B42C-2EB8D42C9C3B';

test('build validation accepts uppercase UUID hexadecimal digits', () => {
  assert.match(uppercaseUuid, uuidPattern);
});

test('schema accepts uppercase UUID hexadecimal digits', async () => {
  const schema = JSON.parse(await readFile(new URL('../schema/judoka.schema.json', import.meta.url)));
  assert.match(uppercaseUuid, new RegExp(schema.properties.id.pattern));
});

test('judoka schema rejects undeclared game-specific properties', async () => {
  const schema = JSON.parse(await readFile(new URL('../schema/judoka.schema.json', import.meta.url)));

  assert.equal(schema.additionalProperties, false);
  for (const property of ['cardCode', 'matchesWon', 'matchesLost', 'matchesDrawn']) {
    assert.equal(Object.hasOwn(schema.properties, property), false);
  }
});

test('game-specific judoka values are preserved only in the JU-DO-KON import', async () => {
  const directory = new URL('../data/judoka/', import.meta.url);
  const files = (await readdir(directory)).filter((file) => file.endsWith('.json'));
  const records = await Promise.all(files.map(async (file) => JSON.parse(await readFile(new URL(file, directory)))));
  const gameImport = JSON.parse(await readFile(new URL('../migrations/ju-do-kon-judoka-import.json', import.meta.url)));
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

test('technique reference validation allows an omitted signature move', () => {
  assert.doesNotThrow(() => validateTechniqueReferences(
    [{ slug: 'test-judoka' }],
    new Set(['uchi-mata']),
  ));
});

test('technique reference validation rejects an unknown signature move', () => {
  assert.throws(
    () => validateTechniqueReferences(
      [{ slug: 'test-judoka', signatureMoveId: 'unknown-move' }],
      new Set(['uchi-mata']),
    ),
    /Judoka test-judoka references unknown technique "unknown-move"/,
  );
});

test('country catalogue keys match uppercase embedded alpha-2 codes', async () => {
  const countries = JSON.parse(await readFile(new URL('../data/reference/countries.json', import.meta.url)));
  assert.doesNotThrow(() => validateCountries(countries));
  assert.throws(() => validateCountries({ jp: { code: 'jp', country: 'Japan', active: true } }), /Country key/);
  assert.throws(() => validateCountries({ JP: { code: 'US', country: 'Japan', active: true } }), /does not match/);
});

test('country schemas require uppercase codes and a country on every judoka', async () => {
  const countrySchema = JSON.parse(await readFile(new URL('../schema/countries.schema.json', import.meta.url)));
  const judokaSchema = JSON.parse(await readFile(new URL('../schema/judoka.schema.json', import.meta.url)));

  assert.equal(countrySchema.propertyNames.pattern, '^[A-Z]{2}$');
  assert.equal(countrySchema.additionalProperties.properties.code.pattern, '^[A-Z]{2}$');
  assert.ok(judokaSchema.required.includes('countryCode'));
});

test('every canonical judoka references an active catalogue country', async () => {
  const directory = new URL('../data/judoka/', import.meta.url);
  const files = (await readdir(directory)).filter((file) => file.endsWith('.json'));
  const records = await Promise.all(files.map(async (file) => JSON.parse(await readFile(new URL(file, directory)))));
  const countries = JSON.parse(await readFile(new URL('../data/reference/countries.json', import.meta.url)));

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
