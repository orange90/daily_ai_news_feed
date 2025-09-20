const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const dotenv = require("dotenv");
const Parser = require("rss-parser");

const newsSources = require("../config/newsSources");

dotenv.config();

const DISPATCH_HOUR = Number.parseInt(process.env.DISPATCH_HOUR_BEIJING ?? "9", 10);
const ITEMS_LIMIT = 10;
const KEYWORD_PATTERNS = [
  /\bAI\b/i,
  /artificial intelligence/i,
  /machine learning/i,
  /deep learning/i,
  /generative AI/i,
  /genai/i,
  /large language model/i,
  /LLM/i,
  /autonomous/i,
  /openai/i,
  /deepseek/i,
  /人工智能/,
  /大模型/,
  /机器学习/,
  /深度学习/,
  /生成式/,
  /算力/,
  /智能体/,
  /自动驾驶/
];

const parser = new Parser({
  headers: {
    "User-Agent":
      process.env.NEWS_FETCH_USER_AGENT ||
      "Daily-AI-Digest/1.0 (+https://github.com/daily-ai-news-feed)",
    Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, text/html;q=0.7"
  },
  timeout: 20000
});

const nowInBeijing = () =>
  new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "Asia/Shanghai"
    })
  );

const getStartOfTodayTimestamp = () => {
  const beijing = nowInBeijing();
  beijing.setHours(0, 0, 0, 0);
  return Math.floor(beijing.getTime() / 1000);
};

const shouldSendEmailNow = () => {
  if (process.env.FORCE_DISPATCH === "true") {
    return true;
  }

  const targetHour = Number.isNaN(DISPATCH_HOUR) ? 9 : DISPATCH_HOUR;
  return nowInBeijing().getHours() === targetHour;
};

const sanitizeText = (text, maxLength = 800) => {
  if (!text) return "";
  const normalized = String(text).replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
};

const isAIRelevant = (content) => {
  if (!content) return false;
  const normalized = content.toLowerCase();
  return KEYWORD_PATTERNS.some((pattern) => pattern.test(normalized));
};

const parseDateToTimestamp = (value) => {
  if (!value) return undefined;
  const date = new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) {
    return undefined;
  }
  return time;
};

const hashId = (sourceId, rawId) =>
  crypto.createHash("md5").update(`${sourceId}:${rawId}`).digest("hex");

const fetchFromRss = async (source) => {
  const feed = await parser.parseURL(source.url);
  const items = Array.isArray(feed.items) ? feed.items : [];
  return items
    .filter((item) => item?.title && (item?.link || item?.guid))
    .map((item) => {
      const url = item.link || item.guid;
      return {
        id: hashId(source.id, url || item.title),
        title: sanitizeText(item.title, 300),
        url,
        source: source.name,
        summary: sanitizeText(item.contentSnippet || item.content || item.summary, 600),
        publishedAt: parseDateToTimestamp(item.isoDate || item.pubDate),
        language: source.language,
        weight: source.weight ?? 0
      };
    });
};

const fetchFromHackerNews = async (source) => {
  const startTimestamp = getStartOfTodayTimestamp();
  const endpoint = new URL("https://hn.algolia.com/api/v1/search");
  endpoint.searchParams.set("query", source.query || "AI");
  endpoint.searchParams.set("tags", "story");
  endpoint.searchParams.set("numericFilters", `created_at_i>${startTimestamp - 3600}`);
  endpoint.searchParams.set("hitsPerPage", String(ITEMS_LIMIT * 4));

  const response = await fetch(endpoint.href);
  if (!response.ok) {
    throw new Error(`无法获取 ${source.name}：${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const hits = Array.isArray(payload.hits) ? payload.hits : [];
  return hits
    .filter((item) => item?.title)
    .map((item) => {
      const url = item.url || `https://news.ycombinator.com/item?id=${item.objectID}`;
      return {
        id: hashId(source.id, item.objectID),
        title: sanitizeText(item.title, 300),
        url,
        source: source.name,
        summary: sanitizeText(item.story_text || item.comment_text, 600),
        publishedAt: parseDateToTimestamp(item.created_at),
        language: source.language,
        weight: (source.weight ?? 0) + (item.points ?? 0) * 2
      };
    });
};

const fetchNewsFromSource = async (source) => {
  if (source.type === "hn") {
    return fetchFromHackerNews(source);
  }

  if (source.type === "rss") {
    return fetchFromRss(source);
  }

  throw new Error(`未知的来源类型：${source.type}`);
};

const collectNewsItems = async () => {
  const aggregated = [];

  for (const source of newsSources) {
    try {
      const items = await fetchNewsFromSource(source);
      for (const item of items) {
        const textForFilter = `${item.title} ${item.summary ?? ""}`;
        if (!isAIRelevant(textForFilter)) {
          continue;
        }
        aggregated.push({ ...item });
      }
    } catch (error) {
      console.warn(`来源 ${source.name} 获取失败：${error.message}`);
    }
  }

  return aggregated;
};

const dedupeAndSort = (items) => {
  const map = new Map();
  for (const item of items) {
    if (!item.url && !item.id) {
      continue;
    }
    const key = (item.url || item.id).split("#")[0];
    if (!map.has(key)) {
      map.set(key, item);
      continue;
    }
    const existing = map.get(key);
    const existingScore = (existing.publishedAt ?? 0) + (existing.weight ?? 0) * 60 * 60 * 1000;
    const newScore = (item.publishedAt ?? 0) + (item.weight ?? 0) * 60 * 60 * 1000;
    if (newScore > existingScore) {
      map.set(key, item);
    }
  }

  const deduped = Array.from(map.values());
  return deduped.sort((a, b) => {
    const scoreA = (a.publishedAt ?? 0) + (a.weight ?? 0) * 60 * 60 * 1000;
    const scoreB = (b.publishedAt ?? 0) + (b.weight ?? 0) * 60 * 60 * 1000;
    return scoreB - scoreA;
  });
};

const selectTopItems = (items) => {
  if (items.length === 0) {
    return [];
  }

  const startOfToday = getStartOfTodayTimestamp() * 1000;
  const todaysItems = items.filter((item) => !item.publishedAt || item.publishedAt >= startOfToday);
  const workingSet = todaysItems.length >= ITEMS_LIMIT ? todaysItems : items;

  const englishQuota = Math.floor(ITEMS_LIMIT / 2);
  const chineseQuota = ITEMS_LIMIT - englishQuota;
  const counts = { en: 0, zh: 0 };
  const selected = [];
  const fallback = [];
  const selectedKeys = new Set();

  const addItem = (item) => {
    const key = item.id || item.url;
    if (!key || selectedKeys.has(key)) {
      return false;
    }
    selected.push(item);
    selectedKeys.add(key);
    return true;
  };

  for (const item of workingSet) {
    if (selected.length >= ITEMS_LIMIT) {
      break;
    }
    const language = item.language === "zh" ? "zh" : "en";
    if (language === "en" && counts.en < englishQuota && addItem(item)) {
      counts.en += 1;
      continue;
    }
    if (language === "zh" && counts.zh < chineseQuota && addItem(item)) {
      counts.zh += 1;
      continue;
    }
    fallback.push(item);
  }

  if (selected.length < ITEMS_LIMIT) {
    for (const item of fallback) {
      if (selected.length >= ITEMS_LIMIT) break;
      addItem(item);
    }
  }

  if (selected.length < ITEMS_LIMIT) {
    for (const item of workingSet) {
      if (selected.length >= ITEMS_LIMIT) break;
      addItem(item);
    }
  }

  return selected.slice(0, ITEMS_LIMIT);
};

const fetchDailyNews = async () => {
  const aggregated = await collectNewsItems();
  const sorted = dedupeAndSort(aggregated);
  const selected = selectTopItems(sorted);
  if (selected.length < ITEMS_LIMIT) {
    console.warn(
      `仅找到 ${selected.length} 条符合条件的热点，请检查新闻源是否可访问或适当放宽关键词。`
    );
  }
  return selected;
};

const extractJsonObject = (content) => {
  if (!content) return null;
  const trimmed = content.trim();
  const blockMatch = trimmed.match(/```json([\s\S]*?)```/i) || trimmed.match(/```([\s\S]*?)```/i);
  const jsonText = blockMatch ? blockMatch[1].trim() : trimmed;
  try {
    const parsed = JSON.parse(jsonText);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch (error) {
    return null;
  }
  return null;
};

const fallbackParseAnswer = (content) => {
  if (!content) {
    return { question: "（未能解析问题）", answer: "（未能解析回答）" };
  }
  const questionMatch = content.match(/(?:提问|问题|Question|Q)[：: ]+([^\n]+)/i);
  const answerMatch = content.match(/(?:回答|解析|Answer|A)[：: ]+([\s\S]+)/i);
  if (questionMatch && answerMatch) {
    return {
      question: sanitizeText(questionMatch[1], 200),
      answer: sanitizeText(answerMatch[1], 1200)
    };
  }

  const lines = content
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return { question: "（未能解析问题）", answer: "（未能解析回答）" };
  }

  const [firstLine, ...rest] = lines;
  const restJoined = rest.join("\n");
  return {
    question: sanitizeText(firstLine, 200),
    answer: sanitizeText(restJoined || content, 1200)
  };
};

const callDeepSeek = async ({ title, url, summary, source, language }) => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.warn("未配置 DEEPSEEK_API_KEY，使用占位内容。");
    return {
      question: "（未配置 DeepSeek API Key，无法生成智能提问）",
      answer: "（未配置 DeepSeek API Key，无法生成智能点评。请在仓库 Secrets 中设置 DEEPSEEK_API_KEY。）"
    };
  }

  const promptParts = [
    "你是一名人工智能行业的资深分析师。",
    "请针对下面的新闻先提出一个最值得追问的问题，再给出 150-220 字的中文专业解读。",
    "输出要求：直接返回 JSON 对象，形如 {\"question\": \"...\", \"answer\": \"...\"}，不要包含额外解释。",
    "回答需包含现状、意义与潜在风险或挑战，语气保持客观、专业。",
    `新闻标题：${title}`,
    `新闻来源：${source ?? "未知"}`,
    `原文语言：${language === "zh" ? "中文" : "英文"}`,
    url ? `链接：${url}` : null,
    summary ? `原文摘要：${summary}` : null
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
          content: promptParts
        }
      ],
      temperature: 0.7,
      max_tokens: 700
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`调用 DeepSeek 失败：${response.status} ${errText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("DeepSeek 返回数据为空");
  }

  const parsed = extractJsonObject(content) || fallbackParseAnswer(content);
  const question = sanitizeText(parsed.question, 200);
  const answer = sanitizeText(parsed.answer, 1200);

  if (!question || !answer) {
    throw new Error("DeepSeek 输出缺少问题或回答");
  }

  return { question, answer };
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
  console.log("开始获取今日 AI 热点...");
  const rawItems = await fetchDailyNews();
  console.log(`聚合到 ${rawItems.length} 条候选热点，开始调用 DeepSeek 生成提问和解读。`);
  if (rawItems.length === 0) {
    console.warn("未找到符合条件的热点，请检查新闻源配置或稍后重试。");
  }

  const itemsWithInsights = [];
  for (const item of rawItems) {
    try {
      const { question, answer } = await callDeepSeek({
        title: item.title,
        url: item.url,
        summary: item.summary,
        source: item.source,
        language: item.language
      });
      itemsWithInsights.push({ ...item, question, answer });
    } catch (error) {
      console.error(`生成点评失败 (${item.title})`, error);
      const fallbackQuestion = `围绕“${item.title}”需要重点关注哪些问题？`;
      itemsWithInsights.push({
        ...item,
        question: fallbackQuestion,
        answer: "（调用 DeepSeek 失败，已记录日志，请稍后重试）"
      });
    }
  }

  const generatedAtISO = new Date().toISOString();
  writeDataFile(itemsWithInsights, generatedAtISO);

  try {
    if (shouldSendEmailNow()) {
      await sendEmail(itemsWithInsights, generatedAtISO);
    } else {
      console.log(
        `当前北京时间 ${nowInBeijing().toISOString()} 未到设定的推送小时 (${DISPATCH_HOUR})，已跳过邮件发送，仅更新数据。`
      );
    }
  } catch (error) {
    console.error("发送邮件失败", error);
  }

  console.log("任务完成");
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
