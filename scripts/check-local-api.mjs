import assert from 'node:assert/strict';
const origin = 'http://127.0.0.1:5173';
const url = `${origin}/api/workspace`;
const headers = { cookie: '__sites_local_auth=1', 'content-type': 'application/json', origin };
assert.equal((await fetch(url)).status, 401, 'anonymous API access must fail');
const read = await fetch(url, { headers });
assert.equal(read.status, 200);
const workspace = await read.json();
assert.ok(Array.isArray(workspace.projects));
const post = body => ({ method: 'POST', headers, body: JSON.stringify(body) });
assert.equal((await fetch(url, { ...post({ action: 'create' }), headers: { ...headers, origin: 'https://untrusted.example' } })).status, 403);
assert.equal((await fetch(url, post({ action: 'unknown' }))).status, 400);
assert.equal((await fetch(url, post({ action: 'freeze', id: '00000000-0000-4000-8000-000000000000', expectedUpdatedAt: '', reviewed: true }))).status, 404);
const project = workspace.projects.find(p => p.actuals);
if (project) {
  assert.equal((await fetch(url, post({ action: 'freeze', id: project.id, expectedUpdatedAt: 'stale', reviewed: true }))).status, 409);
  assert.equal((await fetch(url, post({ action: 'freeze', id: project.id, expectedUpdatedAt: project.updatedAt, reviewed: true }))).status, 400);
  assert.equal((await (await fetch(url, { headers })).json()).projects.find(p => p.id === project.id).versions.length, project.versions.length);
}
console.log(`Local API checks passed: authentication, origin, validation, missing record${project ? ', stale write, completed-record protection, unchanged baseline' : ''}.`);
