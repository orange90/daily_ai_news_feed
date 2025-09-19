# 每日 AI 科技热点速递

一个完全免费的全栈方案：

- Next.js Web UI（部署到 Vercel）展示每日热点、提问与 DeepSeek 点评；
- GitHub Actions 每天定时获取 10 条最新 AI 科技热点、生成问题并调用 DeepSeek-V3.1 生成洞察；
- Nodemailer 通过任意免费 SMTP（如 Gmail、QQ 邮箱）发送邮件。

## 功能概览

| 功能 | 说明 |
| --- | --- |
| 热点来源 | Hacker News (Algolia API) 按当天热度筛选 AI 相关资讯 |
| 智能点评 | 调用 [硅基流动 DeepSeek-V3.1 Chat Completions](https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions) |
| 提问生成 | 针对每条新闻自动生成延伸问题（多模版随机） |
| 邮件发送 | Markdown 风格 HTML + 纯文本双格式，自动发至指定邮箱 |
| 配置时间 | 通过 `DISPATCH_HOUR_BEIJING` 指定北京时间小时 |
| 强制执行 | 手动触发 GitHub Workflow 时可勾选 force 立即运行 |

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

> 可以参考 `.env.example` 在本地调试，正式运行请将敏感信息写入 GitHub Secrets。

### 3. GitHub Action 调度

- Workflow 文件：`.github/workflows/daily.yml`
- 默认每小时运行一次，脚本会判断当前北京时间是否等于 `DISPATCH_HOUR_BEIJING`，只有在匹配时才真正执行（避免复杂的时区换算）。
- 如需立刻运行，可在 GitHub Actions 页面手动触发 `workflow_dispatch` 并将 `force` 设为 `true`。

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
2. 在 GitHub 仓库中添加 Repository Variable：`DISPATCH_HOUR_BEIJING`（例如 `9` 代表每天上午九点）。
3. 在 Vercel 中设置对应的环境变量（用于本地调试或未来扩展）。

完成以上步骤后，你即可享受每日自动生成的 AI 热点洞察，无需手动操作。
