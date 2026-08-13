import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

async function emit(sourceDirectory, outputFile) {
  const records = await readRecords(sourceDirectory);
  records.sort(compareStableIds);
  await writeFile(path.join(root, 'dist', outputFile), `${JSON.stringify(records, null, 2)}\n`);
}

await mkdir(path.join(root, 'dist'), { recursive: true });
await Promise.all([
  emit('data/judoka', 'judoka.json'),
  emit('data/techniques', 'techniques.json'),
]);
