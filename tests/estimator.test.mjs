import test from 'node:test';
import assert from 'node:assert/strict';
import { demoScope, estimateProject, getHistory, scopeMatchesBaseline, validateActuals } from '../lib/estimator.ts';
import { sampleBrief, seedHistory } from '../lib/estimator-data.ts';
import { groundEvidence } from '../lib/evidence.ts';
import { sourceAnswers } from '../lib/source-answers.ts';
const scope = demoScope(sampleBrief);
const answers = { direction: 'one-way', api: 'documented', quality: 'mixed', volume: 'medium', mapping: 'standard' };
const p = { scope, answers, excluded: [] };
test('AI suggestions cannot turn unconfirmed API access into custom implementation', () => {
  const guarded = sourceAnswers(sampleBrief, { ...answers, api: 'custom', direction: 'one-way' });
  assert.equal(guarded.api, 'unknown');
  assert.equal(guarded.direction, 'unknown');
  assert.equal(guarded.mapping, 'unknown');
});
test('mapping delivery work is included even when it is not an explicit client deliverable', () => {
  assert.ok(estimateProject({ ...p, scope: { ...scope, requirements: scope.requirements.filter(r => r.id !== 'mapping') } }, []).tasks.some(t => t.category === 'mapping'));
});
test('evidence accepts formatting differences and returns the exact source span', () => {
  const source = "We don't need two-way sync.\nPlease import  500 contacts.";
  assert.equal(groundEvidence(source, 'We don’t need two-way sync.'), "We don't need two-way sync.");
  assert.equal(groundEvidence(source, 'Please import 500 contacts.'), 'Please import  500 contacts.');
  assert.equal(groundEvidence(source, 'Please import 500 companies.'), null);
  assert.equal(groundEvidence(source, ''), null);
});
test('scope quotes are present in source and missing direction/API remain unknown', () => {
  scope.requirements.forEach(r => assert.ok(sampleBrief.includes(r.evidence)));
  assert.equal(scope.initialAnswers.direction, 'unknown');
  assert.equal(scope.initialAnswers.api, 'unknown');
  assert.equal(scope.initialAnswers.volume, 'medium');
  assert.equal(scope.initialAnswers.quality, 'mixed');
});
test('unconfirmed critical questions prevent a ready estimate', () => {
  assert.equal(estimateProject({ ...p, answers: scope.initialAnswers }, []).blockers.length, 2);
  assert.equal(estimateProject(p, []).blockers.length, 0);
});
test('two-way work is larger than otherwise identical one-way work', () => {
  assert.ok(estimateProject({ ...p, answers: { ...answers, direction: 'two-way' } }, seedHistory).hours > estimateProject(p, seedHistory).hours);
});
test('unknown drivers widen the range', () => {
  const unknown = estimateProject({ ...p, answers: scope.initialAnswers }, []);
  const known = estimateProject(p, []);
  assert.ok((unknown.high - unknown.low) / unknown.hours > (known.high - known.low) / known.hours);
});
test('identical inputs produce identical estimates', () => assert.deepEqual(estimateProject(p, seedHistory), estimateProject(p, seedHistory)));
test('exclusions remove both sync and its authentication work', () => {
  const result = estimateProject({ ...p, excluded: ['sync'] }, []);
  assert.ok(!result.tasks.some(t => t.category === 'authentication' || t.category === 'sync'));
  assert.ok(result.hours < estimateProject(p, []).hours);
});
test('recorded original effort affects comparable work; additions are excluded', () => {
  const before = estimateProject(p, []);
  const record = { id: 'delivered', title: 'Delivered import', versions: [{ answers, estimate: before }], actuals: { hours: Object.fromEntries(before.tasks.map(t => [t.category, t.base * 2])), additionalHours: 900, synthetic: true } };
  const history = getHistory([record]);
  const delivered = history.find(h => h.id === record.id);
  assert.equal(delivered.synthetic, true);
  assert.equal(delivered.actual.import, before.tasks.find(t => t.category === 'import').base * 2);
  const after = estimateProject(p, [delivered]);
  assert.ok(after.hours > before.hours);
  assert.ok(after.hours < before.hours * 2);
  record.actuals.additionalHours = 0;
  assert.deepEqual(getHistory([record]), history);
});
test('unfinished projects do not enter history', () => assert.equal(getHistory([{ id: 'draft', versions: [], actuals: null }]).length, seedHistory.length));
test('invalid and missing actual hours cannot enter calibration', () => {
  const e = estimateProject(p, []);
  const values = Object.fromEntries(e.tasks.map(t => [t.category, t.hours]));
  for (const v of [0, -1, NaN, Infinity, 10001, undefined]) assert.throws(() => validateActuals(e, { hours: { ...values, import: v }, additionalHours: 0, explanation: '', synthetic: false }));
  assert.throws(() => validateActuals(e, { hours: values, additionalHours: 5, explanation: '', synthetic: false }));
  assert.doesNotThrow(() => validateActuals(e, { hours: values, additionalHours: 5, explanation: 'An extra lookup was requested.', synthetic: false }));
});
test('scope changes require another baseline before recording delivery', () => {
  const project = { ...p, notes: '', versions: [{ answers: { ...answers }, excluded: [], notes: '' }] };
  assert.ok(scopeMatchesBaseline(project));
  assert.ok(!scopeMatchesBaseline({ ...project, notes: 'A changed agreement' }));
  assert.ok(!scopeMatchesBaseline({ ...project, answers: { ...answers, direction: 'two-way' } }));
  assert.ok(!scopeMatchesBaseline({ ...project, excluded: ['import'] }));
});
test('unsupported or too-short briefs fail clearly', () => {
  assert.throws(() => demoScope('Build something'));
  assert.throws(() => demoScope('We need furniture for our new office and interior design services.'));
});
test('an entirely excluded client scope cannot be reviewed as ready', () => {
  const result = estimateProject({ ...p, excluded: scope.requirements.map(r => r.id) }, []);
  assert.ok(result.blockers.some(b => b.includes('at least one')));
});
test('hours for tasks outside the baseline must be recorded as additional scope', () => {
  const e = estimateProject({ ...p, excluded: ['sync'] }, []);
  const actuals = { hours: Object.fromEntries(e.tasks.map(t => [t.category, t.hours])), additionalHours: 0, explanation: '', synthetic: true };
  actuals.hours.sync = 10;
  assert.throws(() => validateActuals(e, actuals));
});
