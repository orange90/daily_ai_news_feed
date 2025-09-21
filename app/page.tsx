import newsData from "../data/latest.json";

interface NewsItem {
  id: string;
  title: string;
  url: string;
  source?: string;
  question: string;
  answer: string;
  hotnessScore?: number;
}

const getHotnessScore = (item: NewsItem): number | null =>
  typeof item.hotnessScore === "number" ? item.hotnessScore : null;

const selectTopNewsItems = (items: NewsItem[], limit = 30) =>
  [...items]
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const aScore = getHotnessScore(a.item);
      const bScore = getHotnessScore(b.item);

      if (aScore === bScore) {
        return a.index - b.index;
      }

      if (aScore === null) {
        return 1;
      }

      if (bScore === null) {
        return -1;
      }

      return bScore - aScore;
    })
    .slice(0, limit)
    .map(({ item }) => item);

const splitIntoParagraphs = (text: string) =>
  String(text ?? "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

const getAnswerParagraphs = (text: string) => {
  const paragraphs = splitIntoParagraphs(text);
  if (paragraphs.length > 0) {
    return paragraphs;
  }
  const trimmed = String(text ?? "").trim();
  return trimmed ? [trimmed] : [];
};

const formatTimestamp = (isoString: string | null) => {
  if (!isoString) {
    return "尚未生成，请稍后再来";
  }

  const date = new Date(isoString);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "full",
    timeStyle: "short"
  }).format(date);
};

export default function HomePage() {
  const rawItems = (newsData.items as NewsItem[]) ?? [];
  const items = selectTopNewsItems(rawItems);
  const generatedAt = newsData.generatedAt as string | null;

  return (
    <div className="space-y-12">
      <header className="space-y-4">
        <span className="badge">AI 热点 · 每日提问</span>
        <h1 className="text-4xl font-semibold leading-tight md:text-5xl">
          今日 AI 深读精选 · TOP 30
        </h1>
        <p className="timestamp">最近更新：{formatTimestamp(generatedAt)}</p>
        <p className="meta-note">按综合热度排序，聚焦最新产品发布、技术突破与合规政策。</p>
        <p className="max-w-2xl text-base text-slate-600">
          从公开渠道精选最新 AI 资讯，借助 DeepSeek 提出关键问题与洞察分析，帮助你快速把握今日焦点。
        </p>
      </header>

      {items.length === 0 ? (
        <section className="section-card text-slate-600">
          <h2 className="text-2xl font-semibold">还没有内容</h2>
          <p className="mt-3 text-base">
            等待 GitHub Action 首次运行后，这里会展示每日热点、问题以及 DeepSeek 的分析结果。
          </p>
        </section>
      ) : (
        <ol className="card-grid">
          {items.map((item, index) => (
            <li key={item.id ?? index} className="section-card">
              <div className="flex items-start gap-3">
                <span className="badge">{String(index + 1).padStart(2, "0")}</span>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <h2 className="text-2xl font-semibold leading-snug text-slate-900">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {item.title}
                      </a>
                    </h2>
                    {(item.source || typeof item.hotnessScore === "number") && (
                      <p className="meta-line">
                        {item.source ? <span>{item.source}</span> : null}
                        {typeof item.hotnessScore === "number" ? (
                          <span>热度指数 {Math.round(item.hotnessScore)}</span>
                        ) : null}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <p className="question">Q. {item.question}</p>
                    <div className="answer">
                      {getAnswerParagraphs(item.answer).map((paragraph, paragraphIndex) => (
                        <p key={`${item.id ?? index}-answer-${paragraphIndex}`}>
                          {paragraphIndex === 0 ? `A. ${paragraph}` : paragraph}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      <footer className="section-card text-sm text-slate-500">
        <p>
          部署在 Vercel · 数据每日由 GitHub Action 调度。你可以在仓库的 README 中找到配置说明，修改推送时间或邮件地址。
        </p>
      </footer>
    </div>
  );
}
