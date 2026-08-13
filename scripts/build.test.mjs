import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { uuidPattern } from './build.mjs';

const uppercaseUuid = '84D3B821-0CA8-42DE-B42C-2EB8D42C9C3B';

test('build validation accepts uppercase UUID hexadecimal digits', () => {
  assert.match(uppercaseUuid, uuidPattern);
});

test('schema accepts uppercase UUID hexadecimal digits', async () => {
  const schema = JSON.parse(await readFile(new URL('../schema/judoka.schema.json', import.meta.url)));
  assert.match(uppercaseUuid, new RegExp(schema.properties.id.pattern));
});
