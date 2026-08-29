import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCanonical } from '../src/validation/validate-canonical.js';
import algorithmContract from '../src/draw/algorithm-contract.json' with { type: 'json' };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const uuidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
export const countryCodePattern = /^[A-Z]{2}$/;

export interface CountryCatalogEntry {
  code: string;
  country: string;
  active: boolean;
}

export type CountryCatalog = Record<string, CountryCatalogEntry>;

export function validateCountries(countries: CountryCatalog) {
  for (const [key, country] of Object.entries(countries)) {
    if (!countryCodePattern.test(key)) throw new Error(`Country key ${key} is invalid`);
    if (country.code !== key) throw new Error(`Country key ${key} does not match embedded code ${JSON.stringify(country.code)}`);
  }
}
export function validateCountryReferences(judoka, countries) {
  for (const record of judoka) {
    if (!countries[record.countryCode]) throw new Error(`Judoka ${record.slug} references unknown country ${JSON.stringify(record.countryCode)}`);
    if (!countries[record.countryCode].active) throw new Error(`Judoka ${record.slug} references inactive country ${JSON.stringify(record.countryCode)}`);
  }
}
export function validateTechniqueReferences(judoka, ids) {
  for (const record of judoka) for (const techniqueId of record.signatureMoveIds ?? []) if (!ids.has(techniqueId)) throw new Error(`Judoka ${record.slug} references unknown technique ${JSON.stringify(techniqueId)}`);
}
export const expandJudokaCountries = (judoka, countries) => judoka.map((record) => ({ ...record, country: countries[record.countryCode]?.country }));

// These comparisons deliberately use Unicode code units, rather than localeCompare,
// so the ordering contract is identical on every host.
const compareKey = (left, right) => String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0;
const byId = (left, right) => compareKey(left.id, right.id);
const sortCountries = (countries) => Object.fromEntries(Object.entries(countries).sort(([left], [right]) => compareKey(left, right)));
const sortWeights = (weights) => weights.map((group) => ({
  ...group,
  categories: [...group.categories].sort((left, right) => compareKey(left.weight, right.weight)),
})).sort((left, right) => compareKey(left.gender, right.gender));

export async function compileArtifacts(sourceGitCommit, sourceRoot = root) {
  if (!sourceGitCommit) throw new Error('SOURCE_GIT_COMMIT is required; generated artifacts must identify an explicit source commit');
  if (!/^[0-9a-f]{40}$/i.test(sourceGitCommit)) throw new Error('SOURCE_GIT_COMMIT must be a full Git commit hash');
  const { judoka, techniques, events, countries, weights, dataset } = await validateCanonical(sourceRoot);
  const service = JSON.parse(await readFile(path.join(sourceRoot, 'package.json'), 'utf8'));
  if (typeof dataset?.datasetVersion !== 'string' || dataset.datasetVersion.trim() === '') {
    throw new Error('Invalid dataset: missing datasetVersion');
  }
  if (typeof service?.version !== 'string' || service.version.trim() === '') {
    throw new Error('Invalid package.json: missing version');
  }
  const compiled = {
    datasetVersion: dataset.datasetVersion,
    judoka: expandJudokaCountries(judoka, countries).sort(byId),
    techniques: [...techniques].sort(byId),
    events: [...events].sort(byId),
    countries: sortCountries(countries),
    weightCategories: sortWeights(weights),
  };
  const artifacts = {
    'judoka.json': `${JSON.stringify(compiled.judoka, null, 2)}\n`,
    'techniques.json': `${JSON.stringify(compiled.techniques, null, 2)}\n`,
    'events.json': `${JSON.stringify(compiled.events, null, 2)}\n`,
    'countries.json': `${JSON.stringify(compiled.countries, null, 2)}\n`,
    'weight-categories.json': `${JSON.stringify(compiled.weightCategories, null, 2)}\n`,
    'budokon.json': `${JSON.stringify(compiled, null, 2)}\n`,
  };
  const manifest = {
    datasetVersion: dataset.datasetVersion,
    serviceVersion: service.version,
    drawAlgorithms: [...algorithmContract.supported],
    defaultDrawAlgorithm: algorithmContract.default,
    sourceGitCommit,
    recordCounts: {
      judoka: judoka.length,
      techniques: techniques.length,
      events: events.length,
      countries: Object.keys(countries).length,
      weightCategories: weights.reduce((total, group) => total + group.categories.length, 0),
    },
    checksums: Object.fromEntries(Object.entries(artifacts).map(([name, content]) => [name, `sha256:${createHash('sha256').update(content).digest('hex')}`])),
  };
  artifacts['manifest.json'] = `${JSON.stringify(manifest, null, 2)}\n`;
  return artifacts;
}

export async function build() {
  const artifacts = await compileArtifacts(process.env.SOURCE_GIT_COMMIT);
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await Promise.all(Object.entries(artifacts).map(([name, content]) => writeFile(path.join(root, 'dist', name), content)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
