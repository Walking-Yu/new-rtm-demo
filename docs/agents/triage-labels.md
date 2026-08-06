# Triage 标签

各技能内部只认五个规范的 triage 角色。本文件把这些角色映射到本仓库 issue tracker 里实际使用的标签字符串。

本仓库沿用默认值，即标签名与角色名完全一致。

| mattpocock/skills 中的角色 | 本仓库使用的标签   | 含义                             |
| -------------------------- | ------------------ | -------------------------------- |
| `needs-triage`             | `needs-triage`     | 需要维护者评估这个 issue         |
| `needs-info`               | `needs-info`       | 等待报告人补充更多信息           |
| `ready-for-agent`          | `ready-for-agent`  | 描述已完备，可交给无人值守的 agent |
| `ready-for-human`          | `ready-for-human`  | 必须由人来实现                   |
| `wontfix`                  | `wontfix`          | 不会处理                         |

当某个技能提到某个角色时（例如"打上可交给 agent 的 triage 标签"），使用表格中对应的标签字符串。

本仓库使用本地 markdown 作为 issue tracker，因此标签不是平台原生 label，而是写在 issue 文件顶部附近的 `Status:` 行里，取值为上表右列的字符串。

如果以后改用其他词汇，直接编辑右列即可。
