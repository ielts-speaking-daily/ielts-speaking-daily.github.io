# 用 dot 进行每日口语练习

网站负责保存题库和已发布的文字记录，用户在 dot 中通话练习。这里描述资料读取及记录格式，不表示 dot 或 GitHub 插件已经连接。网站是公开静态资料；任何人可读，只有获得 GitHub 仓库写权限的工具或用户能提交更新。

## 资料入口

发布后根地址：`https://ielts-speaking-daily.github.io/`（是否已发布以 GitHub Pages 状态为准）。

- [无需 JavaScript 的完整入口](dot/index.html)：30 天逐日链接、已确认人设、三 Part 全部 650 题。
- [原始题库及日程](data/corpus.json)：大陆 577、海外 73；保留稳定题号、完整原题、Part 2 全部提示、中英参考、候选标记及源文问题。
- [个人背景](data/profile.json)：唯一已确认人设来源；题库候选稿不会自动扩充事实。
- [最新已发布文字记录](data/records.json)：每次开练重新读取，不能以旧摘要代替当前版本。
- [海外补充](dot/overseas.html)：不计入大陆首轮完成率。

静态页参考答案全部可读。自主回答时 dot 只向用户说原题，等回答后再使用参考稿，不应把网页同时存在参考稿误当成用户已经看稿。

## 可直接复制的开练提示

> 请读取 https://ielts-speaking-daily.github.io/dot/ ，并重新读取 data/profile.json 和 data/records.json。带我练第 ___ 天，今天选择【朗读参考答案 / 自主回答】。先确认我的本机是否有尚未发布的练习，避免把它们误判为欠课。保持安静、理性、自然的语气，逐题进行。自主回答先只说原题，Part 2 保留所有提示并给一分钟准备；读稿模式使用本题的固定参考稿。每题结束只挑最值得改的 1–3 点，先让我试着改，再给忠于原意的英文示范及中文说明。没有取得我的原始逐字回答就不要编造转写；没有可验证音频证据就不做发音评分。结束时按网站的 records.json 格式生成可合并增量；没有 GitHub 写权限就交给我导出提交，有我明确授权的 GitHub 工具时先读取最新文件再追加，保留旧版。只生成 JSON 不代表已保存到网站。

补充某题时可说：“继续练 `QB-20261008-01-P2-001`，先读该题原题与 pending 标记，保留我的本意，帮我把独立回答讲清楚。”

## 两种模式与证据边界

| 模式 | dot 可以做的教学 | 不能由此推断 |
|---|---|---|
| `read-aloud` 朗读参考稿 | 分句、意群、可观察表达问题、示范及复读；只在真实音频能力经过验证时给有依据的声音反馈 | 不能把稿子的 LR/GRA 当作用户独立能力，不生成整场 Band |
| `free-answer` 自主回答 | 切题、展开、衔接、词汇语法、忠于原意的改稿及追问 | 参考稿不是唯一正确答案；文字不能证明实际发音或流利度 |

第一版不配置自动发音评分引擎。dot 能通话不代表具有已验证的 IELTS 发音测评能力。不能凭转写是否准确判发音对错，不捏造音素分数、时间戳或声学证据。单题只作局部反馈，助手反馈不冒充官方成绩。网页录音保留本机，dot 通话原音能否取得并未在本项目中保证；不要把音频编码、录音链接或私密音频放进公开 JSON。

如果通话逐字转写不可取得，`transcript` 设为空字符串；`feedback` 开头明确“未取得原始逐字转写；以下为 dot 辅导总结”。总结不能改名为用户原话。有实际转写时应标明来源和核验情况；没有用户核验时不能把不确定识别当作错误依据。用户主动改写的内容放 `revisedEnglish` / `revisedChinese`，不能回填原始 `transcript`。

待确认故事仍待确认。只有用户明确确认全部相关候选细节时，才能追加该题 `candidate-confirmed` 事件；部分确认在反馈里逐项说明，不整体转成已确认事实。`QB-20261008-01-P3-055` 原文待核，不能自行补造问句后称为原题。

## records.json 格式

顶层结构固定如下。三个数组中的对象都使用唯一 ID；建议 UUID。时间是实际 UTC ISO 字符串。示例块是格式演示，不能直接发布成真实练习。

```json
{
  "schemaVersion": 1,
  "repository": "ielts-speaking-daily/ielts-speaking-daily.github.io",
  "updatedAt": null,
  "events": [],
  "entries": [],
  "reviewSessions": []
}
```

### entries：用户原答、辅导与修订

每次作答、辅导或后续修改新增一个对象。以下是待填模板，不是发生过的练习；其中占位 ID / 时间必须在真实保存时替换。

```json
{
  "id": "REPLACE-WITH-NEW-UUID",
  "questionId": "QB-20261008-01-P2-001",
  "mode": "free-answer",
  "practiceDate": null,
  "createdAt": "REPLACE-WITH-ACTUAL-UTC-ISO-TIME",
  "source": "dot",
  "transcript": "",
  "feedback": "未取得原始逐字转写；以下为 dot 辅导总结：在此保存实际提供的辅导，不编造用户原话或音频评分。",
  "revisedEnglish": "",
  "revisedChinese": ""
}
```

- `mode` 只能是 `read-aloud` 或 `free-answer`；网页手工记录的 `source` 是 `manual`，dot 辅导是 `dot`。
- `practiceDate` 是用户实际练习日期 `YYYY-MM-DD`，未知则 `null`。不能从 `createdAt` 或原定日程日期推断实际练习日期。
- `transcript` 仅放实际取得的用户原话，识别疑点及核验状态在 `feedback` 明示；没有原话时留空。仅助手建议不得冒充用户作答。
- `feedback` 保存中文教学反馈及证据范围；`revisedEnglish`、`revisedChinese` 分别保存助手修订和忠实对照，未生成则为空。
- 后续纠正不覆盖旧 entry，创建新 ID，并添加 `revisionOf` 指向原 entry ID。同题新的独立回答可以新建 entry，不必伪装成原答修改。

### events：实际状态变化

```json
{
  "id": "REPLACE-WITH-NEW-UUID",
  "questionId": "QB-20261008-01-P2-001",
  "type": "needs-review",
  "occurredAt": "REPLACE-WITH-ACTUAL-UTC-ISO-TIME",
  "day": 1,
  "answerVersion": "v01-full"
}
```

`type` 仅支持：

| 值 | 含义及证据 |
|---|---|
| `viewed` | 查看资料；不是开口 |
| `spoken` | 确认已自主开口回答；不由生成反馈自动推定 |
| `read-aloud` | 确认已朗读；不计成自主回答 |
| `needs-review` | 明确安排该题复练 |
| `reviewed` | 真实复练已完成；不等于已掌握 |
| `candidate-confirmed` | 用户明确确认候选细节；不能由朗读或助手改稿触发 |

`day` 是本次关联的计划 Day 1–30，不凭归档日期推测；`answerVersion` 使用实际参考版本。不确定练习是否发生时，不创建 `spoken` / `read-aloud` / `reviewed`。

### reviewSessions：复习日选题快照

```json
{
  "id": "REPLACE-WITH-NEW-UUID",
  "day": 7,
  "createdAt": "REPLACE-WITH-ACTUAL-UTC-ISO-TIME",
  "questionIds": ["QB-20261008-01-P2-001"],
  "reason": "catch-up",
  "sourceDay": 1
}
```

`reason` 为 `catch-up`（补课）或 `sample`（抽取旧题），`sourceDay` 可省略。选题快照不可变；仅选择题目不表示已经完成回答。第 7 / 14 / 21 / 28 天没有预设新题；先读真实记录，再确认未发布本机练习，最后确定本次选题。

## dot 怎样保存一次辅导

1. 开始时读取最新 `records.json`，保留全部既有记录。已发布记录只是公开可见部分，不代表用户全部本机活动。
2. 只为真实完成或实际生成的内容建立新 ID。原话、反馈、改稿分字段；不能预填后续题目的完成事件。
3. 把新增对象放进同一顶层结构的对应数组，得到增量 JSON。没有新增内容的数组仍保留为空。
4. **没有获授权的 GitHub 写工具：** 返回增量 JSON，告诉用户“待合并提交”。用户可在网页导入、检查，再导出完整 `records.json`，与最新公开版本合并后提交到 `docs/data/records.json`。
5. **已经获得明确 GitHub 写权限：** 工具读取最新分支文件及版本 SHA，按 ID 合并，提交新版本；遇到远端修改重新读取合并，不强推或整文件覆盖新记录。工具执行成功后核对文件，再等 Pages 发布并核对网页可读版本。
6. 只有公开网页读取到新记录时才说“网站已更新”；GitHub 提交完成但 Pages 未更新时说“已提交，等待网站发布”。不能将生成总结、保存在当前聊天或下载 JSON 宣称为网站已同步。

合并必须遵守：同一数组内同 ID 同内容幂等；同 ID 不同内容停止整次合并并说明冲突；新 ID 追加，旧数据保留。修订使用 `revisionOf`，不能静默篡改初答。`updatedAt` 更新为本次真实合并时间，不改变任何历史时间。

## 提醒及每日用量

本站不提供云推送。用户可主动导入网站 ICS 日历，在 `Asia/Shanghai` 每日 20:00 提醒；实际通知取决于日历和系统权限。网站不会因为用户打开一次便替用户订阅日历。

原计划每天 30–40 分钟。逐题首次开口与深练分开：先完成当日范围，优先精练 1 题，有余量再加。公布的参考稿、录音和报告生成都不能自动代表“已掌握”。完整题库所有题都有入口，但不承诺每天把所有题的长报告逐句消化并完成多次复录。
