import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Run from the clean managed Sites source checkout before its normal source helper.
// This stages the complete GitHub tree; no individual application files are copied.
const [sha] = process.argv.slice(2);
if (!/^[a-f0-9]{40}$/.test(sha ?? "")) throw new Error("Supply the verified full GitHub main commit SHA.");
function git(...args) { const result = spawnSync("git", args, { encoding: "utf8" }); if (result.status !== 0) throw new Error(result.stderr); return result.stdout.trim(); }
if (git("status", "--porcelain")) throw new Error("Preserve local changes before staging a release.");
const project = JSON.parse(readFileSync(".openai/hosting.json", "utf8")).project_id;
git("fetch", "--no-tags", "https://github.com/RainyinSaiGon/the-estimator.git", "refs/heads/main");
if (git("rev-parse", "FETCH_HEAD") !== sha) throw new Error("GitHub main changed; build and verify the new commit before publishing.");
const target = JSON.parse(git("show", `${sha}:.openai/hosting.json`));
if (target.project_id !== project) throw new Error("The GitHub release targets a different Site.");
git("read-tree", "--reset", "-u", sha);
if (git("write-tree") !== git("rev-parse", `${sha}^{tree}`)) throw new Error("Staged source does not match the GitHub release.");
console.log(JSON.stringify({ githubCommit: sha, sourceTree: git("write-tree"), project_id: project, status: "staged-for-Sites-source-helper" }));
