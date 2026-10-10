/** Shared browser/Node data rules. Imports and merges are atomic and append-only. */
export const REPOSITORY = 'ielts-speaking-daily/ielts-speaking-daily.github.io';
export const STORAGE_KEY = 'ielts-speaking-daily.records.v1';
export const LIMITS = Object.freeze({ bytes: 10 * 1024 * 1024, events: 30000, entries: 5000, reviewSessions: 300, text: 50000 });
export const EVENT_TYPES = Object.freeze(['viewed', 'spoken', 'reviewed', 'needs-review', 'candidate-confirmed', 'read-aloud']);
const context = new WeakMap();
const corpusContext = new WeakMap();
const QB = /^QB-\d{8}-\d{2}-P[123]-\d{3}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
const encoder = new TextEncoder();

export class DataError extends Error {
  constructor(code, message, path = '') { super(path ? `${message}（${path}）` : message); this.name = 'DataError'; this.code = code; this.path = path; }
}
function fail(code, message, path) { throw new DataError(code, message, path); }
function plain(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_OBJECT', '必须是普通 JSON 对象', path);
}
function inspect(value, path = '$', depth = 0, seen = new WeakSet(), count = { n: 0 }) {
  if (++count.n > 300000 || depth > 24) fail('TOO_LARGE', '数据过大或嵌套过深', path);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') { if (value.length > LIMITS.bytes) fail('TOO_LARGE', '文本过大', path); return; }
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('INVALID_JSON', '数字必须有限', path); return; }
  if (typeof value !== 'object') fail('INVALID_JSON', '仅接受 JSON 数据', path);
  if (seen.has(value)) fail('INVALID_JSON', '不接受循环或共享对象引用', path);
  seen.add(value);
  if (!Array.isArray(value)) plain(value, path);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || unsafeKeys.has(key)) fail('UNSAFE_KEY', '不接受原型修改字段', `${path}.${String(key)}`);
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) fail('INVALID_JSON', '不接受 getter/setter', `${path}.${key}`);
    inspect(descriptor.value, `${path}.${key}`, depth + 1, seen, count);
  }
  seen.delete(value);
}
function parsed(input) {
  let value = input;
  if (typeof input === 'string') {
    if (encoder.encode(input).length > LIMITS.bytes) fail('TOO_LARGE', 'JSON 超过 10 MB，未导入');
    try { value = JSON.parse(input.replace(/^\uFEFF/, '')); } catch { fail('INVALID_JSON', 'JSON 格式无效，原有记录未改变'); }
  }
  inspect(value);
  if (encoder.encode(JSON.stringify(value)).length > LIMITS.bytes) fail('TOO_LARGE', 'JSON 超过 10 MB，未导入');
  return value;
}
function fields(value, allowed, path) {
  plain(value, path);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail('UNKNOWN_FIELD', `未知字段 ${key}，为避免丢失内容拒绝导入`, path);
}
function str(value, path, max = LIMITS.text, empty = true) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail('INVALID_FIELD', `文本字段无效或超过 ${max} 字符`, path);
  return value;
}
function ident(value, path) { str(value, path, 120, false); if (!ID.test(value)) fail('INVALID_ID', '记录 ID 无效', path); return value; }
function dateString(value, path) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('INVALID_DATE', '日期必须为 YYYY-MM-DD', path);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) fail('INVALID_DATE', '日期不存在', path);
  return value;
}
function iso(value, path) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) fail('INVALID_DATE', '时间必须为含时区的 ISO 时间', path);
  dateString(value.slice(0, 10), path);
  const match = value.match(/T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/);
  if (+match[1] > 23 || +match[2] > 59 || +match[3] > 59 || (match[4] !== 'Z' && (+match[5] > 23 || +match[6] > 59)) || !Number.isFinite(Date.parse(value))) fail('INVALID_DATE', '时间无效', path);
  return value;
}
function dayNumber(value, path) { if (!Number.isInteger(value) || value < 1 || value > 30) fail('INVALID_DAY', '学习日必须为 1–30', path); return value; }
function knownIds(questions) {
  if (!questions) return null;
  if (questions instanceof Set) return new Set(questions);
  const list = Array.isArray(questions) ? questions : questions.questions;
  if (!Array.isArray(list)) fail('INVALID_CORPUS', '需要题库或题目数组');
  return new Set(list.map(q => typeof q === 'string' ? q : q.id));
}
function questionId(value, known, path) {
  if (typeof value !== 'string' || !QB.test(value)) fail('UNKNOWN_QUESTION', '题号格式无效', path);
  if (!known) fail('CORPUS_REQUIRED', '含练习数据的校验需要题库', path);
  if (!known.has(value)) fail('UNKNOWN_QUESTION', `题库中不存在 ${value}`, path);
  return value;
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function union(items, kind) {
  const map = new Map();
  for (const item of items) {
    const old = map.get(item.id);
    if (old && stable(old) !== stable(item)) fail('ID_CONFLICT', `同一 ${kind} ID 内容不同；未覆盖任何版本`, item.id);
    if (!old) map.set(item.id, item);
  }
  return [...map.values()].sort((a, b) => String(a.createdAt ?? a.occurredAt ?? '').localeCompare(String(b.createdAt ?? b.occurredAt ?? '')) || a.id.localeCompare(b.id));
}

export function emptyRecords() {
  return { schemaVersion: 1, repository: REPOSITORY, updatedAt: null, events: [], entries: [], reviewSessions: [] };
}
function eventRecord(value, known, path) {
  fields(value, ['id', 'questionId', 'type', 'occurredAt', 'day', 'answerVersion', 'version', 'status'], path);
  const event = { id: ident(value.id, `${path}.id`), questionId: questionId(value.questionId, known, `${path}.questionId`), type: value.type, occurredAt: iso(value.occurredAt, `${path}.occurredAt`), day: dayNumber(value.day, `${path}.day`) };
  if (!EVENT_TYPES.includes(event.type)) fail('UNKNOWN_EVENT_TYPE', '未知练习事件类型', `${path}.type`);
  if (value.answerVersion !== undefined && value.version !== undefined && value.answerVersion !== value.version) fail('INVALID_FIELD', 'answerVersion 与 version 不一致', path);
  event.answerVersion = str(value.answerVersion ?? value.version, `${path}.answerVersion`, 80, false);
  if (value.status !== undefined) event.status = str(value.status, `${path}.status`, 80, false);
  return event;
}
function entryRecord(value, known, path) {
  fields(value, ['id', 'questionId', 'mode', 'practiceDate', 'createdAt', 'source', 'transcript', 'feedback', 'revisedEnglish', 'revisedChinese', 'revisionOf'], path);
  const entry = { id: ident(value.id, `${path}.id`), questionId: questionId(value.questionId, known, `${path}.questionId`), mode: value.mode, practiceDate: value.practiceDate === null || value.practiceDate === '' || value.practiceDate === undefined ? null : dateString(value.practiceDate, `${path}.practiceDate`), createdAt: iso(value.createdAt, `${path}.createdAt`), source: value.source };
  if (!['read-aloud', 'free-answer'].includes(entry.mode)) fail('INVALID_MODE', '回答模式必须为朗读或自主作答', `${path}.mode`);
  if (!['manual', 'dot'].includes(entry.source)) fail('INVALID_SOURCE', '记录来源必须为 manual 或 dot', `${path}.source`);
  for (const key of ['transcript', 'feedback', 'revisedEnglish', 'revisedChinese']) entry[key] = str(value[key], `${path}.${key}`);
  if (value.revisionOf !== undefined) entry.revisionOf = ident(value.revisionOf, `${path}.revisionOf`);
  return entry;
}
function sessionRecord(value, known, path) {
  fields(value, ['id', 'day', 'createdAt', 'questionIds', 'reason', 'sourceDay'], path);
  const session = { id: ident(value.id, `${path}.id`), day: dayNumber(value.day, `${path}.day`), createdAt: iso(value.createdAt, `${path}.createdAt`), questionIds: [], reason: value.reason };
  if (!['catch-up', 'sample'].includes(session.reason)) fail('INVALID_REVIEW', '复习快照原因无效', path);
  if (!Array.isArray(value.questionIds) || value.questionIds.length > 650) fail('INVALID_REVIEW', '复习快照题目数组无效', path);
  session.questionIds = value.questionIds.map((id, i) => questionId(id, known, `${path}.questionIds[${i}]`));
  if (new Set(session.questionIds).size !== session.questionIds.length) fail('INVALID_REVIEW', '复习快照中存在重复题号', path);
  if (value.sourceDay !== undefined) session.sourceDay = dayNumber(value.sourceDay, `${path}.sourceDay`);
  if (session.reason === 'catch-up' && (!session.sourceDay || session.sourceDay >= session.day)) fail('INVALID_REVIEW', '补课快照必须指向更早的学习日', path);
  return session;
}
function checkRelations(records, requirePrevious = false) {
  const entries = new Map(records.entries.map(e => [e.id, e]));
  for (const entry of records.entries) {
    if (!entry.revisionOf) continue;
    const previous = entries.get(entry.revisionOf);
    if (!previous) { if (requirePrevious) fail('INVALID_REVISION', '找不到修订引用的旧版；请同时导入原答', entry.id); continue; } // An incremental import may refer to a version in the base set.
    if (previous.questionId !== entry.questionId || previous.id === entry.id) fail('INVALID_REVISION', '修订必须关联同题的旧版', entry.id);
    const seen = new Set([entry.id]);
    let cursor = previous;
    while (cursor) {
      if (seen.has(cursor.id)) fail('INVALID_REVISION', '修订关联存在循环', entry.id);
      seen.add(cursor.id); cursor = entries.get(cursor.revisionOf);
    }
  }
  const days = new Map();
  for (const session of records.reviewSessions) {
    if (days.has(session.day) && stable(days.get(session.day)) !== stable(session)) fail('REVIEW_CONFLICT', '同一天存在不同复习快照，请保留两个文件并人工核对', `day ${session.day}`);
    days.set(session.day, session);
  }
}
function checkSessions(records, corpus) {
  if (!corpus || !Array.isArray(corpus.days) || !Array.isArray(corpus.questions)) return;
  const questions = new Map(corpus.questions.map(q => [q.id, q]));
  for (const session of records.reviewSessions) {
    const review = corpus.days.find(d => d.day === session.day);
    if (!review || review.kind !== 'review') fail('INVALID_REVIEW', '快照必须对应计划中的复习日', session.id);
    const previous = corpus.days.filter(d => d.day < session.day && d.kind === 'new');
    const eligible = new Set(previous.flatMap(d => d.questionIds));
    if (session.questionIds.some(id => !eligible.has(id) || questions.get(id)?.region !== '大陆')) fail('INVALID_REVIEW', '快照包含未来课或非大陆题目', session.id);
    if (session.reason === 'catch-up') {
      const source = previous.find(d => d.day === session.sourceDay);
      if (!source || stable(source.questionIds) !== stable(session.questionIds)) fail('INVALID_REVIEW', '补课快照必须保留原学习日完整题目', session.id);
    } else {
      if (session.sourceDay !== undefined) fail('INVALID_REVIEW', '抽题复习快照不能有补课来源日', session.id);
      for (const [part, count] of [[1, 4], [2, 2], [3, 10]]) {
        const available = [...eligible].filter(id => questions.get(id).part === part).length;
        if (session.questionIds.filter(id => questions.get(id).part === part).length !== Math.min(count, available)) fail('INVALID_REVIEW', '抽题快照必须遵守 4/2/10 数量', session.id);
      }
    }
  }
}
export function normalizeRecords(input, questions) {
  const value = parsed(input);
  fields(value, ['schemaVersion', 'repository', 'updatedAt', 'events', 'entries', 'reviewSessions', 'pendingLocalEvents', 'exportedAt', 'user', 'source', 'reminder'], '$');
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) fail('INVALID_SCHEMA', '不支持该 records schemaVersion');
  if (value.repository !== undefined && value.repository !== REPOSITORY) fail('WRONG_REPOSITORY', '记录所属仓库不匹配');
  const known = knownIds(questions);
  const result = emptyRecords();
  result.updatedAt = value.updatedAt == null ? null : iso(value.updatedAt, '$.updatedAt');
  for (const [key, max] of [['events', LIMITS.events], ['pendingLocalEvents', LIMITS.events], ['entries', LIMITS.entries], ['reviewSessions', LIMITS.reviewSessions]]) {
    if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].length > max)) fail('TOO_LARGE', `${key} 必须为数组且不超过 ${max} 条`, `$.${key}`);
  }
  const events = [...(value.events ?? []), ...(value.pendingLocalEvents ?? [])];
  if (events.length > LIMITS.events) fail('TOO_LARGE', '事件数量超过限制');
  result.events = union(events.map((e, i) => eventRecord(e, known, `$.events[${i}]`)), 'event');
  result.entries = union((value.entries ?? []).map((e, i) => entryRecord(e, known, `$.entries[${i}]`)), 'entry');
  result.reviewSessions = union((value.reviewSessions ?? []).map((s, i) => sessionRecord(s, known, `$.reviewSessions[${i}]`)), 'reviewSession');
  checkRelations(result);
  checkSessions(result, questions);
  context.set(result, known);
  if (questions && Array.isArray(questions.days)) corpusContext.set(result, questions);
  return result;
}
export function mergeRecords(...sets) {
  if (!sets.length) return emptyRecords();
  const known = sets.map(set => context.get(set)).find(Boolean) ?? null;
  const corpus = sets.map(set => corpusContext.get(set)).find(Boolean) ?? null;
  const normalized = sets.map(set => normalizeRecords(set, corpus ?? known));
  const result = emptyRecords();
  for (const key of ['events', 'entries', 'reviewSessions']) result[key] = union(normalized.flatMap(set => set[key]), key);
  const times = normalized.map(set => set.updatedAt).filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b));
  result.updatedAt = times.at(-1) ?? null;
  checkRelations(result, true);
  if (result.events.length > LIMITS.events || result.entries.length > LIMITS.entries || result.reviewSessions.length > LIMITS.reviewSessions || encoder.encode(JSON.stringify(result)).length > LIMITS.bytes) fail('TOO_LARGE', '合并结果超过大小限制，原记录未改变');
  context.set(result, known);
  if (corpus) corpusContext.set(result, corpus);
  return result;
}
export function importRecords(input, corpus, base = emptyRecords()) { return mergeRecords(normalizeRecords(base, corpus), normalizeRecords(input, corpus)); }
export function exportRecords(records, corpus) { return JSON.stringify(normalizeRecords(records, corpus), null, 2); }

export function validateCorpus(input) {
  const corpus = parsed(input); plain(corpus, '$');
  if (!Array.isArray(corpus.questions) || !corpus.questions.length || corpus.questions.length > 1000 || !Array.isArray(corpus.days) || !corpus.days.length || corpus.days.length > 30) fail('INVALID_CORPUS', '题库或学习计划无效');
  const ids = new Set();
  for (const q of corpus.questions) {
    plain(q, 'question');
    if (!QB.test(q.id) || ids.has(q.id) || ![1, 2, 3].includes(q.part) || !['大陆', '非大陆', '海外'].includes(q.region)) fail('INVALID_CORPUS', '题号、Part 或地区无效', q.id);
    if (!q.id.includes(`-P${q.part}-`)) fail('INVALID_CORPUS', '题号与 Part 不匹配', q.id);
    for (const key of ['title', 'text', 'english', 'chinese', 'version']) str(q[key], `${q.id}.${key}`, LIMITS.text, false);
    for (const key of ['keywords', 'pending']) if (!Array.isArray(q[key]) || q[key].some(s => typeof s !== 'string')) fail('INVALID_CORPUS', `${key} 必须为文本数组`, q.id);
    ids.add(q.id);
  }
  const planned = new Set(), dayIds = new Set(), questionMap = new Map(corpus.questions.map(q => [q.id, q]));
  for (const day of corpus.days) {
    plain(day, 'day'); dayNumber(day.day, 'day.day'); dateString(day.date, 'day.date');
    if (dayIds.has(day.day) || !['new', 'review'].includes(day.kind) || !Array.isArray(day.questionIds)) fail('INVALID_CORPUS', '学习日重复或字段无效');
    dayIds.add(day.day);
    if (day.kind === 'review' && day.questionIds.length) fail('INVALID_CORPUS', '复习日不应包含固定新题');
    for (const id of day.questionIds) {
      if (!ids.has(id) || questionMap.get(id).region !== '大陆' || planned.has(id)) fail('INVALID_CORPUS', '新题计划存在未知、海外或重复题号', id);
      planned.add(id);
    }
  }
  if (corpus.questions.some(q => q.region === '大陆' && !planned.has(q.id))) fail('INVALID_CORPUS', '计划没有覆盖全部大陆题目');
  if (corpus.meta && ((corpus.meta.total !== undefined && corpus.meta.total !== corpus.questions.length) || (corpus.meta.mainland !== undefined && corpus.meta.mainland !== planned.size))) fail('INVALID_CORPUS', '题库统计与实际数量不一致');
  return corpus;
}
export function chinaDate(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(value.valueOf())) fail('INVALID_DATE', '无法计算中国日期');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const pick = name => parts.find(p => p.type === name).value;
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}
function dayInfo(day, corpus) {
  const n = typeof day === 'object' && day ? day.day : day;
  dayNumber(n, 'day');
  const item = corpus.days.find(d => d.day === n);
  if (!item) fail('INVALID_DAY', '计划中没有该学习日');
  return item;
}
export function getQuestionStatus(question, records) {
  const events = records.events.filter(e => e.questionId === question.id).sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.id.localeCompare(b.id));
  const entries = records.entries.filter(e => e.questionId === question.id);
  const attempts = entries.filter(e => e.mode === 'free-answer' && e.transcript.trim());
  const completedEvents = events.filter(e => ['spoken', 'reviewed'].includes(e.type));
  const lastWeak = Math.max(-Infinity, ...events.filter(e => e.type === 'needs-review').map(e => Date.parse(e.occurredAt)));
  const lastComplete = Math.max(-Infinity, ...completedEvents.map(e => Date.parse(e.occurredAt)));
  const lastPractice = completedEvents.map(e => e.occurredAt).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) ?? null;
  return { viewed: events.some(e => e.type === 'viewed'), spoken: completedEvents.length > 0, reviewed: events.some(e => e.type === 'reviewed'), covered: completedEvents.length > 0, readAloud: events.some(e => e.type === 'read-aloud'), written: attempts.length > 0, needsReview: lastWeak >= lastComplete && lastWeak > -Infinity, candidateConfirmed: events.some(e => e.type === 'candidate-confirmed' && e.answerVersion === question.version), entryCount: entries.length, lastPracticedAt: lastPractice };
}
function selectReview(day, corpus, records) {
  const previous = corpus.days.filter(d => d.day < day.day && d.kind === 'new').sort((a, b) => a.day - b.day);
  const map = new Map(corpus.questions.map(q => [q.id, q]));
  const priorRecords = { ...records, events: records.events.filter(e => e.day !== day.day) };
  const statuses = new Map(corpus.questions.map(q => [q.id, getQuestionStatus(q, priorRecords)]));
  const missing = previous.find(d => d.questionIds.some(id => !statuses.get(id).covered));
  if (missing) return { questionIds: [...missing.questionIds], reason: 'catch-up', sourceDay: missing.day };
  const priorIds = previous.flatMap(d => d.questionIds), questionIds = [];
  for (const [part, count] of [[1, 4], [2, 2], [3, 10]]) {
    const candidates = priorIds.filter(id => map.get(id).part === part);
    const weak = candidates.filter(id => statuses.get(id).needsReview), other = candidates.filter(id => !statuses.get(id).needsReview);
    questionIds.push(...[...weak, ...other].slice(0, count));
  }
  return { questionIds, reason: 'sample' };
}
export function createReviewSession(day, corpus, records, now = new Date()) {
  const item = dayInfo(day, corpus);
  if (item.kind !== 'review') fail('INVALID_REVIEW', '只有复习日可以保存复习快照');
  const normalized = normalizeRecords(records, corpus);
  const existing = normalized.reviewSessions.find(s => s.day === item.day);
  if (existing) return existing;
  const timestamp = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(timestamp.valueOf())) fail('INVALID_DATE', '快照创建时间无效');
  const createdAt = timestamp.toISOString();
  // Same day has the same ID, so differing concurrent snapshots are explicit conflicts.
  return { id: `review-day-${item.day}`, day: item.day, createdAt, ...selectReview(item, corpus, normalized) };
}
export function tasksForDay(day, corpus, records) {
  const item = dayInfo(day, corpus), snapshot = records.reviewSessions.find(s => s.day === item.day) ?? null;
  const selection = item.kind === 'review' ? (snapshot ?? selectReview(item, corpus, records)) : { questionIds: [...item.questionIds], reason: 'new' };
  const map = new Map(corpus.questions.map(q => [q.id, q]));
  return { ...item, questionIds: [...selection.questionIds], questions: selection.questionIds.map(id => map.get(id)), reason: selection.reason, sourceDay: selection.sourceDay ?? null, reviewSession: snapshot, needsSnapshot: item.kind === 'review' && !snapshot };
}
export function getProgress(corpus, records) {
  const mainland = corpus.questions.filter(q => q.region === '大陆');
  const questionStatus = Object.fromEntries(corpus.questions.map(q => [q.id, getQuestionStatus(q, records)]));
  const count = key => mainland.filter(q => questionStatus[q.id][key]).length;
  const byPart = Object.fromEntries([1, 2, 3].map(part => { const list = mainland.filter(q => q.part === part); return [`p${part}`, { total: list.length, covered: list.filter(q => questionStatus[q.id].covered).length, readAloud: list.filter(q => questionStatus[q.id].readAloud).length }]; }));
  const days = corpus.days.map(day => {
    const tasks = tasksForDay(day.day, corpus, records), ids = tasks.questionIds;
    const doneToday = new Set(records.events.filter(e => e.day === day.day && ['spoken', 'reviewed'].includes(e.type)).map(e => e.questionId));
    const readToday = new Set(records.events.filter(e => e.day === day.day && e.type === 'read-aloud').map(e => e.questionId));
    const entriesToday = records.entries.filter(e => e.practiceDate === day.date);
    const covered = ids.filter(id => day.kind === 'review' ? doneToday.has(id) : questionStatus[id].covered).length;
    return { day: day.day, kind: day.kind, total: ids.length, covered, readAloud: ids.filter(id => day.kind === 'review' ? readToday.has(id) : questionStatus[id].readAloud).length, completed: ids.length > 0 && covered === ids.length, started: records.events.some(e => e.day === day.day) || entriesToday.length > 0 || Boolean(tasks.reviewSession), hasSnapshot: Boolean(tasks.reviewSession) };
  });
  const covered = count('covered');
  return { mainlandTotal: mainland.length, overseasTotal: corpus.questions.length - mainland.length, covered, coveragePercent: mainland.length ? Math.round(covered / mainland.length * 1000) / 10 : 0, viewed: count('viewed'), readAloud: count('readAloud'), needsReview: count('needsReview'), candidateConfirmed: count('candidateConfirmed'), entryCount: records.entries.length, byPart, questionStatus, days };
}
export function pendingRecordCounts(local, published) {
  const counts = {};
  for (const key of ['events', 'entries', 'reviewSessions']) {
    const existing = new Map(published[key].map(item => [item.id, item]));
    for (const item of local[key]) if (existing.has(item.id) && stable(item) !== stable(existing.get(item.id))) fail('ID_CONFLICT', '本机与已发布记录有同 ID 冲突', item.id);
    counts[key] = local[key].filter(item => !existing.has(item.id)).length;
  }
  return { ...counts, total: counts.events + counts.entries + counts.reviewSessions };
}
export function loadRecords(storage, corpus, key = STORAGE_KEY) {
  let raw;
  try { raw = storage.getItem(key); } catch { fail('STORAGE_READ', '本机存储读取失败；请保留或导出当前页面中的记录'); }
  return raw === null ? normalizeRecords(emptyRecords(), corpus) : normalizeRecords(raw, corpus);
}
export function saveRecords(storage, records, corpus, key = STORAGE_KEY) {
  const next = mergeRecords(loadRecords(storage, corpus, key), normalizeRecords(records, corpus));
  const serialized = JSON.stringify(next);
  try {
    storage.setItem(key, serialized);
    if (storage.getItem(key) !== serialized) fail('STORAGE_WRITE', '本机存储写入校验失败；本次操作尚未保存');
  } catch (error) { if (error instanceof DataError) throw error; fail('STORAGE_WRITE', '本机存储写入失败；本次操作尚未保存，请先导出记录'); }
  return next;
}
