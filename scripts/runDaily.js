const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
const dotenv = require("dotenv");

dotenv.config();

const DISPATCH_HOUR = Number.parseInt(process.env.DISPATCH_HOUR_BEIJING ?? "9", 10);
const ITEMS_LIMIT = 10;

const nowInBeijing = () =>
  new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "Asia/Shanghai"
    })
  );

const shouldRunNow = () => {
  if (process.env.FORCE_DISPATCH === "true") {
    return true;
  }

  const beijing = nowInBeijing();
  const targetHour = Number.isNaN(DISPATCH_HOUR) ? 9 : DISPATCH_HOUR;
  return beijing.getHours() === targetHour;
};

const getStartOfTodayTimestamp = () => {
  const beijing = nowInBeijing();
  beijing.setHours(0, 0, 0, 0);
  return Math.floor(beijing.getTime() / 1000);
};

const pickQuestion = (title, source) => {
  const templates = [
    `如何看待“${title}”？这条消息背后的趋势是什么？`,
    `从行业角度看，“${title}” 对未来半年的 AI 布局意味着什么？`,
    `如果你是投资人，会如何评价“${title}” 的潜在价值？`,
    `站在普通开发者角度，${title} 带来哪些值得关注的机会？`,
    `这条来自 ${source ?? "业内"} 的动态“${title}” 会如何影响国内外生态？`
  ];

  return templates[Math.floor(Math.random() * templates.length)];
};

const fetchDailyNews = async () => {
  const startTimestamp = getStartOfTodayTimestamp();
  const endpoint = new URL("https://hn.algolia.com/api/v1/search");
  endpoint.searchParams.set("query", "AI");
  endpoint.searchParams.set("tags", "story");
  endpoint.searchParams.set("numericFilters", `created_at_i>${startTimestamp}`);
  endpoint.searchParams.set("hitsPerPage", String(ITEMS_LIMIT * 2));

  const response = await fetch(endpoint.href);
  if (!response.ok) {
    throw new Error(`无法获取新闻：${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const hits = Array.isArray(payload.hits) ? payload.hits : [];

  const items = hits
    .filter((item) => item?.title)
    .map((item) => {
      const url = item.url || `https://news.ycombinator.com/item?id=${item.objectID}`;
      let source;
      try {
        source = new URL(url).hostname.replace(/^www\./, "");
      } catch (error) {
        source = "news.ycombinator.com";
      }

      return {
        id: item.objectID,
        title: item.title,
        url,
        source,
        points: item.points ?? 0,
        text: item.story_text || item.comment_text || ""
      };
    })
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
    .slice(0, ITEMS_LIMIT);

  return items;
};

const callDeepSeek = async ({ title, question, url, text, source }) => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.warn("未配置 DEEPSEEK_API_KEY，使用占位回答。");
    return "（未配置 DeepSeek API Key，无法生成智能点评。请在仓库 Secrets 中设置 DEEPSEEK_API_KEY。）";
  }

  const prompt = [
    `请基于以下信息输出一段 150-200 字的中文分析，语气专业、可读性强：`,
    `标题：${title}`,
    `来源：${source ?? "未知"}`,
    url ? `链接：${url}` : null,
    text ? `原文摘要：${text}` : null,
    `提问：${question}`,
    `请提供结构化的见解（包括现状、意义和潜在风险），不需要重复问题。`
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch("https://api.siliconflow.cn/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "deepseek-ai/DeepSeek-V3.1",
      messages: [
        {
          role: "system",
          content: "你是一名关注人工智能行业的科技分析师，需要给出简洁、有洞察力的中文解读。"
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 600
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`调用 DeepSeek 失败：${response.status} ${errText}`);
  }

  const data = await response.json();
  const answer = data?.choices?.[0]?.message?.content?.trim();
  if (!answer) {
    throw new Error("DeepSeek 返回数据为空");
  }
  return answer;
};

const buildEmailContent = (items, generatedAtISO) => {
  const formattedDate = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "full",
    timeStyle: "short"
  }).format(new Date(generatedAtISO));

  const htmlItems = items
    .map(
      (item, index) => `
        <tr>
          <td style="padding:16px;border-bottom:1px solid #e2e8f0;">
            <h3 style="margin:0 0 8px 0;font-size:16px;color:#0f172a;">${index + 1}. <a href="${item.url}" style="color:#2563eb;text-decoration:none;">${item.title}</a></h3>
            <p style="margin:0 0 8px 0;color:#475569;font-size:13px;">来源：${item.source ?? "未知"}</p>
            <p style="margin:0 0 12px 0;font-weight:600;color:#0f172a;">Q：${item.question}</p>
            <p style="margin:0;color:#334155;line-height:1.6;white-space:pre-wrap;">A：${item.answer}</p>
          </td>
        </tr>`
    )
    .join("\n");

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;padding:24px;color:#0f172a;">
      <h2 style="margin:0 0 16px 0;">今日 AI 科技热点速递</h2>
      <p style="margin:0 0 24px 0;color:#475569;">生成时间（北京时间）：${formattedDate}</p>
      <table style="border-collapse:collapse;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 10px 25px rgba(15,23,42,0.1);">
        <tbody>
          ${htmlItems}
        </tbody>
      </table>
      <p style="margin-top:24px;color:#64748b;font-size:12px;">自动生成 · GitHub Action + DeepSeek 提供支持</p>
    </div>
  `;

  const textItems = items
    .map((item, index) => {
      return [
        `${index + 1}. ${item.title}`,
        `来源：${item.source ?? "未知"}`,
        `链接：${item.url}`,
        `Q：${item.question}`,
        `A：${item.answer}`,
        ""
      ].join("\n");
    })
    .join("\n");

  const text = `今日 AI 科技热点速递\n生成时间（北京时间）：${formattedDate}\n\n${textItems}`;

  return { html, text };
};

const sendEmail = async (items, generatedAtISO) => {
  const requiredEnv = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "MAIL_TO"];
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.warn(`缺少邮件配置 ${missing.join(", ")}，跳过发送邮件。`);
    return;
  }

  const port = Number.parseInt(process.env.SMTP_PORT, 10);
  const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  const fromName = process.env.MAIL_FROM_NAME || "AI Daily";
  const fromAddress = process.env.MAIL_FROM || process.env.SMTP_USER;
  const toAddress = process.env.MAIL_TO;

  const { html, text } = buildEmailContent(items, generatedAtISO);

  await transporter.sendMail({
    from: `${fromName} <${fromAddress}>`,
    to: toAddress,
    subject: `今日 AI 热点 (${new Date(generatedAtISO).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })})`,
    text,
    html
  });

  console.log(`已发送邮件至 ${toAddress}`);
};

const writeDataFile = (items, generatedAtISO) => {
  const output = {
    generatedAt: generatedAtISO,
    items: items.map(({ id, title, url, source, question, answer }) => ({
      id,
      title,
      url,
      source,
      question,
      answer
    }))
  };

  const targetPath = path.join(process.cwd(), "data", "latest.json");
  fs.writeFileSync(targetPath, JSON.stringify(output, null, 2), "utf8");
  console.log(`已写入 ${targetPath}`);
};

const main = async () => {
  if (!shouldRunNow()) {
    console.log(
      `当前北京时间 ${nowInBeijing().toISOString()} 不在设定的触发小时 (${DISPATCH_HOUR}). 设置 FORCE_DISPATCH=true 可强制执行。`
    );
    return;
  }

  console.log("开始获取今日 AI 热点...");
  const rawItems = await fetchDailyNews();
  console.log(`获取到 ${rawItems.length} 条候选热点，开始生成点评。`);

  const itemsWithInsights = [];
  for (const item of rawItems) {
    const question = pickQuestion(item.title, item.source);
    try {
      const answer = await callDeepSeek({
        title: item.title,
        url: item.url,
        text: item.text,
        question,
        source: item.source
      });
      itemsWithInsights.push({ ...item, question, answer });
    } catch (error) {
      console.error(`生成点评失败 (${item.title})`, error);
      itemsWithInsights.push({
        ...item,
        question,
        answer: "（调用 DeepSeek 失败，已记录日志，请稍后重试）"
      });
    }
  }

  const generatedAtISO = new Date().toISOString();
  writeDataFile(itemsWithInsights, generatedAtISO);

  try {
    await sendEmail(itemsWithInsights, generatedAtISO);
  } catch (error) {
    console.error("发送邮件失败", error);
  }

  console.log("任务完成");
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
