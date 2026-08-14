import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const placeholder = /^(?:todo|tbd|unknown|n\/?a|none|more info to come)(?:[\s:;,.!…]|$)/i;
const rfc3339 = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/;
function isValidDateTime(value) {
  if (!rfc3339.test(value)) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  // Verify the parsed date matches the input (catches invalid dates like month 13)
  return date.toISOString() === value || date.toISOString().replace(/\.\d{3}/, '') === value;
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
  if (schema.type && !(Array.isArray(schema.type) ? schema.type.includes(actual) : actual === schema.type || (schema.type === 'number' && typeof value === 'number'))) fail(location, `must be ${Array.isArray(schema.type) ? schema.type.join(' or ') : schema.type}`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) fail(location, `must contain at least ${schema.minLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) fail(location, `must match ${schema.pattern}`);
    if (schema.format === 'uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail(location, 'must be a UUID');
    if (schema.format === 'date-time' && (!rfc3339.test(value) || Number.isNaN(Date.parse(value)))) fail(location, 'must be an RFC 3339 UTC timestamp');
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
function unique(items, field, label) {
  const seen = new Map();
  for (const item of items) {
    for (const value of field === 'handles' ? [item.slug, ...(item.aliases ?? [])] : [item[field]]) {
      if (seen.has(value)) throw new Error(`duplicate ${label} ${JSON.stringify(value)} in ${seen.get(value)} and ${item.slug ?? item.id}`);
      seen.set(value, item.slug ?? item.id);
    }
  }
}

/** Parse and validate all four canonical datasets, including cross-record rules. */
export async function validateCanonical(root = defaultRoot) {
  const schemaDir = path.join(root, 'schema');
  const [judokaSchema, techniqueSchema, countriesSchema, weightsSchema] = await Promise.all(
    ['judoka', 'technique', 'countries', 'weight-categories'].map((name) => parse(path.join(schemaDir, `${name}.schema.json`))),
  );
  const [judokaFiles, techniqueFiles, countries, weights] = await Promise.all([
    records(path.join(root, 'data/judoka')), records(path.join(root, 'data/techniques')),
    parse(path.join(root, 'data/reference/countries.json')), parse(path.join(root, 'data/reference/weight-categories.json')),
  ]);
  for (const file of judokaFiles) validateSchema(file.value, judokaSchema, `data/judoka/${file.name}`);
  for (const file of techniqueFiles) validateSchema(file.value, techniqueSchema, `data/techniques/${file.name}`);
  validateSchema(countries, countriesSchema, 'data/reference/countries.json');
  validateSchema(weights, weightsSchema, 'data/reference/weight-categories.json');
  const judoka = judokaFiles.map(({ value }) => value), techniques = techniqueFiles.map(({ value }) => value);
  unique(judoka, 'id', 'judoka UUID'); unique(judoka, 'handles', 'judoka slug or alias'); unique(techniques, 'id', 'technique ID');
  const techniqueIds = new Set(techniques.map(({ id }) => id));
  const weightMap = new Map();
  for (const group of weights) {
    if (weightMap.has(group.gender)) throw new Error(`duplicate weight category gender ${group.gender}`);
    const values = group.categories.map(({ weight }) => weight);
    if (new Set(values).size !== values.length) throw new Error(`duplicate ${group.gender} weight category`);
    weightMap.set(group.gender, new Set(values));
  }
  for (const [key, country] of Object.entries(countries)) if (country.code !== key) throw new Error(`country key ${key} does not match embedded code ${country.code}`);
  for (const record of judoka) {
    if (!countries[record.countryCode]?.active) throw new Error(`${record.slug} references unknown or inactive country ${record.countryCode}`);
    if (!techniqueIds.has(record.signatureMoveId)) throw new Error(`${record.slug} references unknown technique ${record.signatureMoveId}`);
    if (!weightMap.get(record.gender)?.has(record.weightClass)) throw new Error(`${record.slug} has invalid ${record.gender} weight class ${record.weightClass}`);
    if (record.personType === 'fictional' && !record.isHidden) throw new Error(`${record.slug} is fictional and must be hidden`);
    if (Date.parse(record.lastUpdated) > Date.now()) throw new Error(`${record.slug} lastUpdated must not be in the future`);
    for (const [field, value] of Object.entries(record)) if (typeof value === 'string' && placeholder.test(value.trim())) throw new Error(`${record.slug}.${field} contains placeholder content`);
  }
  for (const record of techniques) if (placeholder.test(record.description.trim())) throw new Error(`${record.id}.description contains placeholder content`);
  return { judoka, techniques, countries, weights };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await validateCanonical();
  console.log('Canonical data is valid.');
}
