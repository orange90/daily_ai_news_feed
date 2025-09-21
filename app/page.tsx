import newsData from "../data/latest.json";

interface NewsItem {
  id: string;
  title: string;
  url: string;
  source?: string;
  question: string;
  answer: string;
}

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
  const items = (newsData.items as NewsItem[]) ?? [];
  const generatedAt = newsData.generatedAt as string | null;

  return (
    <div className="space-y-12">
      <header className="space-y-4">
        <span className="badge">AI 热点 · 每日提问</span>
        <h1 className="text-4xl font-semibold leading-tight md:text-5xl">
          今日 AI 深读精选
        </h1>
        <p className="timestamp">最近更新：{formatTimestamp(generatedAt)}</p>
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
                    {item.source ? (
                      <p className="text-sm uppercase tracking-[0.18em] text-slate-500">
                        {item.source}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <p className="question">Q. {item.question}</p>
                    <p className="answer whitespace-pre-wrap">A. {item.answer}</p>
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
