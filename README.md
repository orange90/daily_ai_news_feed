# 每日 AI 科技热点速递

一个完全免费的全栈方案：

- Next.js Web UI（部署到 Vercel）展示每日热点、提问与 DeepSeek 点评；
- GitHub Actions 聚合 20 个中英文免费新闻源，筛选当天 10 条 AI 资讯并让 DeepSeek 自动生成提问和解读；
- Nodemailer 通过任意免费 SMTP（如 Gmail、QQ 邮箱）发送邮件。

## 功能概览

| 功能 | 说明 |
| --- | --- |
| 热点来源 | `config/newsSources.js` 列出 20 个中英文免费 RSS/Hacker News 源，脚本统一抓取 |
| 新闻筛选 | 通过关键词过滤 AI 相关资讯，并按时间和链接去重后取最新 10 条 |
| 智能问答 | 调用 [硅基流动 DeepSeek-V3.1 Chat Completions](https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions) 同时生成提问与洞察 |
| 邮件发送 | Markdown 风格 HTML + 纯文本双格式，自动发至指定邮箱 |
| 推送时间 | 通过 `DISPATCH_HOUR_BEIJING` 指定北京时间小时，仅在该小时发送邮件 |
| 强制执行 | 手动触发 GitHub Workflow 时可勾选 force 立即运行并发送 |

## 快速开始

### 1. 本地开发

```bash
npm install
npm run dev
```

浏览器访问 `http://localhost:3000` 查看界面。默认 `data/latest.json` 为空，首次 GitHub Action 运行后会自动填充。

### 2. 必要配置

| 变量 | 作用 | 建议存放 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | 硅基流动 DeepSeek API Key | GitHub Repository Secrets |
| `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` | SMTP 服务器信息 | GitHub Repository Secrets |
| `MAIL_FROM` / `MAIL_FROM_NAME` | 邮件发件信息 | GitHub Repository Secrets |
| `MAIL_TO` | 收件邮箱 | GitHub Repository Secrets |
| `DISPATCH_HOUR_BEIJING` | 每日推送时间（北京时间小时，0-23） | GitHub Repository Variables |
| `NEWS_FETCH_USER_AGENT` *(可选)* | 自定义抓取新闻时的 UA，避免部分源拦截 | GitHub Repository Variables |



> 可以参考 `.env.example` 在本地调试，正式运行请将敏感信息写入 GitHub Secrets。

### 3. GitHub Action 调度

- Workflow 文件：`.github/workflows/daily.yml`
- 默认每小时运行一次，脚本每次都会更新 `data/latest.json`；仅当当前北京时间等于 `DISPATCH_HOUR_BEIJING` 或 `FORCE_DISPATCH=true` 时才发送邮件。
- 如需立刻运行，可在 GitHub Actions 页面手动触发 `workflow_dispatch` 并将 `force` 设为 `true`。

### 3.1 扩展或调整新闻源

所有新闻源集中在 `config/newsSources.js`，每个条目包含：

```js
{
  id: "techcrunch-ai",        // 唯一 ID
  name: "TechCrunch · AI",    // 展示名称
  language: "en" | "zh",       // 语言（用于平衡中英文条目）
  type: "rss" | "hn",          // 抓取方式：RSS 或 Hacker News API
  url: "https://...",          // RSS 链接，若 type 为 hn 则改用 query 字段
  weight: 10                   // 可选权重，影响排序优先级
}
```

如需新增或替换新闻源，只需修改该文件并提交即可。脚本会自动按语言平衡并过滤 AI 相关关键词（`AI / 人工智能 / 大模型 / LLM` 等），保证每日输出 10 条热点。
HN 来源示例：

```js
{
  id: "hn-ai",
  name: "Hacker News · AI",
  language: "en",
  type: "hn",
  query: "AI"
}
```


### 4. 邮件发送

脚本使用 Nodemailer，兼容任意支持 SMTP 的免费邮箱服务。

#### Gmail 示例
1. 开启两步验证并创建 **应用专用密码**；
2. `SMTP_HOST=smtp.gmail.com`，`SMTP_PORT=465`，`SMTP_SECURE=true`；
3. `SMTP_USER`/`MAIL_FROM` 为你的 Gmail 地址，`SMTP_PASS` 使用应用专用密码。

#### QQ 邮箱示例
1. 在设置中开启“POP3/SMTP 服务”；
2. `SMTP_HOST=smtp.qq.com`，`SMTP_PORT=465`，`SMTP_SECURE=true`；
3. `SMTP_USER`/`MAIL_FROM` 使用 QQ 邮箱，`SMTP_PASS` 使用授权码。

### 5. Vercel 部署

1. 在 Vercel 导入此仓库；
2. 构建命令使用 `npm run build`，输出目录自动为 `.next`；
3. 由于 `data/latest.json` 会被 GitHub Action 更新并提交，新部署会自动包含最新数据；
4. 需要在 Vercel 环境变量中同步配置（至少 `NEXT_PUBLIC_SITE_TITLE` 非必需，本项目所有 API 调用均在 GitHub Action 内完成，线上仅负责展示）。

### 6. 常见问题

- **为什么页面没有数据？**：确认 GitHub Action 成功运行，并检查 `data/latest.json` 是否被最新提交更新。
- **DeepSeek 调用失败**：确认 API Key 正确、GitHub Secrets 已配置；必要时在 Workflow 日志中查看错误信息。
- **邮件未收到**：检查 SMTP 授权是否正确、是否被服务商拦截，可先在本地运行 `FORCE_DISPATCH=true npm run daily` 进行调试。

### 7. 用户需额外配置的最少项目

1. 在 GitHub 仓库中添加 Secrets：`DEEPSEEK_API_KEY`、`SMTP_HOST`、`SMTP_PORT`、`SMTP_SECURE`、`SMTP_USER`、`SMTP_PASS`、`MAIL_FROM`、`MAIL_TO`（可选 `MAIL_FROM_NAME`）。
2. 在 GitHub 仓库中添加 Repository Variable：`DISPATCH_HOUR_BEIJING`（例如 `9` 代表每天上午九点），如有需要可配置 `NEWS_FETCH_USER_AGENT`。
3. 如需订阅不同资讯，只需编辑 `config/newsSources.js` 并推送；无需额外配置。
4. 在 Vercel 中设置对应的环境变量（用于本地调试或未来扩展）。


完成以上步骤后，你即可享受每日自动生成的 AI 热点洞察，无需手动操作。
