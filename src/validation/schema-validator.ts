import { isValidDateTime } from "./validators.js";

function fail(location: string, message: string): never {
  throw new Error(`${location}: ${message}`);
}

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function resolveSchemaReference(reference: string, rootSchema: any, location: string): any {
  if (!reference.startsWith("#/")) throw new Error(`${location}: unsupported $ref format ${reference}`);
  return reference.slice(2).split('/').reduce((node, key) => {
    if (!node || typeof node !== 'object' || !Object.hasOwn(node, key)) {
      throw new Error(`${location}: invalid $ref path ${reference}`);
    }
    return node[key];
  }, rootSchema);
}

function validateSchemaType(value: any, schema: any, location: string): void {
  if (schema.const !== undefined && !equal(value, schema.const)) fail(location, `must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((item: unknown) => equal(item, value))) fail(location, `must be one of ${schema.enum.join(', ')}`);
  if (!schema.type) return;

  const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : Number.isInteger(value) ? 'integer' : typeof value;
  const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (!expected.some((type: string) => actual === type || (type === 'number' && typeof value === 'number'))) {
    fail(location, `must be ${expected.join(' or ')}`);
  }
}

function validateSchemaString(value: string, schema: any, location: string): void {
  if (schema.minLength !== undefined && value.length < schema.minLength) fail(location, `must contain at least ${schema.minLength} characters`);
  if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) fail(location, `must match ${schema.pattern}`);
  if (schema.format === 'uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail(location, 'must be a UUID');
  if (schema.format === 'date-time' && !isValidDateTime(value)) fail(location, 'must be an RFC 3339 UTC timestamp');
  if (schema.format === 'uri') {
    try { new URL(value); }
    catch { fail(location, 'must be an absolute URI'); }
  }
}

function validateSchemaNumber(value: number, schema: any, location: string): void {
  if (schema.minimum !== undefined && value < schema.minimum) fail(location, `must be >= ${schema.minimum}`);
  if (schema.maximum !== undefined && value > schema.maximum) fail(location, `must be <= ${schema.maximum}`);
}

function validateSchemaArray(value: unknown[], schema: any, location: string, rootSchema: any): void {
  if (schema.minItems !== undefined && value.length < schema.minItems) fail(location, `must have at least ${schema.minItems} items`);
  if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(location, `must have at most ${schema.maxItems} items`);
  if (schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) fail(location, 'must contain unique items');
  if (schema.items) value.forEach((item, index) => validateSchema(item, schema.items, `${location}[${index}]`, rootSchema));
}

function validateSchemaObject(value: Record<string, unknown>, schema: any, location: string, rootSchema: any): void {
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
export function validateSchema(value: unknown, schema: any, location = '$', rootSchema = schema): void {
  if (schema.$ref) return validateSchema(value, resolveSchemaReference(schema.$ref, rootSchema, location), location, rootSchema);
  validateSchemaType(value, schema, location);
  if (typeof value === 'string') validateSchemaString(value, schema, location);
  if (typeof value === 'number') validateSchemaNumber(value, schema, location);
  if (Array.isArray(value)) validateSchemaArray(value, schema, location, rootSchema);
  else if (value && typeof value === 'object') validateSchemaObject(value as Record<string, unknown>, schema, location, rootSchema);
}
