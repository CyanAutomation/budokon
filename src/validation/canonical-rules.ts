import path from 'node:path';
import { meaningfulText, ensureUnique, rejectGameStateProperties, rejectFutureDate } from "./validators.js";
import { normalizeCatalogText } from "../contracts/text-normalization.js";
import { NUMERIC_EVENT_TARGETS, STATE_EVENT_TARGETS } from '../contracts/event-effects.js';
import type {
  CanonicalCountries,
  CanonicalEffect,
  CanonicalEvent,
  CanonicalJudoka,
  CanonicalTechnique,
  CanonicalWeightGroup,
  ValidatedCanonicalData,
} from "./canonical-types.js";

function fail(location: string, message: string): never {
  throw new Error(`${location}: ${message}`);
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
  ensureUnique(judoka, 'handles', 'judoka slug or legacy slug', item => [item.slug, ...(item.legacySlugs ?? [])]);
  const names = new Map<string, string>();
  for (const record of judoka) {
    for (const name of [`${record.firstname} ${record.surname}`, ...(record.aliases ?? [])]) {
      const normalized = normalizeCatalogText(name);
      if (names.has(normalized) && names.get(normalized) !== record.slug) {
        throw new Error(`ambiguous normalized judoka name ${JSON.stringify(normalized)} in ${names.get(normalized)} and ${record.slug}`);
      }
      names.set(normalized, record.slug);
    }
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
  const weightMap = new Map<string, Set<string>>();
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

function validateJudokaIdentity(
  record: CanonicalJudoka,
  countries: CanonicalCountries,
  techniqueIds: Set<string>,
  weightMap: Map<string, Set<string>>,
): void {
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

function validateJudoka(
  judoka: CanonicalJudoka[],
  countries: CanonicalCountries,
  techniqueIds: Set<string>,
  weightMap: Map<string, Set<string>>,
): void {
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

const numericEventTargets: Set<string> = new Set(NUMERIC_EVENT_TARGETS);
const stateEventTargets: Set<string> = new Set(STATE_EVENT_TARGETS);

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

function validateEvents(events: CanonicalEvent[]): void {
  for (const event of events) {
    meaningfulText(event.description, `${event.id}.description`);
    for (const [index, effect] of event.effects.entries()) validateEventEffect(event.id, index, effect);
  }
}

function validateWeightDescriptions(weights: CanonicalWeightGroup[]): void {
  for (const [groupIndex, group] of weights.entries()) {
    meaningfulText(group.description, `weights[${groupIndex}].description`);
    for (const [categoryIndex, category] of group.categories.entries()) {
      meaningfulText(category.descriptor, `weights[${groupIndex}].categories[${categoryIndex}].descriptor`);
    }
  }
}

export function validateCanonicalRules(data: ValidatedCanonicalData): void {
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
}
