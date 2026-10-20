import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const secret = process.env.OPENAI_API_KEY;
const buildCache = resolve('apps/web/.next/cache');
function walk(dir) {
  // Next's local compiler cache is not part of the standalone deployment.
  if (resolve(dir) === buildCache) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
}
const artifactDirectories = ['dist', 'apps/web/.next'].filter(existsSync);
if (artifactDirectories.length === 0) throw new Error('Build the application before checking the deployment output.');
if (secret && artifactDirectories.flatMap(walk).some(file => readFileSync(file).includes(Buffer.from(secret)))) {
  throw new Error('A runtime credential was found in generated output. Do not publish this build.');
}
console.log(secret ? 'Credential is absent from generated output.' : 'No local credential present; source-only boundary check skipped.');
