import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCanonical } from '../src/validation/validate-canonical.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const uuidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
export const countryCodePattern = /^[A-Z]{2}$/;

export function validateCountries(countries) {
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
  for (const record of judoka) if (record.signatureMoveId !== undefined && record.signatureMoveId !== null && !ids.has(record.signatureMoveId)) throw new Error(`Judoka ${record.slug} references unknown technique ${JSON.stringify(record.signatureMoveId)}`);
}
export const expandJudokaCountries = (judoka, countries) => judoka.map((record) => ({ ...record, country: countries[record.countryCode]?.country }));

export async function build() {
  const { judoka, techniques, countries, weights, dataset } = await validateCanonical(root);
  const service = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const stable = (a, b) => String(a.id).localeCompare(String(b.id), 'en');
  await mkdir(path.join(root, 'dist'), { recursive: true });
  const artifacts = {
    'judoka.json': `${JSON.stringify(expandJudokaCountries(judoka, countries).sort(stable), null, 2)}\n`,
    'techniques.json': `${JSON.stringify(techniques.sort(stable), null, 2)}\n`,
  };
  await Promise.all(Object.entries(artifacts).map(([name, content]) => writeFile(path.join(root, 'dist', name), content)));
  const sourceGitCommit = process.env.SOURCE_GIT_COMMIT
    ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (!/^[0-9a-f]{40}$/i.test(sourceGitCommit)) throw new Error('SOURCE_GIT_COMMIT must be a full Git commit hash');
  const manifest = {
    datasetVersion: dataset.datasetVersion,
    serviceVersion: service.version,
    sourceGitCommit,
    recordCounts: {
      judoka: judoka.length,
      techniques: techniques.length,
      countries: Object.keys(countries).length,
      weightCategories: weights.reduce((total, group) => total + group.categories.length, 0),
    },
    checksums: Object.fromEntries(Object.entries(artifacts).map(([name, content]) => [name, `sha256:${createHash('sha256').update(content).digest('hex')}`])),
  };
  await writeFile(path.join(root, 'dist/manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
