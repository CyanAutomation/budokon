import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LoadedCanonicalData, ParsedFile, ValidatedCanonicalData } from './canonical-types.js';
import { validateCanonicalRules } from './canonical-rules.js';
import { validateSchema } from './schema-validator.js';

export { validateSchema } from './schema-validator.js';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function parse(file: string): Promise<unknown> {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error: any) { throw new Error(`${file}: invalid JSON (${error.message})`); }
}

async function records(directory: string): Promise<ParsedFile<unknown>[]> {
  const names = (await readdir(directory)).filter(name => name.endsWith('.json')).sort();
  return Promise.all(names.map(async name => ({ name, value: await parse(path.join(directory, name)) })));
}

async function loadCanonicalData(root: string): Promise<LoadedCanonicalData> {
  const schemaDir = path.join(root, 'schema');
  const [judokaSchema, techniqueSchema, eventSchema, countriesSchema, weightsSchema, datasetSchema] = await Promise.all(
    ['judoka', 'technique', 'event', 'countries', 'weight-categories', 'dataset'].map(name => parse(path.join(schemaDir, `${name}.schema.json`))),
  );
  const [judokaFiles, techniqueFiles, eventFiles, countries, weights, dataset] = await Promise.all([
    records(path.join(root, 'data/judoka')),
    records(path.join(root, 'data/techniques')),
    records(path.join(root, 'data/events')),
    parse(path.join(root, 'data/reference/countries.json')),
    parse(path.join(root, 'data/reference/weight-categories.json')),
    parse(path.join(root, 'data/dataset.json')),
  ]);
  return {
    schemas: {
      judoka: judokaSchema,
      technique: techniqueSchema,
      event: eventSchema,
      countries: countriesSchema,
      weights: weightsSchema,
      dataset: datasetSchema,
    },
    judokaFiles,
    techniqueFiles,
    eventFiles,
    countries,
    weights,
    dataset,
  };
}

function validateLoadedSchemas(data: LoadedCanonicalData): void {
  for (const file of data.judokaFiles) validateSchema(file.value, data.schemas.judoka, `data/judoka/${file.name}`);
  for (const file of data.techniqueFiles) validateSchema(file.value, data.schemas.technique, `data/techniques/${file.name}`);
  for (const file of data.eventFiles) validateSchema(file.value, data.schemas.event, `data/events/${file.name}`);
  validateSchema(data.countries, data.schemas.countries, 'data/reference/countries.json');
  validateSchema(data.weights, data.schemas.weights, 'data/reference/weight-categories.json');
  validateSchema(data.dataset, data.schemas.dataset, 'data/dataset.json');
}

function castValidatedCanonicalData(data: LoadedCanonicalData): ValidatedCanonicalData {
  // Schemas establish these domain shapes before canonical rules access them.
  return {
    judokaFiles: data.judokaFiles as ValidatedCanonicalData['judokaFiles'],
    techniqueFiles: data.techniqueFiles as ValidatedCanonicalData['techniqueFiles'],
    eventFiles: data.eventFiles as ValidatedCanonicalData['eventFiles'],
    countries: data.countries as ValidatedCanonicalData['countries'],
    weights: data.weights as ValidatedCanonicalData['weights'],
    dataset: data.dataset as ValidatedCanonicalData['dataset'],
  };
}

/** Parse and validate all canonical datasets, including cross-record rules. */
export async function validateCanonical(root = defaultRoot) {
  const loaded = await loadCanonicalData(root);
  validateLoadedSchemas(loaded);
  const data = castValidatedCanonicalData(loaded);
  validateCanonicalRules(data);
  return {
    judoka: data.judokaFiles.map(({ value }) => value),
    techniques: data.techniqueFiles.map(({ value }) => value),
    events: data.eventFiles.map(({ value }) => value),
    countries: data.countries,
    weights: data.weights,
    dataset: data.dataset,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await validateCanonical();
  console.log('Canonical data is valid.');
}
