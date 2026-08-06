# Issue tracker：本地 Markdown

本仓库的 issue 和 spec（也就是通常说的 PRD）都以 markdown 文件形式存放在 `docs/scratch/` 下。本仓库目前没有配置 git remote，因此不使用 GitHub / GitLab issue。

## 约定

- 一个功能一个目录：`docs/scratch/<feature-slug>/`
- spec 放在 `docs/scratch/<feature-slug>/spec.md`
- 实现票一票一文件，路径 `docs/scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 开始编号——**绝不允许**把多张票合并进一个文件
- triage 状态记在每个 issue 文件顶部附近的 `Status:` 行（角色字符串见 `triage-labels.md`）
- 评论和对话历史追加到文件末尾的 `## Comments` 标题下

## 当某个技能说"发布到 issue tracker"

在 `docs/scratch/<feature-slug>/` 下新建文件，目录不存在就先创建。

## 当某个技能说"取出相关的票"

读取引用路径上的文件。通常用户会直接给出路径或票号。

## Wayfinding 相关操作

供 `/wayfinder` 使用。**地图**是一个文件，配上每张票一个**子文件**。

- **地图**：`docs/scratch/<effort>/map.md` —— 包含 Notes / Decisions-so-far / Fog 三部分正文。
- **子票**：`docs/scratch/<effort>/issues/NN-<slug>.md`，从 `01` 开始编号，正文写待解决的问题。`Type:` 行记录票的类型（`research` / `prototype` / `grilling` / `task`）；`Status:` 行记录 `claimed` / `resolved`。
- **阻塞关系**：文件顶部附近写一行 `Blocked by: NN, NN`。当它列出的每个文件都是 `resolved` 时，这张票才解除阻塞。
- **前沿（frontier）**：扫描 `docs/scratch/<effort>/issues/`，找出未关闭、未被阻塞、未被认领的文件；票号最小的优先。
- **认领**：开工前先把 `Status:` 改成 `claimed` 并保存。
- **解决**：在文件里追加 `## Answer` 标题写下答案，把 `Status:` 改成 `resolved`，然后往 `map.md` 的 Decisions-so-far 里追加一条上下文指针（一句话摘要 + 链接）。

## 本仓库补充说明

- `docs/` 下的 md、txt 等文档一律不允许删除（项目硬约束）。**唯一例外是 `docs/scratch/`**：它存放各 effort 的工作产物，票会被反复改写状态、作废票可以删除，不受该硬约束。删除前仍需用户确认。
- 文档正文用简体中文；路径、`Status:` 这类字段名、标签字符串保持英文。
