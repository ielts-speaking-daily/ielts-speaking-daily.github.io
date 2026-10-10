import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DataError, LIMITS, STORAGE_KEY, chinaDate, createReviewSession, emptyRecords, exportRecords, getProgress, importRecords, loadRecords, mergeRecords, normalizeRecords, pendingRecordCounts, saveRecords, tasksForDay, validateCorpus } from '../docs/assets/data.mjs';

const corpus = validateCorpus(JSON.parse(readFileSync(new URL('../docs/data/corpus.json', import.meta.url), 'utf8')));
const q = corpus.questions.find(q => q.region === '大陆');
const q2 = corpus.questions.find(item => item.region === '大陆' && item.id !== q.id);
const overseas = corpus.questions.find(q => q.region !== '大陆');
const t0 = '2026-10-10T09:00:00.000Z', t1 = '2026-10-10T10:00:00.000Z', t2 = '2026-10-10T11:00:00.000Z';
const event = (id = 'event-1', type = 'spoken', questionId = q.id, day = 1, occurredAt = t0) => ({ id, questionId, type, day, occurredAt, answerVersion: q.version });
const entry = (id = 'entry-1', values = {}) => ({ id, questionId: q.id, mode: 'free-answer', practiceDate: null, createdAt: t0, source: 'manual', transcript: 'My own original answer.', feedback: '', revisedEnglish: '', revisedChinese: '', ...values });
const records = (values = {}) => normalizeRecords({ ...emptyRecords(), ...values }, corpus);
const errorCode = code => error => error instanceof DataError && error.code === code;
class Storage {
  values = new Map(); failRead = false; failWrite = false; silentlyFail = false;
  getItem(key) { if (this.failRead) throw new Error('denied'); return this.values.get(key) ?? null; }
  setItem(key, value) { if (this.failWrite) throw new Error('quota'); if (!this.silentlyFail) this.values.set(key, value); }
}
function completedBefore(day) {
  return records({ events: corpus.days.filter(d => d.day < day && d.kind === 'new').flatMap(d => d.questionIds.map((id, i) => event(`done-${d.day}-${i}`, 'spoken', id, d.day))) });
}

test('actual corpus has 650 records and exactly 577 mainland planned once', () => {
  assert.equal(corpus.questions.length, 650);
  const planned = corpus.days.flatMap(d => d.questionIds);
  assert.equal(planned.length, 577); assert.equal(new Set(planned).size, 577);
  assert.equal(corpus.days.filter(d => d.kind === 'review').length, 4);
});
test('corpus rejects duplicates, overseas scheduling, and incomplete mainland plans', () => {
  for (const change of [c => c.questions.push({ ...c.questions[0] }), c => c.days[0].questionIds[0] = overseas.id, c => c.days[0].questionIds.pop()]) {
    const copy = structuredClone(corpus); change(copy); assert.throws(() => validateCorpus(copy), errorCode('INVALID_CORPUS'));
  }
});
test('China date is independent of machine timezone and crosses midnight correctly', () => {
  assert.equal(chinaDate('2026-10-09T15:59:59Z'), '2026-10-09');
  assert.equal(chinaDate('2026-10-09T16:00:00Z'), '2026-10-10');
});
test('unknown practice date stays null and original transcript is preserved verbatim', () => {
  const original = '  Uh, I—I use my computer.\n原话未改。  ';
  const actual = records({ entries: [entry('verbatim', { transcript: original, practiceDate: '' })] });
  assert.equal(actual.entries[0].transcript, original); assert.equal(actual.entries[0].practiceDate, null);
});
test('legacy export combines cloud and pending events and preserves day/version/status', () => {
  const imported = normalizeRecords({ exportedAt: t1, user: { id: 'account' }, source: 'self report', reminder: { enabled: true }, events: [event('cloud')], pendingLocalEvents: [{ ...event('pending', 'viewed', q2.id, 3), version: q.version, status: 'pending' }] }, corpus);
  assert.equal(imported.events.length, 2);
  assert.equal(imported.events.find(e => e.id === 'pending').day, 3);
  assert.equal(imported.events.find(e => e.id === 'pending').answerVersion, q.version);
  assert.equal(imported.events.find(e => e.id === 'pending').status, 'pending');
});
test('event version alias is migrated without inventing a version', () => {
  const legacy = event(); delete legacy.answerVersion; legacy.version = 'v01-full';
  assert.equal(records({ events: [legacy] }).events[0].answerVersion, 'v01-full');
  delete legacy.version; assert.throws(() => records({ events: [legacy] }), errorCode('INVALID_FIELD'));
});
test('duplicate imports and same-ID key-order differences are idempotent', () => {
  const a = records({ events: [event()] });
  const reordered = Object.fromEntries(Object.entries(event()).reverse());
  assert.deepEqual(mergeRecords(a, records({ events: [reordered] })), a);
  assert.deepEqual(importRecords(exportRecords(a, corpus), corpus, a), a);
});
test('same-ID event changes are conflicts and leave all input data untouched', () => {
  const a = records({ events: [event()] }), b = records({ events: [event('event-1', 'viewed')] });
  const before = JSON.stringify([a, b]); assert.throws(() => mergeRecords(a, b), errorCode('ID_CONFLICT'));
  assert.equal(JSON.stringify([a, b]), before);
});
test('same-ID entry edits conflict rather than overwrite the original answer', () => {
  assert.throws(() => mergeRecords(records({ entries: [entry()] }), records({ entries: [entry('entry-1', { transcript: 'Replacement' })] })), errorCode('ID_CONFLICT'));
});
test('new revision links retain original and follow-up text', () => {
  const a = records({ entries: [entry('initial')] });
  const result = importRecords({ ...emptyRecords(), entries: [entry('revision', { revisionOf: 'initial', createdAt: t1, revisedEnglish: 'My corrected answer.' })] }, corpus, a);
  assert.equal(result.entries.length, 2); assert.equal(result.entries[0].transcript, 'My own original answer.');
  assert.equal(result.entries[1].revisionOf, 'initial');
});
test('cross-question and cyclic revision associations are rejected', () => {
  assert.throws(() => records({ entries: [entry('old'), entry('new', { questionId: q2.id, revisionOf: 'old' })] }), errorCode('INVALID_REVISION'));
  assert.throws(() => records({ entries: [entry('a', { revisionOf: 'b' }), entry('b', { revisionOf: 'a' })] }), errorCode('INVALID_REVISION'));
});
test('unknown question, event type, fields, schema, and repository are rejected atomically', () => {
  for (const [payload, code] of [
    [{ events: [event('unknown', 'spoken', 'QB-20261008-01-P1-999')] }, 'UNKNOWN_QUESTION'],
    [{ events: [event('unknown-type', 'mastered')] }, 'UNKNOWN_EVENT_TYPE'],
    [{ entries: [{ ...entry(), audio: 'unrecognized' }] }, 'UNKNOWN_FIELD'],
    [{ schemaVersion: 2 }, 'INVALID_SCHEMA'],
    [{ repository: 'another/repository' }, 'WRONG_REPOSITORY']
  ]) assert.throws(() => normalizeRecords({ ...emptyRecords(), ...payload }, corpus), errorCode(code));
});
test('prototype keys, nonplain objects, getters, cycles, and non-JSON values are rejected', () => {
  assert.throws(() => normalizeRecords('{"events":[],"__proto__":{"polluted":true}}', corpus), errorCode('UNSAFE_KEY'));
  assert.throws(() => normalizeRecords('{"user":{"constructor":{"prototype":{}}}}', corpus), errorCode('UNSAFE_KEY'));
  assert.throws(() => normalizeRecords(new Date(), corpus), errorCode('INVALID_OBJECT'));
  const getter = {}; Object.defineProperty(getter, 'events', { enumerable: true, get() { throw new Error('getter should never run'); } });
  assert.throws(() => normalizeRecords(getter, corpus), errorCode('INVALID_JSON'));
  const cycle = {}; cycle.events = cycle; assert.throws(() => normalizeRecords(cycle, corpus), errorCode('INVALID_JSON'));
  assert.throws(() => normalizeRecords({ events: undefined }, corpus), errorCode('INVALID_JSON'));
  assert.equal({}.polluted, undefined);
});
test('malformed and oversized import cannot change existing records', () => {
  const base = records({ events: [event()] }), before = JSON.stringify(base);
  assert.throws(() => importRecords('{broken', corpus, base), errorCode('INVALID_JSON'));
  assert.throws(() => importRecords(' '.repeat(LIMITS.bytes + 1), corpus, base), errorCode('TOO_LARGE'));
  assert.throws(() => records({ entries: [entry('long', { transcript: 'x'.repeat(LIMITS.text + 1) })] }), errorCode('INVALID_FIELD'));
  assert.equal(JSON.stringify(base), before);
});
test('invalid calendar dates and timestamps without timezones are rejected', () => {
  assert.throws(() => records({ entries: [entry('date', { practiceDate: '2026-02-30' })] }), errorCode('INVALID_DATE'));
  for (const occurredAt of ['2026-10-10T10:00:00', '2026-02-30T10:00:00Z', '2026-10-10T25:00:00Z']) assert.throws(() => records({ events: [{ ...event(), occurredAt }] }), errorCode('INVALID_DATE'));
});
test('read-aloud, viewed and candidate confirmation do not count as free answering', () => {
  const actual = records({ events: [event('read', 'read-aloud'), event('see', 'viewed'), event('confirm', 'candidate-confirmed')], entries: [entry('reading', { mode: 'read-aloud' })] });
  const progress = getProgress(corpus, actual);
  assert.equal(progress.covered, 0); assert.equal(progress.readAloud, 1); assert.equal(progress.viewed, 1); assert.equal(progress.candidateConfirmed, 1);
});
test('typed answers and feedback-only entries never count as spoken coverage', () => {
  const actual = records({ entries: [entry('try1'), entry('try2'), entry('feedback-only', { questionId: q2.id, transcript: '', feedback: 'Assistant feedback' })] });
  const progress = getProgress(corpus, actual); assert.equal(progress.covered, 0); assert.equal(progress.entryCount, 3);
  assert.equal(progress.byPart.p1.covered, 0); assert.equal(progress.questionStatus[q.id].written, true);
  assert.equal(progress.questionStatus[q2.id].written, false); assert.equal(progress.questionStatus[q.id].lastPracticedAt, null);
});
test('overseas answers remain available but never inflate mainland coverage', () => {
  const progress = getProgress(corpus, records({ events: [event('overseas', 'spoken', overseas.id)] }));
  assert.equal(progress.covered, 0); assert.equal(progress.questionStatus[overseas.id].covered, true);
});
test('only current-version candidate confirmation applies', () => {
  const actual = records({ events: [{ ...event('old', 'candidate-confirmed'), answerVersion: 'old-version' }] });
  assert.equal(getProgress(corpus, actual).candidateConfirmed, 0);
});
test('needs-review persists after reading or textual corrections and clears only after a spoken event', () => {
  const weak = records({ events: [event('done'), event('weak', 'needs-review', q.id, 1, t1), event('reading', 'read-aloud', q.id, 1, t2)] });
  assert.equal(getProgress(corpus, weak).needsReview, 1);
  const withText = mergeRecords(weak, records({ entries: [entry('old-answer'), entry('correction', { createdAt: t2, revisionOf: 'old-answer' })] }));
  assert.equal(getProgress(corpus, withText).needsReview, 1);
  assert.equal(getProgress(corpus, withText).questionStatus[q.id].lastPracticedAt, t0);
  assert.equal(getProgress(corpus, mergeRecords(withText, records({ events: [event('retry', 'reviewed', q.id, 1, t2)] }))).needsReview, 0);
});
test('review catches up the whole earliest missing lesson, including its covered questions', () => {
  const partial = records({ events: [event()] }), task = tasksForDay(7, corpus, partial);
  assert.equal(task.reason, 'catch-up'); assert.equal(task.sourceDay, 1);
  assert.deepEqual(task.questionIds, corpus.days[0].questionIds);
});
test('completed prior lessons yield exact 4/2/10 sampling with prior weak items first', () => {
  const done = completedBefore(7), weakId = corpus.days[5].questionIds.find(id => id.includes('-P1-'));
  const withWeak = mergeRecords(done, records({ events: [event('weak-priority', 'needs-review', weakId, 6, t1)] }));
  const task = tasksForDay(7, corpus, withWeak);
  assert.equal(task.reason, 'sample'); assert.deepEqual([1, 2, 3].map(p => task.questions.filter(q => q.part === p).length), [4, 2, 10]);
  assert.equal(task.questionIds[0], weakId); assert.equal(new Set(task.questionIds).size, 16);
  assert.ok(task.questions.every(q => q.region === '大陆'));
});
test('unstarted review selection can change as previous lessons are completed', () => {
  assert.equal(tasksForDay(7, corpus, records()).reason, 'catch-up');
  assert.equal(tasksForDay(7, corpus, completedBefore(7)).reason, 'sample');
});
test('persisted snapshot resists delayed pre-start offline synchronization', () => {
  const initial = records(), snapshot = createReviewSession(7, corpus, initial, t1);
  const started = mergeRecords(initial, records({ reviewSessions: [snapshot] }));
  const syncedLater = mergeRecords(started, completedBefore(7));
  assert.deepEqual(tasksForDay(7, corpus, syncedLater).questionIds, corpus.days[0].questionIds);
  assert.equal(tasksForDay(7, corpus, syncedLater).reason, 'catch-up');
  assert.deepEqual(createReviewSession(7, corpus, syncedLater, t2), snapshot);
});
test('snapshot cannot be silently replaced by another browser selection', () => {
  const catchUp = createReviewSession(7, corpus, records(), t1), sample = createReviewSession(7, corpus, completedBefore(7), t1);
  assert.throws(() => mergeRecords(records({ reviewSessions: [catchUp] }), records({ reviewSessions: [sample] })), errorCode('ID_CONFLICT'));
});
test('snapshots with different IDs but the same day also cause a conflict', () => {
  const snapshot = createReviewSession(7, corpus, records(), t1);
  assert.throws(() => records({ reviewSessions: [snapshot, { ...snapshot, id: 'other-browser', createdAt: t2 }] }), errorCode('REVIEW_CONFLICT'));
});
test('snapshots reject new days, future/overseas questions, partial catch-up and wrong sampler sizes', () => {
  const snapshot = createReviewSession(7, corpus, records(), t1);
  const sample = createReviewSession(7, corpus, completedBefore(7), t1);
  for (const invalid of [
    { ...snapshot, day: 1 },
    { ...snapshot, questionIds: [...snapshot.questionIds.slice(1), overseas.id] },
    { ...snapshot, questionIds: [...snapshot.questionIds.slice(1), corpus.days.find(d => d.day === 8).questionIds[0]] },
    { ...snapshot, questionIds: snapshot.questionIds.slice(1) },
    { ...sample, questionIds: sample.questionIds.slice(1) }
  ]) {
    assert.throws(() => records({ reviewSessions: [invalid] }), errorCode('INVALID_REVIEW'));
    assert.throws(() => mergeRecords(records(), { ...emptyRecords(), reviewSessions: [invalid] }), errorCode('INVALID_REVIEW'));
  }
});
test('historical coverage cannot automatically complete a new review session', () => {
  const done = completedBefore(7), session = createReviewSession(7, corpus, done, t1);
  const started = mergeRecords(done, records({ reviewSessions: [session] }));
  const day = getProgress(corpus, started).days.find(d => d.day === 7);
  assert.equal(day.total, 16); assert.equal(day.covered, 0); assert.equal(day.completed, false);
  const oneReviewed = mergeRecords(started, records({ events: [event('review-now', 'reviewed', session.questionIds[0], 7, t2)] }));
  assert.equal(getProgress(corpus, oneReviewed).days.find(d => d.day === 7).covered, 1);
  const written = mergeRecords(started, records({ entries: [entry('review-written', { practiceDate: corpus.days.find(d => d.day === 7).date, questionId: session.questionIds[0] })] }));
  assert.equal(getProgress(corpus, written).days.find(d => d.day === 7).covered, 0);
});
test('empty read-aloud teaching summaries cannot mark a question as read aloud', () => {
  const summary = records({ entries: [entry('summary', { mode: 'read-aloud', transcript: '', source: 'dot', feedback: 'Assistant coaching only', practiceDate: corpus.days[0].date })] });
  const progress = getProgress(corpus, summary);
  assert.equal(progress.readAloud, 0); assert.equal(progress.covered, 0); assert.equal(progress.days[0].readAloud, 0);
});
test('merged revisions cannot point to missing original records', () => {
  assert.throws(() => importRecords({ entries: [entry('missing-base', { revisionOf: 'not-in-any-file' })] }, corpus), errorCode('INVALID_REVISION'));
});
test('new lessons keep fixed plans and cannot create review snapshots', () => {
  assert.deepEqual(tasksForDay(1, corpus, records()).questionIds, corpus.days[0].questionIds);
  assert.throws(() => createReviewSession(1, corpus, records()), errorCode('INVALID_REVIEW'));
});
test('local save merges latest tab changes instead of replacing them', () => {
  const storage = new Storage(); saveRecords(storage, records({ events: [event('tab-a')] }), corpus);
  const saved = saveRecords(storage, records({ events: [event('tab-b', 'viewed')] }), corpus);
  assert.equal(saved.events.length, 2); assert.deepEqual(loadRecords(storage, corpus), saved);
});
test('local storage quota and read-back failures never report saved success', () => {
  for (const field of ['failWrite', 'silentlyFail']) {
    const storage = new Storage(); storage[field] = true;
    assert.throws(() => saveRecords(storage, records({ events: [event()] }), corpus), errorCode('STORAGE_WRITE'));
  }
});
test('corrupt or inaccessible storage is preserved and cannot be overwritten by save', () => {
  const storage = new Storage(); storage.values.set(STORAGE_KEY, '{corrupt');
  assert.throws(() => saveRecords(storage, records(), corpus), errorCode('INVALID_JSON'));
  assert.equal(storage.values.get(STORAGE_KEY), '{corrupt');
  storage.failRead = true; assert.throws(() => loadRecords(storage, corpus), errorCode('STORAGE_READ'));
});
test('unpublished counts detect all record categories and published conflicts', () => {
  const published = records({ events: [event('published')] });
  const local = mergeRecords(published, records({ events: [event('local', 'viewed')], entries: [entry()], reviewSessions: [createReviewSession(7, corpus, published, t1)] }));
  assert.deepEqual(pendingRecordCounts(local, published), { events: 1, entries: 1, reviewSessions: 1, total: 3 });
  assert.throws(() => pendingRecordCounts(records({ events: [event('published', 'viewed')] }), published), errorCode('ID_CONFLICT'));
});
test('exports round-trip original answers, corrections, dates, events and snapshots', () => {
  const original = records({ events: [event()], entries: [entry('complete', { feedback: '待核实发音', revisedEnglish: 'I usually read on the train.', revisedChinese: '我通常在火车上看书。' })], reviewSessions: [createReviewSession(7, corpus, records(), t1)] });
  assert.deepEqual(normalizeRecords(exportRecords(original, corpus), corpus), original);
});
