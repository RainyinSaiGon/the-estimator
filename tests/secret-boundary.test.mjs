import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(
  new URL("../scripts/check-secret-boundary.mjs", import.meta.url),
);
const sentinel = "synthetic-test-only-credential-boundary";

test("boundary scan excludes local compiler cache and rejects credentials in deployable output", () => {
  const root = mkdtempSync(path.join(tmpdir(), "estimator-boundary-"));
  const write = (name, value) => {
    const target = path.join(root, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, value);
  };
  const scan = () =>
    spawnSync(process.execPath, [script], {
      cwd: root,
      env: { ...process.env, OPENAI_API_KEY: sentinel },
      encoding: "utf8",
    });
  try {
    write("apps/web/.next/cache/turbopack/local.sst", sentinel);
    write("dist/client/app.js", "safe output");
    assert.equal(scan().status, 0);
    for (const target of [
      "dist/client/app.js",
      "dist/server/worker.js",
      "apps/web/.next/server/page.js",
      "apps/web/.next/standalone/server.js",
    ]) {
      write(target, sentinel);
      const result = scan();
      assert.equal(result.status, 1, target);
      assert.match(result.stderr, /runtime credential was found/);
      write(target, "safe output");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
