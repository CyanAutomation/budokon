import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import { uuidPattern, validateTechniqueReferences } from './build.mjs';

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

  for (const record of records) {
    assert.deepEqual(
      ['cardCode', 'matchesWon', 'matchesLost', 'matchesDrawn'].filter((property) => Object.hasOwn(record, property)),
      [],
    );
    assert.deepEqual(Object.keys(gameImport[record.id]), ['cardCode', 'matchesWon', 'matchesLost', 'matchesDrawn']);
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
