import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const [output] = process.argv.slice(2);
if (!output || !path.isAbsolute(output)) throw new Error("Supply an absolute release archive path.");
function git(...args) { const result = spawnSync("git", args, { encoding: "utf8" }); if (result.status !== 0) throw new Error(result.stderr); return result.stdout.trim(); }
if (git("status", "--porcelain")) throw new Error("Release source must be committed and clean.");
const sha = git("rev-parse", "HEAD");
if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== sha) throw new Error("The checkout does not match this GitHub Actions run.");
const manifest = JSON.parse(readFileSync(".openai/hosting.json", "utf8"));
if (!manifest.project_id || !existsSync("dist/server/index.js")) throw new Error("Build the Sites Worker before packaging.");
const stage = mkdtempSync(path.join(tmpdir(), "estimator-sites-release-"));
mkdirSync(path.join(stage, "dist", ".openai"), { recursive: true });
cpSync("dist/server", path.join(stage, "dist", "server"), { recursive: true });
cpSync("dist/client", path.join(stage, "dist", "client"), { recursive: true });
cpSync("drizzle", path.join(stage, "dist", ".openai", "drizzle"), { recursive: true });
writeFileSync(path.join(stage, "dist", ".openai", "hosting.json"), JSON.stringify(manifest, null, 2) + "\n");
const provenance = { repository: "RainyinSaiGon/the-estimator", githubCommit: sha, sourceTree: git("rev-parse", "HEAD^{tree}"), workflowRun: process.env.GITHUB_RUN_ID ?? null };
writeFileSync(path.join(stage, "dist", ".openai", "github-release.json"), JSON.stringify(provenance, null, 2) + "\n");
writeFileSync(path.join(stage, "dist", "client", "release.json"), JSON.stringify(provenance, null, 2) + "\n");
mkdirSync(path.dirname(output), { recursive: true });
const archived = spawnSync("tar", ["-czf", output, "-C", stage, "dist"], { encoding: "utf8" });
if (archived.status !== 0) throw new Error(archived.stderr);
console.log(JSON.stringify({ archive: output, ...provenance }));
