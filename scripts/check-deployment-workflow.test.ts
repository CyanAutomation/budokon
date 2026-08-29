import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const checkerPath = new URL('./check-deployment-workflow.ts', import.meta.url);
const tsxLoader = import.meta.resolve('tsx');

test('deployment workflow check identifies a missing entry point', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'budokon-deployment-workflow-'));
  t.after(() => rm(directory, { recursive: true, force: true }));

  await mkdir(path.join(directory, '.github/workflows'), { recursive: true });
  await writeFile(
    path.join(directory, '.github/workflows/deploy-cloudflare.yml'),
    'jobs:\n  deploy:\n    steps:\n      - run: npm run validate:deployment-target\n      - run: npm run smoke:deployment\n',
  );
  await writeFile(
    path.join(directory, 'package.json'),
    JSON.stringify({
      scripts: {
        'validate:deployment-target': 'tsx scripts/missing-validator.ts',
        'smoke:deployment': 'tsx scripts/missing-smoke-test.ts',
      },
    }),
  );

  await assert.rejects(
    execFileAsync(process.execPath, ['--import', tsxLoader, checkerPath.pathname], { cwd: directory }),
    (error: Error & { stderr?: string }) => {
      assert.match(error.stderr ?? '', /Entry point file not found: scripts\/missing-validator\.ts/);
      return true;
    },
  );
});
