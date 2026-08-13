import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const uuidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function readRecords(directory) {
  const sourceDirectory = path.join(root, directory);
  const files = (await readdir(sourceDirectory))
    .filter((file) => file.endsWith('.json'))
    .sort();

  return Promise.all(files.map(async (file) => {
    const sourcePath = path.join(sourceDirectory, file);
    const contents = await readFile(sourcePath, 'utf8');
    try {
      const record = JSON.parse(contents);
      if (directory === 'data/techniques' && file !== `${record.id}.json`) {
        throw new Error(`Technique filename ${file} does not match id ${JSON.stringify(record.id)}`);
      }
      return record;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse JSON in ${path.relative(root, sourcePath)}: ${reason}`);
    }
  }));
}

function compareStableIds(left, right) {
  if (typeof left.id === 'number' && typeof right.id === 'number') {
    return left.id - right.id;
  }
  return String(left.id).localeCompare(String(right.id), 'en');
}

function validateJudoka(records) {
  const ids = new Map();
  const handles = new Map();

  for (const record of records) {
    const label = record.slug ?? record.id ?? '<unknown>';
    if (typeof record.id !== 'string' || !uuidPattern.test(record.id)) {
      throw new Error(`Judoka ${label} has an invalid UUID id: ${JSON.stringify(record.id)}`);
    }
    if (ids.has(record.id)) {
      throw new Error(`Duplicate judoka id ${record.id} used by ${ids.get(record.id)} and ${label}`);
    }
    ids.set(record.id, label);

    if (typeof record.slug !== 'string' || !slugPattern.test(record.slug)) {
      throw new Error(`Judoka ${label} has an invalid slug: ${JSON.stringify(record.slug)}`);
    }
    const aliases = record.aliases ?? [];
    if (!Array.isArray(aliases)) {
      throw new Error(`Judoka ${label} aliases must be an array`);
    }

    for (const handle of [record.slug, ...aliases]) {
      if (typeof handle !== 'string' || !slugPattern.test(handle)) {
        throw new Error(`Judoka ${label} has an invalid alias: ${JSON.stringify(handle)}`);
      }
      if (handles.has(handle)) {
        throw new Error(`Judoka handle ${handle} collides between ${handles.get(handle)} and ${label}`);
      }
      handles.set(handle, label);
    }
  }
}

function validateTechniques(records) {
  const ids = new Set();
  const names = new Set();
  const japaneseNames = new Set();
  const classifications = {
    'Nage-waza': new Set(['Te-waza', 'Koshi-waza', 'Ashi-waza', 'Ma-sutemi-waza', 'Yoko-sutemi-waza']),
    'Katame-waza': new Set(['Osaekomi-waza', 'Shime-waza', 'Kansetsu-waza']),
  };

  for (const record of records) {
    if (typeof record.id !== 'string' || !slugPattern.test(record.id)) {
      throw new Error(`Technique has an invalid slug id: ${JSON.stringify(record.id)}`);
    }
    if (ids.has(record.id)) throw new Error(`Duplicate technique id: ${record.id}`);
    if (names.has(record.name)) throw new Error(`Duplicate technique name: ${record.name}`);
    if (japaneseNames.has(record.japanese)) throw new Error(`Duplicate Japanese technique name: ${record.japanese}`);
    if (!classifications[record.category]?.has(record.subCategory)) {
      throw new Error(`Technique ${record.id} has invalid classification ${record.category}/${record.subCategory}`);
    }
    ids.add(record.id);
    names.add(record.name);
    japaneseNames.add(record.japanese);
  }

  return ids;
}

export function validateTechniqueReferences(judoka, techniqueIds) {
  for (const record of judoka) {
    if (Object.hasOwn(record, 'signatureMoveId') && !techniqueIds.has(record.signatureMoveId)) {
      throw new Error(`Judoka ${record.slug} references unknown technique ${JSON.stringify(record.signatureMoveId)}`);
    }
  }
}

async function emit(records, outputFile) {
  records.sort(compareStableIds);
  await writeFile(path.join(root, 'dist', outputFile), `${JSON.stringify(records, null, 2)}\n`);
}

await mkdir(path.join(root, 'dist'), { recursive: true });
const [judoka, techniques] = await Promise.all([
  readRecords('data/judoka'),
  readRecords('data/techniques'),
]);
validateJudoka(judoka);
const techniqueIds = validateTechniques(techniques);
validateTechniqueReferences(judoka, techniqueIds);
await Promise.all([
  emit(judoka, 'judoka.json'),
  emit(techniques, 'techniques.json'),
]);
