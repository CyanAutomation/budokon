import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
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
      return JSON.parse(contents);
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

async function emit(sourceDirectory, outputFile) {
  const records = await readRecords(sourceDirectory);
  if (sourceDirectory === 'data/judoka') {
    validateJudoka(records);
  }
  records.sort(compareStableIds);
  await writeFile(path.join(root, 'dist', outputFile), `${JSON.stringify(records, null, 2)}\n`);
}

await mkdir(path.join(root, 'dist'), { recursive: true });
await Promise.all([
  emit('data/judoka', 'judoka.json'),
  emit('data/techniques', 'techniques.json'),
]);
