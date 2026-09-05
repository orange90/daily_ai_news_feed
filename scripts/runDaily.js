const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const dotenv = require("dotenv");
const Parser = require("rss-parser");

const newsSources = require("../config/newsSources");

dotenv.config();

const DISPATCH_HOUR = Number.parseInt(process.env.DISPATCH_HOUR_BEIJING ?? "9", 10);
const ITEMS_LIMIT = 30;
const parseCandidateMultiplier = () => {
  const rawValue = process.env.CANDIDATE_MULTIPLIER ?? "4";
  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return 4;
  }
  return parsed;
};
const CANDIDATE_MULTIPLIER = parseCandidateMultiplier();
const MAX_CANDIDATE_ITEMS = Math.max(ITEMS_LIMIT, ITEMS_LIMIT * CANDIDATE_MULTIPLIER);
const NEWS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ANSWER_MIN_LENGTH = 1000;
const ANSWER_MAX_LENGTH = 2000;
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

const NEWS_SIGNAL_PATTERNS = [
  { pattern: /\b(announce[sd]?|announcing)\b/i, weight: 2 },
  { pattern: /\b(launch(ed|ing)?|release[sd]?|unveil(ed|ing)?)\b/i, weight: 3 },
  { pattern: /\b(introduc(e|ing|ed)|debut(s|ed)?)\b/i, weight: 2 },
  { pattern: /\b(update[sd]?|upgrade[sd]?|refresh(ed|ing)?)\b/i, weight: 1 },
  { pattern: /\b(partnership|collaborat(e|ion)|alliance|integrat(e|ion))\b/i, weight: 2 },
  { pattern: /\b(regulation|policy|framework|law|bill|act|compliance|standard)\b/i, weight: 3 },
  { pattern: /\b(funding|investment|round|acquisition|merger|deal|financing)\b/i, weight: 2 },
  { pattern: /\b(public preview|general availability|GA release)\b/i, weight: 2 },
  {
    pattern:
      /(发布|推出|上线|宣布|升级|迭代|合作|联合|集成|政策|法规|条例|法案|指导|标准|监管|融资|投资|收购|并购|新产品|新技术|正式版|公测)/,
    weight: 3
  }
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

const sanitizeAnswer = (text, maxLength = 4800) => {
  if (!text) return "";
  const normalized = String(text).replace(/\r\n/g, "\n");
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (paragraphs.length === 0) {
    return "";
  }
  const joined = paragraphs.join("\n\n");
  if (joined.length <= maxLength) {
    return joined;
  }
  return `${joined.slice(0, maxLength).trim()}...`;
};

const limitCandidates = (items, limit = MAX_CANDIDATE_ITEMS) => {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }
  if (!Number.isFinite(limit) || limit <= 0) {
    return items.slice();
  }
  if (limit >= items.length) {
    return items.slice();
  }
  return items.slice(0, limit);
};

const getNormalizedLength = (text) =>
  String(text ?? "")
    .replace(/\r?\n/g, "")
    .replace(/\s+/g, "")
    .length;

const evaluateInsightQuality = ({ question, answer }) => {
  if (!question || !String(question).trim()) {
    return "问题为空";
  }

  if (!answer || !String(answer).trim()) {
    return "回答为空";
  }

  const answerLength = getNormalizedLength(answer);
  if (answerLength < ANSWER_MIN_LENGTH) {
    return `回答长度 ${answerLength} 低于最小值 ${ANSWER_MIN_LENGTH}`;
  }

  if (answerLength > ANSWER_MAX_LENGTH) {
    return `回答长度 ${answerLength} 超过最大值 ${ANSWER_MAX_LENGTH}`;
  }

  return null;
};

const computeNewsSignal = (title, summary) => {
  const text = `${title ?? ""} ${summary ?? ""}`;
  let score = 0;
  for (const { pattern, weight } of NEWS_SIGNAL_PATTERNS) {
    if (pattern.test(text)) {
      score += weight;
    }
  }
  return score;
};

const isNewsWorthy = (signal, baseWeight = 0) => {
  if (signal >= 2) {
    return true;
  }
  if (baseWeight >= 10 && signal >= 1) {
    return true;
  }
  return signal > 0;
};

const computeHotnessScore = (item) => {
  const now = Date.now();
  const recencyHours = item.publishedAt
    ? Math.max(0, (now - item.publishedAt) / (1000 * 60 * 60))
    : 72;
  const recencyScore = Math.max(0, 72 - recencyHours);
  const baseWeight = item.weight ?? 0;
  const newsSignal = item.newsSignal ?? computeNewsSignal(item.title, item.summary);
  const engagement = item.engagement ?? 0;
  return baseWeight * 10 + newsSignal * 4 + recencyScore * 2 + engagement * 3;
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

const isRecentEnough = (timestamp, maxAge = NEWS_MAX_AGE_MS) => {
  if (typeof timestamp !== "number") {
    return false;
  }
  const now = Date.now();
  const age = now - timestamp;
  if (age < 0) {
    return true;
  }
  return age <= maxAge;
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
        weight: source.weight ?? 0,
        engagement: 0
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
        weight: source.weight ?? 0,
        engagement: item.points ?? 0
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
        if (!isRecentEnough(item.publishedAt)) {
          continue;
        }
        const newsSignal = computeNewsSignal(item.title, item.summary);
        if (!isNewsWorthy(newsSignal, item.weight ?? 0)) {
          continue;
        }
        aggregated.push({ ...item, newsSignal });
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
    const enriched = { ...item };
    enriched.hotnessScore = computeHotnessScore(enriched);
    if (!map.has(key)) {
      map.set(key, enriched);
      continue;
    }
    const existing = map.get(key);
    if ((enriched.hotnessScore ?? 0) > (existing.hotnessScore ?? 0)) {
      map.set(key, enriched);
    }
  }

  const deduped = Array.from(map.values());
  return deduped.sort(
    (a, b) => (b.hotnessScore ?? 0) - (a.hotnessScore ?? 0)
  );
};

const fetchDailyNews = async () => {
  const aggregated = await collectNewsItems();
  const sorted = dedupeAndSort(aggregated);
  return sorted;
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
      answer: sanitizeAnswer(answerMatch[1], 4800)
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
    answer: sanitizeAnswer(restJoined || content, 4800)
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

  const analysisRangeText = `${ANSWER_MIN_LENGTH} 至 ${ANSWER_MAX_LENGTH} 字`;
  const systemPrompt =
    `你是一名关注人工智能行业的科技分析师，需要输出结构化、扎实的中文洞察。务必使用中文作答，并将分析正文控制在 ${analysisRangeText} 之间。`;

  const buildPrompt = () =>
    [
      "你是一名人工智能行业的资深分析师。",
      `请针对下面的新闻先提出一个最值得追问的问题，再撰写一份中文深度分析，正文请严格控制在 ${analysisRangeText} 之间，并分为 4-6 个段落，每段 3-4 句。`,
      "分析需覆盖：1）事件背景与核心发布内容；2）对行业或生态的影响；3）技术、商业或监管层面的机会与风险；4）建议后续关注的指标或行动。",
      "如需补充更多事实、数据或行业对比以确保内容扎实，也请在上述字数范围内完成。",
      "输出要求：直接返回 JSON 对象，形如 {\"question\":\"...\",\"answer\":\"...\"}，不要包含额外解释。",
      "语气保持客观、专业，尽量引用公开事实、数据或案例来支撑判断。",
      `新闻标题：${title}`,
      `新闻来源：${source ?? "未知"}`,
      `原文语言：${language === "zh" ? "中文" : "英文"}`,
      url ? `链接：${url}` : null,
      summary ? `原文摘要：${summary}` : null
    ]
      .filter(Boolean)
      .join("\n");

  const requestInsights = async (prompt) => {
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
            content: systemPrompt
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.6,
        max_tokens: 4096
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
    const answer = sanitizeAnswer(parsed.answer, 4800);

    if (!question || !answer) {
      throw new Error("DeepSeek 输出缺少问题或回答");
    }

    return { question, answer };
  };
  return requestInsights(buildPrompt());
};

const buildEmailContent = (items, generatedAtISO) => {
  const formattedDate = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "full",
    timeStyle: "short"
  }).format(new Date(generatedAtISO));

  const splitAnswerParagraphs = (answer) =>
    String(answer ?? "")
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);

  const formatAnswerParagraphsHtml = (answer) => {
    const paragraphs = splitAnswerParagraphs(answer);
    if (paragraphs.length === 0) {
      return "";
    }
    return paragraphs
      .map((paragraph, index) => {
        const prefix = index === 0 ? "A：" : "";
        return `<p style="margin:0 0 12px 0;color:#334155;line-height:1.7;">${prefix}${paragraph}</p>`;
      })
      .join("");
  };

  const formatAnswerParagraphsText = (answer) => {
    const paragraphs = splitAnswerParagraphs(answer);
    if (paragraphs.length === 0) {
      return "A：";
    }
    return paragraphs
      .map((paragraph, index) => `${index === 0 ? "A：" : ""}${paragraph}`)
      .join("\n\n    ");
  };

  const htmlItems = items
    .map(
      (item, index) => {
        const hotness = Math.round(item.hotnessScore ?? 0);
        const answerHtml = formatAnswerParagraphsHtml(item.answer);
        return `
        <tr>
          <td style="padding:16px;border-bottom:1px solid #e2e8f0;">
            <h3 style="margin:0 0 8px 0;font-size:16px;color:#0f172a;">${index + 1}. <a href="${item.url}" style="color:#2563eb;text-decoration:none;">${item.title}</a></h3>
            <p style="margin:0 0 8px 0;color:#475569;font-size:13px;">来源：${item.source ?? "未知"}${
              hotness > 0 ? ` · 热度指数：${hotness}` : ""
            }</p>
            <p style="margin:0 0 12px 0;font-weight:600;color:#0f172a;">Q：${item.question}</p>
            ${answerHtml}
          </td>
        </tr>`;
      }
    )
    .join("\n");

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;padding:24px;color:#0f172a;">
      <h2 style="margin:0 0 16px 0;">今日 AI 科技热点深读 · TOP 30</h2>
      <p style="margin:0 0 8px 0;color:#475569;">生成时间（北京时间）：${formattedDate}</p>
      <p style="margin:0 0 24px 0;color:#64748b;font-size:13px;">按综合热度排序，涵盖新产品、关键技术发布与最新政策动态。</p>
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
      const hotness = Math.round(item.hotnessScore ?? 0);
      const answerText = formatAnswerParagraphsText(item.answer);
      const parts = [
        `${index + 1}. ${item.title}`,
        `来源：${item.source ?? "未知"}${hotness > 0 ? ` · 热度指数：${hotness}` : ""}`,
        `链接：${item.url}`,
        `Q：${item.question}`,
        answerText,
        ""
      ];
      return parts.join("\n");
    })
    .join("\n");

  const text = `今日 AI 科技热点深读 · TOP 30\n生成时间（北京时间）：${formattedDate}\n按综合热度排序，聚焦新产品、技术突破与重要监管动态。\n\n${textItems}`;

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
    items: items.map(({ id, title, url, source, question, answer, hotnessScore }) => ({
      id,
      title,
      url,
      source,
      question,
      answer,
      hotnessScore:
        typeof hotnessScore === "number" ? Math.round(hotnessScore) : undefined
    }))
  };

  const targetPath = path.join(process.cwd(), "data", "latest.json");
  fs.writeFileSync(targetPath, JSON.stringify(output, null, 2), "utf8");
  console.log(`已写入 ${targetPath}`);
};

const main = async () => {
  console.log("开始获取今日 AI 热点...");
  const allCandidates = await fetchDailyNews();
  const candidateItems = limitCandidates(allCandidates);
  console.log(
    `聚合到 ${allCandidates.length} 条候选热点，计划按热度处理前 ${candidateItems.length} 条用于深度分析。`
  );
  if (candidateItems.length === 0) {
    console.warn("未找到符合条件的热点，请检查新闻源配置或稍后重试。");
  }

  const itemsWithInsights = [];
  let processedCount = 0;
  let qualityRejectedCount = 0;
  let failedGenerationCount = 0;

  for (const item of candidateItems) {
    if (itemsWithInsights.length >= ITEMS_LIMIT) {
      break;
    }

    processedCount += 1;

    try {
      const { question, answer } = await callDeepSeek({
        title: item.title,
        url: item.url,
        summary: item.summary,
        source: item.source,
        language: item.language
      });
      const enriched = { ...item, question, answer };
      const qualityIssue = evaluateInsightQuality(enriched);
      if (qualityIssue) {
        qualityRejectedCount += 1;
        console.warn(`跳过 ${item.title}：${qualityIssue}`);
        continue;
      }
      itemsWithInsights.push(enriched);
    } catch (error) {
      failedGenerationCount += 1;
      console.error(`生成点评失败 (${item.title})`, error);
    }
  }

  if (itemsWithInsights.length < ITEMS_LIMIT) {
    const summaryDetails = [
      `目标 ${ITEMS_LIMIT} 条`,
      `候选 ${candidateItems.length} 条`,
      `已处理 ${processedCount} 条`
    ];
    if (qualityRejectedCount > 0) {
      summaryDetails.push(`质量未达标 ${qualityRejectedCount} 条`);
    }
    if (failedGenerationCount > 0) {
      summaryDetails.push(`调用失败 ${failedGenerationCount} 条`);
    }
    console.warn(`最终仅生成 ${itemsWithInsights.length} 条有效热点（${summaryDetails.join("，")}）。`);
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