import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const placeholder = /^(?:todo|tbd|unknown|n\/?a|none|more info to come)(?=$|[\s:_\p{P}\p{S}])/iu;
const prohibitedGameStateProperties = new Set([
  'matchesWon', 'matchesLost', 'matchesDrawn', 'playerOwnership',
  'experiencePoints', 'cardInstanceId', 'gameScore',
]);
const rfc3339 = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/;
function isValidDateTime(value) {
  if (!rfc3339.test(value)) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  // Normalize the optional fraction before comparing so calendar overflow cannot
  // be silently accepted while one- and two-digit fractions remain valid.
  const normalized = value.includes('.')
    ? value.replace(/\.(\d{1,3})Z$/, (_, fraction) => `.${fraction.padEnd(3, '0')}Z`)
    : value.replace(/Z$/, '.000Z');
  return date.toISOString() === normalized;
}

function fail(location, message) { throw new Error(`${location}: ${message}`); }
function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/** Validate the JSON Schema keywords used by the canonical schemas. */
export function validateSchema(value, schema, location = '$', rootSchema = schema) {
  if (schema.$ref) {
    if (!schema.$ref.startsWith('#/')) throw new Error(`${location}: unsupported $ref format ${schema.$ref}`);
    const target = schema.$ref.slice(2).split('/').reduce((node, key) => {
      if (!node || typeof node !== 'object' || !Object.hasOwn(node, key)) {
        throw new Error(`${location}: invalid $ref path ${schema.$ref}`);
      }
      return node[key];
    }, rootSchema);
    return validateSchema(value, target, location, rootSchema);
  }
  if (schema.const !== undefined && !equal(value, schema.const)) fail(location, `must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((item) => equal(item, value))) fail(location, `must be one of ${schema.enum.join(', ')}`);
  const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : Number.isInteger(value) ? 'integer' : typeof value;
  if (schema.type && actual !== schema.type && !(schema.type === 'number' && typeof value === 'number')) fail(location, `must be ${schema.type}`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) fail(location, `must contain at least ${schema.minLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) fail(location, `must match ${schema.pattern}`);
    if (schema.format === 'uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail(location, 'must be a UUID');
    if (schema.format === 'date-time' && !isValidDateTime(value)) fail(location, 'must be an RFC 3339 UTC timestamp');
    if (schema.format === 'uri') { try { new URL(value); } catch { fail(location, 'must be an absolute URI'); } }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) fail(location, `must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(location, `must be <= ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(location, `must have at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(location, `must have at most ${schema.maxItems} items`);
    if (schema.uniqueItems && new Set(value.map(JSON.stringify)).size !== value.length) fail(location, 'must contain unique items');
    if (schema.items) value.forEach((item, index) => validateSchema(item, schema.items, `${location}[${index}]`, rootSchema));
  } else if (value && typeof value === 'object') {
    for (const required of schema.required ?? []) if (!Object.hasOwn(value, required)) fail(location, `missing required property ${required}`);
    for (const [key, item] of Object.entries(value)) {
      if (schema.propertyNames) validateSchema(key, schema.propertyNames, `${location} property ${key}`, rootSchema);
      if (schema.properties?.[key]) validateSchema(item, schema.properties[key], `${location}.${key}`, rootSchema);
      else if (schema.additionalProperties === false) fail(location, `additional property ${key} is not allowed`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') validateSchema(item, schema.additionalProperties, `${location}.${key}`, rootSchema);
    }
  }
}

async function parse(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { throw new Error(`${file}: invalid JSON (${error.message})`); }
}
async function records(directory) {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  return Promise.all(names.map(async (name) => ({ name, value: await parse(path.join(directory, name)) })));
}
function normalizedName(value) { return String(value).normalize('NFD').replace(/\p{Mark}+/gu, '').toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, ' ').trim().replace(/\s+/gu, ' '); }
function meaningfulText(value, location) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${location} must contain meaningful text`);
  if (placeholder.test(value.trim())) throw new Error(`${location} contains placeholder content`);
}
function rejectGameStateProperties(value, location) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectGameStateProperties(item, `${location}[${index}]`));
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (prohibitedGameStateProperties.has(key)) throw new Error(`${location}.${key} is a prohibited game-state property`);
    rejectGameStateProperties(item, `${location}.${key}`);
  }
}
function unique(items, field, label) {
  const seen = new Map();
  for (const item of items) {
    for (const value of field === 'handles' ? [item.slug, ...(item.legacySlugs ?? [])] : [item[field]]) {
      if (seen.has(value)) throw new Error(`duplicate ${label} ${JSON.stringify(value)} in ${seen.get(value)} and ${item.slug ?? item.id}`);
      seen.set(value, item.slug ?? item.id);
    }
  }
}

/** Parse and validate all canonical datasets, including cross-record rules. */
export async function validateCanonical(root = defaultRoot) {
  const schemaDir = path.join(root, 'schema');
  const [judokaSchema, techniqueSchema, countriesSchema, weightsSchema, datasetSchema] = await Promise.all(
    ['judoka', 'technique', 'countries', 'weight-categories', 'dataset'].map((name) => parse(path.join(schemaDir, `${name}.schema.json`))),
  );
  const [judokaFiles, techniqueFiles, countries, weights, dataset] = await Promise.all([
    records(path.join(root, 'data/judoka')), records(path.join(root, 'data/techniques')),
    parse(path.join(root, 'data/reference/countries.json')), parse(path.join(root, 'data/reference/weight-categories.json')),
    parse(path.join(root, 'data/dataset.json')),
  ]);
  for (const file of judokaFiles) validateSchema(file.value, judokaSchema, `data/judoka/${file.name}`);
  for (const file of techniqueFiles) validateSchema(file.value, techniqueSchema, `data/techniques/${file.name}`);
  validateSchema(countries, countriesSchema, 'data/reference/countries.json');
  validateSchema(weights, weightsSchema, 'data/reference/weight-categories.json');
  validateSchema(dataset, datasetSchema, 'data/dataset.json');
  for (const { name, value } of judokaFiles) rejectGameStateProperties(value, `data/judoka/${name}`);
  for (const { name, value } of techniqueFiles) rejectGameStateProperties(value, `data/techniques/${name}`);
  rejectGameStateProperties(countries, 'data/reference/countries.json');
  rejectGameStateProperties(weights, 'data/reference/weight-categories.json');
  rejectGameStateProperties(dataset, 'data/dataset.json');
  const judoka = judokaFiles.map(({ value }) => value), techniques = techniqueFiles.map(({ value }) => value);
  unique(judoka, 'id', 'judoka UUID'); unique(judoka, 'handles', 'judoka slug or legacy slug');
  const names = new Map();
  for (const record of judoka) for (const name of [`${record.firstname} ${record.surname}`, ...(record.aliases ?? [])]) {
    const normalized = normalizedName(name);
    if (names.has(normalized) && names.get(normalized) !== record.slug) throw new Error(`ambiguous normalized judoka name ${JSON.stringify(normalized)} in ${names.get(normalized)} and ${record.slug}`);
    names.set(normalized, record.slug);
  } unique(techniques, 'id', 'technique ID');
  for (const file of judokaFiles) if (path.parse(file.name).name !== file.value.slug) {
    throw new Error(`data/judoka/${file.name}: filename must match canonical slug ${file.value.slug}`);
  }
  for (const file of techniqueFiles) if (path.parse(file.name).name !== file.value.id) {
    throw new Error(`data/techniques/${file.name}: filename must match canonical ID ${file.value.id}`);
  }
  const techniqueIds = new Set(techniques.map(({ id }) => id));
  const weightMap = new Map();
  for (const group of weights) {
    if (weightMap.has(group.gender)) throw new Error(`duplicate weight category gender ${group.gender}`);
    const values = group.categories.map(({ weight }) => weight);
    if (new Set(values).size !== values.length) throw new Error(`duplicate ${group.gender} weight category`);
    weightMap.set(group.gender, new Set(values));
  }
  for (const [key, country] of Object.entries(countries)) {
    if (country.code !== key) throw new Error(`country key ${key} does not match embedded code ${country.code}`);
    meaningfulText(country.country, `countries.${key}.country`);
    if (Date.parse(country.lastUpdated) > Date.now()) throw new Error(`countries.${key}.lastUpdated must not be in the future`);
  }
  for (const record of judoka) {
    if (record.personType === 'fictional' && !record.isHidden) throw new Error(`${record.slug}: fictional judoka must be hidden`);
    if (!countries[record.countryCode]?.active) throw new Error(`${record.slug} references unknown or inactive country ${record.countryCode}`);
    for (const techniqueId of record.signatureMoveIds) if (!techniqueIds.has(techniqueId)) throw new Error(`${record.slug} references unknown technique ${techniqueId}`);
    if (!weightMap.get(record.gender)?.has(record.weightClass)) throw new Error(`${record.slug} has invalid ${record.gender} weight class ${record.weightClass}`);
    if (Date.parse(record.lastUpdated) > Date.now()) throw new Error(`${record.slug} lastUpdated must not be in the future`);
    meaningfulText(record.firstname, `${record.slug}.firstname`);
    meaningfulText(record.surname, `${record.slug}.surname`);
    for (const [index, alias] of (record.aliases ?? []).entries()) meaningfulText(alias, `${record.slug}.aliases[${index}]`);
    meaningfulText(record.bio, `${record.slug}.bio`);
  }
  for (const record of techniques) {
    meaningfulText(record.name, `${record.id}.name`);
    meaningfulText(record.japanese, `${record.id}.japanese`);
    meaningfulText(record.description, `${record.id}.description`);
  }
  for (const [groupIndex, group] of weights.entries()) {
    meaningfulText(group.description, `weights[${groupIndex}].description`);
    for (const [categoryIndex, category] of group.categories.entries()) meaningfulText(category.descriptor, `weights[${groupIndex}].categories[${categoryIndex}].descriptor`);
  }
  return { judoka, techniques, countries, weights, dataset };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await validateCanonical();
  console.log('Canonical data is valid.');
}
