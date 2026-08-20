import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileArtifacts } from './build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

export async function verifyArtifactConsistency({ artifactDirectory, expectedArtifacts, sourceGitCommit }) {
  if (!sourceGitCommit || !/^[0-9a-f]{40}$/i.test(sourceGitCommit)) {
    throw new Error('SOURCE_GIT_COMMIT must be supplied as a full Git commit hash');
  }
  const expectedNames = Object.keys(expectedArtifacts).sort();
  const actualNames = (await readdir(artifactDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  if (!actualNames.includes('manifest.json')) {
    throw new Error('dist/manifest.json is missing');
  }
  const absent = expectedNames.filter((name) => !actualNames.includes(name));
  const extra = actualNames.filter((name) => !expectedNames.includes(name));
  if (absent.length) throw new Error(`Missing dist artifacts: ${absent.join(', ')}`);
  if (extra.length) throw new Error(`Unlisted dist artifacts: ${extra.join(', ')}`);

  const actual = Object.fromEntries(await Promise.all(actualNames.map(async (name) =>
    [name, await readFile(path.join(artifactDirectory, name))])));
  let manifest;
  try {
    manifest = JSON.parse(actual['manifest.json']);
  } catch (error) {
    throw new Error('dist/manifest.json is not valid JSON', { cause: error });
  }
  if (manifest.sourceGitCommit !== sourceGitCommit) {
    throw new Error(`Stale source commit: manifest records ${JSON.stringify(manifest.sourceGitCommit)}, expected ${sourceGitCommit}`);
  }
  // The aggregate embeds the manifest, so its integrity is established by the
  // exact compiler-output comparison below rather than a circular checksum.
  const payloadNames = actualNames.filter((name) => name !== 'manifest.json' && name !== 'budokon.json');
  const checksumNames = Object.keys(manifest.checksums ?? {}).sort();
  if (JSON.stringify(checksumNames) !== JSON.stringify(payloadNames)) {
    throw new Error('Manifest checksum entries do not list every artifact exactly once');
  }
  for (const name of payloadNames) {
    const checksum = sha256(actual[name]);
    if (manifest.checksums[name] !== checksum) {
      throw new Error(`Checksum mismatch for ${name}: recorded ${manifest.checksums[name]}, actual ${checksum}`);
    }
  }
  for (const name of expectedNames) {
    if (!actual[name].equals(Buffer.from(expectedArtifacts[name]))) {
      throw new Error(`Artifact differs from canonical compiler output: ${name}`);
    }
  }
}

export async function checkArtifacts() {
  const sourceGitCommit = process.env.SOURCE_GIT_COMMIT;
  const expectedArtifacts = await compileArtifacts(sourceGitCommit);
  await verifyArtifactConsistency({ artifactDirectory: path.join(root, 'dist'), expectedArtifacts, sourceGitCommit });
  console.log(`dist/ matches canonical output for ${sourceGitCommit}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkArtifacts();
