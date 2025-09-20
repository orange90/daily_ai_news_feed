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
    <div className="space-y-8">
      <header className="space-y-3">
        <span className="badge">AI 热点 · 每日自动生成</span>
        <h1 className="text-3xl font-semibold text-slate-50 md:text-4xl">
          今日 AI 科技热点速览
        </h1>
        <p className="timestamp">最近更新：{formatTimestamp(generatedAt)}</p>
        <p className="text-slate-300">
          我们会每天从公开渠道选出十条 AI 科技热点，由 DeepSeek 自动提出关键问题并生成洞察点评，
          数据也会通过邮件同步发送给你。
        </p>
      </header>

      {items.length === 0 ? (
        <section className="section-card text-slate-300">
          <h2 className="text-xl font-semibold text-slate-100">还没有内容</h2>
          <p className="mt-2">
            等待 GitHub Action 首次运行后，这里会展示每日热点、问题以及 DeepSeek 的分析结果。
          </p>
        </section>
      ) : (
        <section className="card-grid">
          {items.map((item, index) => (
            <article key={item.id ?? index} className="section-card">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-slate-50">
                    <a href={item.url} target="_blank" rel="noreferrer">
                      {item.title}
                    </a>
                  </h2>
                  {item.source ? (
                    <p className="mt-1 text-sm text-slate-400">来源：{item.source}</p>
                  ) : null}
                </div>
                <span className="badge">#{index + 1}</span>
              </div>
              <p className="question">Q：{item.question}</p>
              <p className="answer whitespace-pre-wrap">A：{item.answer}</p>
            </article>
          ))}
        </section>
      )}

      <footer className="section-card text-sm text-slate-400">
        <p>
          部署在 Vercel · 数据每日由 GitHub Action 调度。你可以在仓库的 README 中找到配置说明，修改推送时间或邮件地址。
        </p>
      </footer>
    </div>
  );
}
