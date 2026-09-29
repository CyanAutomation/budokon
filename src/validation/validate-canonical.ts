import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { meaningfulText, ensureUnique, rejectGameStateProperties, isValidDateTime, rejectFutureDate } from './validators.js';
import { normalizeCatalogText } from '../contracts/text-normalization.js';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

interface ParsedFile<T> { name: string; value: T; }
interface LoadedCanonicalData {
  schemas: {
    judoka: unknown;
    technique: unknown;
    event: unknown;
    countries: unknown;
    weights: unknown;
    dataset: unknown;
  };
  judokaFiles: ParsedFile<unknown>[];
  techniqueFiles: ParsedFile<unknown>[];
  eventFiles: ParsedFile<unknown>[];
  countries: unknown;
  weights: unknown;
  dataset: unknown;
}
interface ValidatedCanonicalData {
  judokaFiles: ParsedFile<CanonicalJudoka>[];
  techniqueFiles: ParsedFile<CanonicalTechnique>[];
  eventFiles: ParsedFile<CanonicalEvent>[];
  countries: CanonicalCountries;
  weights: CanonicalWeightGroup[];
  dataset: CanonicalDataset;
}
interface CanonicalCountry { code: string; country: string; active: boolean; lastUpdated: string; }
type CanonicalCountries = Record<string, CanonicalCountry>;
interface CanonicalJudoka {
  id: string; slug: string; legacySlugs?: string[]; firstname: string; surname: string;
  aliases?: string[]; personType: string; isHidden?: boolean; countryCode: string;
  signatureMoveIds: string[]; gender: string; weightClass: string; lastUpdated: string; bio: string;
  sources?: Array<{ checkedAt: string }>;
}
interface CanonicalTechnique { id: string; slug?: string; name: string; japanese: string; description: string; }
interface CanonicalEffect { action: string; target: string; value: unknown; }
interface CanonicalEvent { id: string; slug?: string; description: string; effects: CanonicalEffect[]; }
interface CanonicalWeightCategory { weight: string; descriptor: string; }
interface CanonicalWeightGroup { gender: string; description: string; categories: CanonicalWeightCategory[]; }
interface CanonicalDataset { datasetVersion: string; }

function fail(location, message) { throw new Error(`${location}: ${message}`); }
function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function resolveSchemaReference(reference, rootSchema, location) {
  if (!reference.startsWith('#/')) throw new Error(`${location}: unsupported $ref format ${reference}`);
  return reference.slice(2).split('/').reduce((node, key) => {
    if (!node || typeof node !== 'object' || !Object.hasOwn(node, key)) {
      throw new Error(`${location}: invalid $ref path ${reference}`);
    }
    return node[key];
  }, rootSchema);
}

function validateSchemaType(value, schema, location) {
  if (schema.const !== undefined && !equal(value, schema.const)) fail(location, `must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((item) => equal(item, value))) fail(location, `must be one of ${schema.enum.join(', ')}`);
  if (!schema.type) return;

  const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : Number.isInteger(value) ? 'integer' : typeof value;
  const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (!expected.some(type => actual === type || (type === 'number' && typeof value === 'number'))) {
    fail(location, `must be ${expected.join(' or ')}`);
  }
}

function validateSchemaString(value, schema, location) {
  if (schema.minLength !== undefined && value.length < schema.minLength) fail(location, `must contain at least ${schema.minLength} characters`);
  if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) fail(location, `must match ${schema.pattern}`);
  if (schema.format === 'uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail(location, 'must be a UUID');
  if (schema.format === 'date-time' && !isValidDateTime(value)) fail(location, 'must be an RFC 3339 UTC timestamp');
  if (schema.format === 'uri') {
    try { new URL(value); }
    catch { fail(location, 'must be an absolute URI'); }
  }
}

function validateSchemaNumber(value, schema, location) {
  if (schema.minimum !== undefined && value < schema.minimum) fail(location, `must be >= ${schema.minimum}`);
  if (schema.maximum !== undefined && value > schema.maximum) fail(location, `must be <= ${schema.maximum}`);
}

function validateSchemaArray(value, schema, location, rootSchema) {
  if (schema.minItems !== undefined && value.length < schema.minItems) fail(location, `must have at least ${schema.minItems} items`);
  if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(location, `must have at most ${schema.maxItems} items`);
  if (schema.uniqueItems && new Set(value.map(value => JSON.stringify(value))).size !== value.length) fail(location, 'must contain unique items');
  if (schema.items) value.forEach((item, index) => validateSchema(item, schema.items, `${location}[${index}]`, rootSchema));
}

function validateSchemaObject(value, schema, location, rootSchema) {
  for (const required of schema.required ?? []) {
    if (!Object.hasOwn(value, required)) fail(location, `missing required property ${required}`);
  }
  for (const [key, item] of Object.entries(value)) {
    if (schema.propertyNames) validateSchema(key, schema.propertyNames, `${location} property ${key}`, rootSchema);
    if (schema.properties?.[key]) validateSchema(item, schema.properties[key], `${location}.${key}`, rootSchema);
    else if (schema.additionalProperties === false) fail(location, `additional property ${key} is not allowed`);
    else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      validateSchema(item, schema.additionalProperties, `${location}.${key}`, rootSchema);
    }
  }
}

/** Validate the JSON Schema keywords used by the canonical schemas. */
export function validateSchema(value, schema, location = '$', rootSchema = schema) {
  if (schema.$ref) {
    return validateSchema(value, resolveSchemaReference(schema.$ref, rootSchema, location), location, rootSchema);
  }
  validateSchemaType(value, schema, location);
  if (typeof value === 'string') validateSchemaString(value, schema, location);
  if (typeof value === 'number') validateSchemaNumber(value, schema, location);
  if (Array.isArray(value)) validateSchemaArray(value, schema, location, rootSchema);
  else if (value && typeof value === 'object') validateSchemaObject(value, schema, location, rootSchema);
}

async function parse(file): Promise<unknown> {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { throw new Error(`${file}: invalid JSON (${error.message})`); }
}
async function records(directory) {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  return Promise.all(names.map(async (name) => ({ name, value: await parse(path.join(directory, name)) })));
}

async function loadCanonicalData(root): Promise<LoadedCanonicalData> {
  const schemaDir = path.join(root, 'schema');
  const [judokaSchema, techniqueSchema, eventSchema, countriesSchema, weightsSchema, datasetSchema] = await Promise.all(
    ['judoka', 'technique', 'event', 'countries', 'weight-categories', 'dataset'].map((name) => parse(path.join(schemaDir, `${name}.schema.json`))),
  );
  const [judokaFilesValue, techniqueFilesValue, eventFilesValue, countriesValue, weightsValue, datasetValue] = await Promise.all([
    records(path.join(root, 'data/judoka')), records(path.join(root, 'data/techniques')),
    records(path.join(root, 'data/events')),
    parse(path.join(root, 'data/reference/countries.json')), parse(path.join(root, 'data/reference/weight-categories.json')),
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
    judokaFiles: judokaFilesValue as ParsedFile<unknown>[],
    techniqueFiles: techniqueFilesValue as ParsedFile<unknown>[],
    eventFiles: eventFilesValue as ParsedFile<unknown>[],
    countries: countriesValue,
    weights: weightsValue,
    dataset: datasetValue,
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
  // The schemas establish these domain shapes before canonical rules access them.
  return {
    judokaFiles: data.judokaFiles as ParsedFile<CanonicalJudoka>[],
    techniqueFiles: data.techniqueFiles as ParsedFile<CanonicalTechnique>[],
    eventFiles: data.eventFiles as ParsedFile<CanonicalEvent>[],
    countries: data.countries as CanonicalCountries,
    weights: data.weights as CanonicalWeightGroup[],
    dataset: data.dataset as CanonicalDataset,
  };
}

function rejectGameStateFields(data: ValidatedCanonicalData): void {
  for (const { name, value } of data.judokaFiles) rejectGameStateProperties(value, `data/judoka/${name}`);
  for (const { name, value } of data.techniqueFiles) rejectGameStateProperties(value, `data/techniques/${name}`);
  rejectGameStateProperties(data.countries, 'data/reference/countries.json');
  rejectGameStateProperties(data.weights, 'data/reference/weight-categories.json');
  rejectGameStateProperties(data.dataset, 'data/dataset.json');
}

function validateUniqueIdentities(
  judoka: CanonicalJudoka[],
  techniques: CanonicalTechnique[],
  events: CanonicalEvent[],
): void {
  ensureUnique(judoka, 'id', 'judoka UUID');
  ensureUnique(judoka, 'handles', 'judoka slug or legacy slug', (item) => [item.slug, ...(item.legacySlugs ?? [])]);
  const names = new Map();
  for (const record of judoka) for (const name of [`${record.firstname} ${record.surname}`, ...(record.aliases ?? [])]) {
    const normalized = normalizeCatalogText(name);
    if (names.has(normalized) && names.get(normalized) !== record.slug) throw new Error(`ambiguous normalized judoka name ${JSON.stringify(normalized)} in ${names.get(normalized)} and ${record.slug}`);
    names.set(normalized, record.slug);
  }
  ensureUnique(techniques, 'id', 'technique ID');
  ensureUnique(events, 'id', 'event ID');
}

function validateCanonicalFilenames(data: ValidatedCanonicalData): void {
  for (const file of data.judokaFiles) if (path.parse(file.name).name !== file.value.slug) {
    throw new Error(`data/judoka/${file.name}: filename must match canonical slug ${file.value.slug}`);
  }
  for (const file of data.techniqueFiles) if (path.parse(file.name).name !== file.value.id) {
    throw new Error(`data/techniques/${file.name}: filename must match canonical ID ${file.value.id}`);
  }
  for (const file of data.eventFiles) if (path.parse(file.name).name !== file.value.id) {
    throw new Error(`data/events/${file.name}: filename must match canonical ID ${file.value.id}`);
  }
}

function createWeightMap(weights: CanonicalWeightGroup[]): Map<string, Set<string>> {
  const weightMap = new Map();
  for (const group of weights) {
    if (weightMap.has(group.gender)) throw new Error(`duplicate weight category gender ${group.gender}`);
    const values = group.categories.map(({ weight }) => weight);
    if (new Set(values).size !== values.length) throw new Error(`duplicate ${group.gender} weight category`);
    weightMap.set(group.gender, new Set(values));
  }
  return weightMap;
}

function validateCountries(countries: CanonicalCountries): void {
  for (const [key, country] of Object.entries(countries)) {
    if (country.code !== key) throw new Error(`country key ${key} does not match embedded code ${country.code}`);
    meaningfulText(country.country, `countries.${key}.country`);
    rejectFutureDate(country.lastUpdated, `countries.${key}.lastUpdated`);
  }
}

function validateJudokaIdentity(record: CanonicalJudoka, countries: CanonicalCountries, techniqueIds: Set<string>, weightMap: Map<string, Set<string>>): void {
  if (record.personType === 'fictional' && !record.isHidden) throw new Error(`${record.slug}: fictional judoka must be hidden`);
  if (!countries[record.countryCode]?.active) throw new Error(`${record.slug} references unknown or inactive country ${record.countryCode}`);
  for (const techniqueId of record.signatureMoveIds) {
    if (!techniqueIds.has(techniqueId)) throw new Error(`${record.slug} references unknown technique ${techniqueId}`);
  }
  if (!weightMap.get(record.gender)?.has(record.weightClass)) throw new Error(`${record.slug} has invalid ${record.gender} weight class ${record.weightClass}`);
}

function validateJudokaTextAndDates(record: CanonicalJudoka): void {
  rejectFutureDate(record.lastUpdated, `${record.slug} lastUpdated`);
  for (const [index, source] of (record.sources ?? []).entries()) {
    rejectFutureDate(source.checkedAt, `${record.slug}.sources[${index}].checkedAt`);
  }
  meaningfulText(record.firstname, `${record.slug}.firstname`);
  meaningfulText(record.surname, `${record.slug}.surname`);
  for (const [index, alias] of (record.aliases ?? []).entries()) meaningfulText(alias, `${record.slug}.aliases[${index}]`);
  meaningfulText(record.bio, `${record.slug}.bio`);
}

function validateJudoka(judoka: CanonicalJudoka[], countries: CanonicalCountries, techniqueIds: Set<string>, weightMap: Map<string, Set<string>>): void {
  for (const record of judoka) {
    validateJudokaIdentity(record, countries, techniqueIds, weightMap);
    validateJudokaTextAndDates(record);
  }
}

function validateTechniques(techniques: CanonicalTechnique[]): void {
  for (const record of techniques) {
    meaningfulText(record.name, `${record.id}.name`);
    meaningfulText(record.japanese, `${record.id}.japanese`);
    meaningfulText(record.description, `${record.id}.description`);
  }
}

const numericEventTargets = new Set(['power', 'speed', 'technique', 'kumikata', 'newaza', 'shido', 'waza_ari', 'score']);
const stateEventTargets = new Set(['shido', 'waza_ari', 'score', 'match_result']);

function validateEventEffect(eventId: string, index: number, effect: CanonicalEffect): void {
  if (effect.action === 'modify' && (!numericEventTargets.has(effect.target) || !Number.isInteger(effect.value))) {
    fail(`${eventId}.effects[${index}]`, 'modify effects require a numeric target and integer value');
  }
  const invalidMatchResult = effect.target === 'match_result' && effect.value !== 'forfeit';
  const invalidNumericState = effect.target !== 'match_result'
    && (typeof effect.value !== 'number' || !Number.isInteger(effect.value) || effect.value < 0);
  if (effect.action === 'set' && (!stateEventTargets.has(effect.target) || invalidMatchResult || invalidNumericState)) {
    fail(`${eventId}.effects[${index}]`, 'set effects require a valid state value');
  }
}

function validateEvent(event: CanonicalEvent): void {
  meaningfulText(event.description, `${event.id}.description`);
  for (const [index, effect] of event.effects.entries()) validateEventEffect(event.id, index, effect);
}

function validateEvents(events: CanonicalEvent[]): void {
  for (const event of events) validateEvent(event);
}

function validateWeightDescriptions(weights: CanonicalWeightGroup[]): void {
  for (const [groupIndex, group] of weights.entries()) {
    meaningfulText(group.description, `weights[${groupIndex}].description`);
    for (const [categoryIndex, category] of group.categories.entries()) meaningfulText(category.descriptor, `weights[${groupIndex}].categories[${categoryIndex}].descriptor`);
  }
}

/** Parse and validate all canonical datasets, including cross-record rules. */
export async function validateCanonical(root = defaultRoot) {
  const loaded = await loadCanonicalData(root);
  validateLoadedSchemas(loaded);
  const data = castValidatedCanonicalData(loaded);
  rejectGameStateFields(data);

  const judoka = data.judokaFiles.map(({ value }) => value);
  const techniques = data.techniqueFiles.map(({ value }) => value);
  const events = data.eventFiles.map(({ value }) => value);
  validateUniqueIdentities(judoka, techniques, events);
  validateCanonicalFilenames(data);
  const weightMap = createWeightMap(data.weights);
  const techniqueIds = new Set(techniques.map(({ id }) => id));
  validateCountries(data.countries);
  validateJudoka(judoka, data.countries, techniqueIds, weightMap);
  validateTechniques(techniques);
  validateEvents(events);
  validateWeightDescriptions(data.weights);
  return { judoka, techniques, events, countries: data.countries, weights: data.weights, dataset: data.dataset };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await validateCanonical();
  console.log('Canonical data is valid.');
}
