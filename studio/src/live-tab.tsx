import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { decide, RUNG_LABEL } from "@policy";
import { Bars, MetaLine, Probability, RungBadge, ScoreRow, Trace, type Thresholds, type Vector } from "./parts";

export type Questions = Record<string, any>;
type EvalResult = {
  v: Vector;
  meta: { model: string; usage: { input_tokens: number; output_tokens: number }; ms: number };
  auditId?: string;
};
type AuditRow = {
  pack: string;
  id: string; ts: string; preview: string; action: string; why: string;
  review: { overturned?: boolean; at?: string } | null;
};

export function LiveTab({ questions, samples, thresholds }: {
  questions: Questions;
  samples: { msg: string; expect: string }[];
  thresholds: Thresholds;
}) {
  const [state, setState] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EvalResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<"kept" | "overturned" | null>(null);
  const [audit, setAudit] = useState<{ n: number; reviewed: number; overturned: number; trueErrorRate: number | null } | null>(null);
  const [rows, setRows] = useState<AuditRow[]>([]);

  async function refreshAudit() {
    try {
      const j = await (await fetch("/api/audit")).json();
      const t = j.stats?.triage;
      setAudit(t ? { n: t.n, reviewed: t.reviewed, overturned: t.overturned, trueErrorRate: t.trueErrorRate } : null);
      setRows((j.recent ?? []).filter((r: AuditRow & { pack: string }) => r.pack === "triage").slice(0, 6));
    } catch { /* 审计读不到不影响主流程 */ }
  }
  useEffect(() => { void refreshAudit(); }, []);

  // 样例是异步拉来的，挂载时还没有；只在用户没输入过时补默认值
  useEffect(() => {
    setState((cur) => (cur || !samples.length ? cur : samples[0].msg));
  }, [samples]);

  async function run(text = state) {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    setReviewed(null);
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 把当前滑块一起发过去：审计要记的是「当时真正生效的策略」，不是默认策略
        body: JSON.stringify({ state: text, thresholds }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setResult(body);
      void refreshAudit();
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  async function review(overturned: boolean) {
    if (!result?.auditId) return;
    await fetch("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: result.auditId, overturned }),
    });
    setReviewed(overturned ? "overturned" : "kept");
    void refreshAudit();
  }

  const v = result?.v;
  const verdict = v ? decide(v, thresholds) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              工单原文 → state
              <Badge variant="secondary">{[...state].length} 字</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea value={state} onChange={(e) => setState(e.target.value)} rows={5} className="font-mono text-sm" placeholder="粘贴一条客服工单…" />
            <div className="flex flex-wrap gap-1.5">
              {samples.slice(0, 6).map((s, i) => (
                <Button key={i} variant="outline" size="sm" className="h-7 max-w-full text-[11px]" onClick={() => { setState(s.msg); void run(s.msg); }}>
                  {s.msg.slice(0, 14)}…
                </Button>
              ))}
            </div>
            <Button onClick={() => void run()} disabled={busy || !state.trim()} className="w-full">
              {busy && <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
              {busy ? "等待 Jev 返回…" : "调用 Jev 评估"}
            </Button>
            {error && (
              <Alert variant="destructive">
                <AlertTitle>调用失败</AlertTitle>
                <AlertDescription className="font-mono text-xs">{error}</AlertDescription>
              </Alert>
            )}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              请求经本地 Node 代理转发，<span className="font-medium text-foreground">API 密钥不进入浏览器</span>，devtools 的 Network 面板里看不到它。
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">发出的 5 道题</CardTitle></CardHeader>
          <CardContent className="space-y-2.5">
            {Object.entries(questions).map(([id, q]) => (
              <div key={id} className="text-xs">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono">{q.type}</Badge>
                  <span className="font-mono text-[11px] text-muted-foreground">{id}</span>
                </div>
                <p className="mt-1 leading-snug text-muted-foreground">{q.instructions}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              Jev 返回的概率
              {verdict && <RungBadge rung={verdict.rung} />}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!v && <p className="py-8 text-center text-sm text-muted-foreground">点左侧按钮发起一次真实调用</p>}
            {v && (
              <>
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <span className="text-sm font-medium">intent · {v.choice}</span>
                    <span className="font-mono text-xs text-muted-foreground">confidence {v.conf.toFixed(2)}</span>
                  </div>
                  <Bars data={v.probabilities} winner={v.choice} />
                </div>
                <ScoreRow label="effort · 排查难度" score={v.effort} probs={v.effortProbabilities} levels={questions.effort.criteria} />
                <ScoreRow label="discretion · 政策裁量" score={v.discretion} probs={v.discretionProbabilities} levels={questions.discretion.criteria} />
                <div className="space-y-1.5 rounded-lg border bg-card/50 p-3">
                  <span className="text-sm font-medium">noul 判断</span>
                  <Probability label="high_stakes" value={v.high_stakes} warn={thresholds.stakeThreshold} />
                  <Probability label="urgent" value={v.urgent} warn={0.8} />
                </div>
                <MetaLine usage={result!.meta.usage} ms={result!.meta.ms} model={result!.meta.model} />
              </>
            )}
          </CardContent>
        </Card>

        {verdict && v && (
          <Card>
            <CardHeader><CardTitle className="text-base">阈值判定过程</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Trace gates={verdict.trace} />
              <div className="rounded-lg bg-muted/60 p-3 text-sm">
                <span className="text-muted-foreground">结论：</span>
                <span className="font-medium">{RUNG_LABEL[verdict.rung as keyof typeof RUNG_LABEL]}</span>
                <span className="ml-1 text-xs text-muted-foreground">— {verdict.why}</span>
                {v.urgent > 0.8 && <Badge variant="destructive" className="ml-2">加急</Badge>}
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                前四道题的概率由 Jev 给出；这一栏全部是本地代码算的 —— 换滑块不会重新问模型。
              </p>

              {result?.auditId && (
                <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                  <span className="text-xs text-muted-foreground">这条判定已进审计日志，人工复核：</span>
                  <Button size="sm" variant={reviewed === "kept" ? "default" : "outline"} className="h-7 text-xs" onClick={() => void review(false)}>
                    {reviewed === "kept" ? "已确认" : "认可这个去向"}
                  </Button>
                  <Button size="sm" variant={reviewed === "overturned" ? "destructive" : "outline"} className="h-7 text-xs" onClick={() => void review(true)}>
                    {reviewed === "overturned" ? "已标记推翻" : "推翻它"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              审计日志 jevkit/audit.jsonl
              {audit && (
                <span className="font-mono text-[11px] text-muted-foreground">
                  {audit.n} 条 · 已复核 {audit.reviewed} · 推翻 {audit.overturned} · 真实错误率{" "}
                  {audit.trueErrorRate == null ? "待复核" : `${(audit.trueErrorRate * 100).toFixed(0)}%`}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {!rows.length && <p className="py-4 text-center text-xs text-muted-foreground">还没有记录 —— 上面每点一次「调用 Jev 评估」就会落一条</p>}
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-[11px]">
                <span className="w-14 shrink-0 font-mono text-muted-foreground">{r.ts.slice(11, 19)}</span>
                <RungBadge rung={r.action} />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.preview}</span>
                {r.review && (
                  <Badge variant={r.review.overturned ? "destructive" : "secondary"} className="shrink-0 text-[10px]">
                    {r.review.overturned ? "已推翻" : "已确认"}
                  </Badge>
                )}
              </div>
            ))}
            <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
              只有「人工推翻率」能算出真实错误率；上面那列准确率对的是我手写的预期标签，是代理指标。
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
