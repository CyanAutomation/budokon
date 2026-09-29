import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const coverageDirectory = fileURLToPath(new URL("../coverage/v8", import.meta.url));
rmSync(coverageDirectory, { recursive: true, force: true });

const packageManager = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(packageManager, ["test"], {
  stdio: "inherit",
  env: { ...process.env, NODE_V8_COVERAGE: coverageDirectory },
});

if (result.error) {
  console.error(result.error.message);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
