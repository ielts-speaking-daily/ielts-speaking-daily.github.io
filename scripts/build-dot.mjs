import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = resolve(root, 'docs');
const output = resolve(docs, 'dot');
const load = async name => JSON.parse((await readFile(resolve(docs, 'data', name), 'utf8')).replace(/^\uFEFF/, ''));
const [corpus, profile, records] = await Promise.all(['corpus.json', 'profile.json', 'records.json'].map(load));
const { questions, days, meta } = corpus;
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const fmt = value => Array.isArray(value) ? value.join('；') : String(value ?? '');
const pad = n => String(n).padStart(2, '0');
assert(Array.isArray(questions) && Array.isArray(days), '题库必须含 questions 和 days');
const byId = new Map();
for (const q of questions) {
  assert(/^QB-\d{8}-\d{2}-P[123]-\d{3}$/.test(q.id), `非法题号 ${q.id}`);
  assert(!byId.has(q.id), `重复题号 ${q.id}`);
  assert([1, 2, 3].includes(q.part), `非法 Part ${q.id}`);
  for (const field of ['title', 'text', 'english', 'chinese', 'region', 'version', 'sourceIssue']) assert(typeof q[field] === 'string', `${q.id} 缺少 ${field}`);
  assert(Array.isArray(q.keywords) && Array.isArray(q.pending), `${q.id} 缺少关键词/候选标识`);
  byId.set(q.id, q);
}
const mainland = questions.filter(q => q.region === '大陆');
const overseas = questions.filter(q => q.region !== '大陆');
assert(questions.length === meta.total && mainland.length === meta.mainland && overseas.length === meta.overseas, '元数据数量与题库不一致');
assert(days.length === 30 && new Set(days.map(d => d.day)).size === 30 && days.every(d => Number.isInteger(d.day) && d.day >= 1 && d.day <= 30), '日程必须含唯一的 Day 01–30');
const assigned = days.filter(d => d.kind === 'new').flatMap(d => d.questionIds);
assert(new Set(assigned).size === assigned.length, '首轮新题重复分配');
assert(assigned.length === mainland.length && assigned.every(id => byId.get(id)?.region === '大陆'), '新题日必须恰好覆盖大陆题');
assert(mainland.every(q => assigned.includes(q.id)), '首轮缺少大陆题');
assert(records.schemaVersion === 1 && ['events', 'entries', 'reviewSessions'].every(k => Array.isArray(records[k])), 'records.json 格式不匹配');
for (const d of days) for (const id of d.questionIds) assert(byId.has(id), `Day ${d.day} 未知题号 ${id}`);
await mkdir(output, { recursive: true });

const styles = `:root{color-scheme:light;--ink:#143e36;--muted:#52655e;--line:#d7e1d8;--paper:#faf9f3;--accent:#ad531b}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.75 system-ui,-apple-system,"Segoe UI",sans-serif}main,header,footer{max-width:960px;margin:auto;padding:24px}header{padding-bottom:0}a{color:#145c4c;text-underline-offset:3px}a:hover{color:var(--accent)}h1{font-size:clamp(1.8rem,5vw,2.7rem);line-height:1.25}h2{line-height:1.4}nav{display:flex;gap:10px 20px;flex-wrap:wrap}.lead{font-size:1.1rem}.note,.warning{padding:14px 18px;border-left:4px solid #90b4a0;background:#eaf1e9}.warning{border-color:#b76737;background:#fff0dc}.muted,.meta{color:var(--muted);font-size:.92rem}.question{border:1px solid var(--line);border-radius:14px;background:#fff;padding:24px;margin:24px 0;scroll-margin-top:20px}.question h2{font-size:1.35rem;margin:8px 0 16px}.source,.answer,.verbatim,pre{white-space:pre-wrap;overflow-wrap:anywhere}.source{font-size:1.07rem}.tag{display:inline-block;padding:2px 9px;background:#edf3eb;border-radius:20px;margin-right:6px;font-size:.8rem}.pending{color:#7d430f}.toc,.days{padding:0;list-style:none}.days{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:12px}.days li{border:1px solid var(--line);border-radius:10px;background:#fff;padding:14px}.toc li{margin:8px 0}.question h3{font-size:1rem;margin-bottom:5px}blockquote{margin-left:0;padding:14px 18px;background:#eaf1e9}code{font-size:.88em;overflow-wrap:anywhere}pre{padding:18px;border:1px solid var(--line);border-radius:10px;font-size:.88rem}dt{font-weight:700}dd{margin:0 0 14px}footer{border-top:1px solid var(--line);font-size:.88rem}.daynav{justify-content:space-between;margin:25px 0}table{border-collapse:collapse;width:100%}th,td{padding:10px;text-align:left;border:1px solid var(--line)}@media(max-width:550px){main,header,footer{padding:18px}.question{padding:17px}body{font-size:16px}.days{grid-template-columns:1fr}}@media print{body{background:white;font-size:11pt}nav,.daynav{display:none}.question{break-inside:avoid}a{color:inherit}}`;
const nav = `<nav aria-label="阅读入口"><a href="../index.html">练习网站</a><a href="index.html">dot 总入口</a><a href="overseas.html">海外补充</a><a href="../dot-instructions.md">dot 使用说明</a><a href="../data/records.json">已发布文字记录 JSON</a></nav>`;
function page(title, body, description = '公开的 IELTS 中英口语题库，供用户和 dot 静态读取。') {
  return `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><link rel="icon" href="../assets/icon.svg" type="image/svg+xml"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${esc(description)}"><title>${esc(title)} · 每日口语</title><style>${styles}</style></head><body><header>${nav}<p class="meta">无需 JavaScript · 公开资料 · 录音保留在本机</p></header><main><h1>${esc(title)}</h1>${body}</main><footer>参考答案是备考素材，不是用户实际作答。候选经历保持待确认。文字记录须提交到 GitHub 并发布后才对 dot 可见；本页面不能自动写回 GitHub。<br>资料：<a href="../data/corpus.json">完整题库 JSON</a> · <a href="../data/profile.json">已确认背景 JSON</a> · <a href="../data/records.json">公开记录 JSON</a></footer></body></html>\n`;
}
const write = async (name, content) => writeFile(resolve(output, name), content, 'utf8');
const json = value => JSON.stringify(value, null, 2) + '\n';
const questionLink = q => `part-${q.part}.html#${encodeURIComponent(q.id)}`;
function question(q) {
  return `<article class="question" id="${esc(q.id)}" data-question-id="${esc(q.id)}"><p class="meta"><span class="tag">Part ${q.part}</span><span class="tag">${esc(q.region)}</span><code>${esc(q.id)}</code> · ${esc(q.version)}</p><h2>${esc(q.title)}</h2>${q.sourceIssue ? `<p class="warning"><strong>源文待核：</strong>${esc(q.sourceIssue)}。下方候选稿不能冒充已核实题目的正式模拟回答。</p>` : ''}<h3>原题与完整提示</h3><div class="source" lang="en">${esc(q.text)}</div><h3>英文参考答案（非用户原答）</h3><div class="answer" lang="en">${esc(q.english)}</div><h3>中文对照</h3><div class="answer">${esc(q.chinese)}</div><h3>关键词</h3><p>${q.keywords.map(esc).join(' · ') || '未提供'}</p><h3>待确认素材与观点</h3>${q.pending.length ? `<ul class="pending">${q.pending.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : '<p class="muted">本条数据未列待确认项；仍不可把参考稿当作用户口述。</p>'}<p class="meta"><a href="${esc(questionLink(q))}">本题固定阅读链接</a></p></article>`;
}
function indexLinks(qs) {
  return `<ul class="toc">${qs.map(q => `<li><a href="${esc(questionLink(q))}">${esc(q.id)} · ${esc(q.title)}</a>${q.sourceIssue ? ' <strong class="pending">源文待核</strong>' : ''}</li>`).join('')}</ul>`;
}
function profileBlock() {
  return `<section><h2>已确认个人背景</h2><p>${esc(profile.personality)}。目标：${esc(profile.target)}。</p><dl>${Object.entries(profile.facts).map(([key, value]) => `<dt>${esc(({ identity: '身份', hometown: '家乡', home: '现居', interests: '兴趣', supervisor: '导师', travel: '旅行', future: '未来计划' })[key] || key)}</dt><dd>${esc(fmt(value))}</dd>`).join('')}</dl><h3>使用边界</h3><ul>${profile.boundaries.map(v => `<li>${esc(v)}</li>`).join('')}</ul></section>`;
}
const dayName = d => `day-${pad(d.day)}.html`;
const dailyCards = `<ol class="days">${days.map(d => `<li><a href="${dayName(d)}"><strong>Day ${pad(d.day)} · ${esc(d.date)}</strong></a><br>${d.kind === 'review' ? '复习日 · 根据真实记录选题' : `${d.questionIds.length} 题 · P1 ${d.counts.p1} / P2 ${d.counts.p2} / P3 ${d.counts.p3}`}<br><span class="muted">预算 ${esc(d.minutes)} 分钟</span></li>`).join('')}</ol>`;
const issueQuestions = questions.filter(q => q.sourceIssue);
const indexBody = `<p class="lead">这里是 dot 和其他阅读工具可以直接访问的静态题库。大陆 ${mainland.length} 题、海外 ${overseas.length} 题，共 ${questions.length} 条中英参考答案；每一道原题、Part 2 提示及待确认标记均保留。</p><div class="warning"><strong>公开模式：</strong>任何人都能阅读本站题库、个人背景及已发布文字记录。录音不上传本站。写回权限由 GitHub 仓库权限决定，访客不能修改公开记录。</div><section><h2>开始一次通话练习</h2><blockquote>请先读取这个静态入口、已确认个人背景和最新 published records.json，再带我练第 ___ 天，模式为“朗读参考答案”或“自主回答”。逐题进行；自主回答先不展示参考稿。结束时给重点反馈与可合并的记录 JSON。没有原始转写就不要编造我的原话；没有可验证的音频证据就不给发音评分。</blockquote><p>在 dot 中粘贴本站地址及上面的提示，选择实际要练的 Day。本站不提供已连接 dot 的保证；通话音频和转写能否取得，以实际能力为准。</p><p><a href="../dot-instructions.md">完整开练与保存说明</a> · <a href="index.json">机器可读导航</a> · <a href="../data/records.json">每次开练重新读取公开记录</a></p><p class="note">浏览器里的新增进度和文字记录先保存在本机。只有导出、合并并提交 <code>docs/data/records.json</code>，且 GitHub Pages 发布完成后，dot 才能读到公网新版本。</p></section><section><h2>30 天日程</h2><p>首轮 ${esc(meta.startDate)} 至 ${esc(meta.endDate)}，时区 ${esc(meta.timezone)}。日期保留原计划，不因为打开网页而自动重排。复习日不预填未发生的练习。</p>${dailyCards}</section><section><h2>完整题库与海外补充</h2><ul>${[1, 2, 3].map(part => `<li><a href="part-${part}.html">Part ${part} 全部 ${questions.filter(q => q.part === part).length} 题</a>（含大陆和海外，逐题标注地区）</li>`).join('')}<li><a href="overseas.html">海外 ${overseas.length} 题独立入口</a></li></ul></section><section><h2>源文待核</h2>${indexLinks(issueQuestions)}</section>${profileBlock()}<section><h2>已发布记录与诚实反馈</h2><p>以 <a href="../data/records.json">records.json</a> 的当前版本为准，不从参考答案推断用户练过，不把 <code>viewed</code> 当成已开口。原口述、助手反馈及修订稿分别保存；助手建议不自动改变已确认人设。朗读不能证明用户独立的词汇语法能力，单题不能生成整场 IELTS Band。</p><p>纯静态网站不提供云推送。每日中国时间 20:00 提醒通过用户主动导入的 ICS 日历设置；提醒是否弹出取决于日历及系统通知设置。</p></section>`;
await write('index.html', page('dot 口语练习阅读入口', indexBody));
await write('index.json', json({ schemaVersion: 1, purpose: 'Static public reading index; no automatic dot connection or write-back.', data: { corpus: '../data/corpus.json', profile: '../data/profile.json', records: '../data/records.json' }, counts: { mainland: mainland.length, overseas: overseas.length, total: questions.length }, startDate: meta.startDate, endDate: meta.endDate, timezone: meta.timezone, days: days.map(d => ({ day: d.day, date: d.date, kind: d.kind, html: dayName(d), json: `day-${pad(d.day)}.json`, questionIds: d.questionIds })), parts: [1, 2, 3].map(part => ({ part, html: `part-${part}.html`, count: questions.filter(q => q.part === part).length })), overseas: 'overseas.html', sourceIssueIds: issueQuestions.map(q => q.id) }));
for (const d of days) {
  const qs = d.questionIds.map(id => byId.get(id));
  const previous = days.filter(other => other.day < d.day && other.kind === 'new');
  const dayNav = `<nav class="daynav">${d.day > 1 ? `<a href="day-${pad(d.day - 1)}.html">← 前一天</a>` : '<span></span>'}<a href="index.html">30 天目录</a>${d.day < 30 ? `<a href="day-${pad(d.day + 1)}.html">后一天 →</a>` : '<span></span>'}</nav>`;
  const review = `<div class="note"><strong>这是复习日，没有固定新题。</strong>先读最新公开记录，优先找较早欠课及 <code>needs-review</code> 项，再询问用户本机是否有尚未发布的新练习。根据真实记录选择本次题目并保存 <code>reviewSessions</code> 快照；不要把未发布误判成未学习。</div><h2>可以回看的既往新题日</h2><ul>${previous.map(p => `<li><a href="${dayName(p)}">Day ${pad(p.day)} · ${esc(p.date)} · ${p.questionIds.length} 题（含完整原题和参考稿）</a></li>`).join('')}</ul><p>没有足够记录时，可与用户约定抽取旧题；“候选复习题”不能预先登记成已练习。</p>`;
  const body = `<p class="lead">${esc(d.date)} · ${d.kind === 'review' ? '复习日' : '新题日'} · 预算 ${esc(d.minutes)} 分钟 · ${esc(meta.timezone)}</p><p>${esc(d.notes)}</p><p><a href="day-${pad(d.day)}.json">本日完整 JSON</a> · <a href="../data/records.json">最新公开记录</a> · <a href="../data/profile.json">已确认背景</a></p><p class="note">自主回答时先只读原题，等用户回答后再取参考稿辅助反馈。候选故事不代表真实经历；所有题都可练两种模式。</p>${dayNav}${d.kind === 'review' ? review : `<h2>今日 ${qs.length} 题</h2><ul class="toc">${qs.map(q => `<li><a href="#${esc(q.id)}">Part ${q.part} · ${esc(q.title)} · ${esc(q.id)}</a></li>`).join('')}</ul>${qs.map(question).join('')}`}${dayNav}`;
  await write(dayName(d), page(`Day ${pad(d.day)} · ${d.kind === 'review' ? '复习与补课' : '口语练习'}`, body));
  await write(`day-${pad(d.day)}.json`, json({ schemaVersion: 1, ...d, timezone: meta.timezone, recordsUrl: '../data/records.json', profileUrl: '../data/profile.json', selection: d.kind === 'review' ? 'Select from actual published records and user-confirmed unpublished work; no preassigned new questions.' : 'Fixed mainland first-pass questions.', questions: qs }));
}
for (const part of [1, 2, 3]) {
  const qs = questions.filter(q => q.part === part);
  const body = `<p class="lead">共 ${qs.length} 题：大陆 ${qs.filter(q => q.region === '大陆').length} 题，海外 ${qs.filter(q => q.region !== '大陆').length} 题。</p><p>每条按原数据保留完整原题、英文参考、中文对照及候选标记。参考稿不等于用户原答。</p><ul class="toc">${qs.map(q => `<li><a href="#${esc(q.id)}">${esc(q.id)} · ${esc(q.region)} · ${esc(q.title)}</a></li>`).join('')}</ul>${qs.map(question).join('')}`;
  await write(`part-${part}.html`, page(`Part ${part} 完整题库`, body));
}
await write('overseas.html', page('海外补充题库', `<p class="lead">${overseas.length} 题，独立于大陆 ${mainland.length} 题首轮完成率。无需 JavaScript 即可读取全部问题及参考答案。</p>${indexLinks(overseas)}${overseas.map(question).join('')}`));
console.log(`Generated dot static pages: ${questions.length} unique questions (${mainland.length} mainland + ${overseas.length} overseas); 30 days; ${issueQuestions.length} source issue(s).`);
console.log(`Records schema checked: ${records.events.length} events, ${records.entries.length} entries, ${records.reviewSessions.length} review sessions. Records are linked live and not copied into generated HTML.`);
