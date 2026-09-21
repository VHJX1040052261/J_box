import type { ChangeEvent, KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type V = {
  under_scope: number; simple_means: string; simple_conf: number;
  new_goal: number; time_commit: number; risk10: number; settled: number; tomorrow: number | null;
};
type Res = { v: V; why: string; action: string; trace: { pass: boolean; text: string }[]; lints: string[]; meta: { ms: number; usage: { input_tokens: number }; cost: number } };

const ACTION = { clarify: ["要先澄清", "destructive"], proceed: ["可推进", "secondary"], settled: ["已谈定", "default"], unknown: ["未判定", "outline"] } as const;

export function BossTab() {
  const [thread, setThread] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Res | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetch("/api/boss").then((r) => r.json()).then((d) => setThread(d.thread ?? [])).catch(() => {});
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [thread, res]);

  async function ask(messages: string[]) {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/boss", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || `HTTP ${r.status}`);
      setRes(b);
    } catch (e) { setError((e as Error).message); setRes(null); }
    finally { setBusy(false); }
  }

  function send() {
    const t = draft.trim();
    if (!t) return;
    setDraft("");
    setThread((cur) => { const next = [...cur, t]; void ask(next); return next; });
  }

  const v = res?.v;
  const a = ACTION[(res?.action ?? "unknown") as keyof typeof ACTION] ?? ACTION.unknown;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">对话（最后一句是本次要判的）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {thread.map((m, i) => {
            const isTarget = i === thread.length - 1 && Boolean(res);
            return (
              <div key={i} className="flex justify-start">
                <div className={`max-w-[85%] rounded-lg px-3 py-1.5 text-sm ${isTarget ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  {m}
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
          <div className="flex gap-2 pt-2">
            <Textarea rows={1} value={draft} onChange={(ev: ChangeEvent<HTMLTextAreaElement>) => setDraft(ev.target.value)} onKeyDown={(ev: KeyboardEvent<HTMLTextAreaElement>) => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); send(); } }} placeholder="再补一句老板会说的话，回车即判" />
            <Button onClick={send} disabled={busy}>发送</Button>
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertTitle>调用失败</AlertTitle>
              <AlertDescription className="font-mono text-xs">{error}</AlertDescription>
            </Alert>
          )}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            上面 5 条是截图里那段原对话。概率由 Jev 给；<span className="font-medium text-foreground">「建议回复」那行是本地查表拼的</span>，Jev 不生成文本。
          </p>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {res?.lints.length ? (
          <Alert>
            <AlertTitle>内核守卫报出 {res.lints.length} 条</AlertTitle>
            <AlertDescription className="space-y-1 text-xs">
              {res.lints.map((l, i) => <p key={i} className="font-mono leading-snug">⚠ {l}</p>)}
              <p className="text-muted-foreground">被拦下的那道前瞻题仍然会照实发出去、照实显示，只是旁边标成「不可信」——不藏起来，好让你看见它有多不准。</p>
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              判断
              <Badge variant={a[1] as "destructive"}>{a[0]}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {!v && <p className="py-8 text-center text-sm text-muted-foreground">发一条消息开始</p>}
            {v && (
              <>
                <Bar label="措辞把范围说小了" value={v.under_scope} />
                <Bar label="新增了独立目标" value={v.new_goal} />
                <Bar label="在索要时间承诺" value={v.time_commit} />
                <Bar label="已经谈定了" value={v.settled} />
                <div className="flex items-baseline justify-between text-sm">
                  <span>「简单点」指</span>
                  <span className="font-mono text-xs text-muted-foreground">{v.simple_means} · 置信 {v.simple_conf.toFixed(2)}</span>
                </div>
                <div className="flex items-baseline justify-between text-sm">
                  <span>返工范围（5 档加权折算 0–10）</span>
                  <span className="font-mono text-xs text-muted-foreground">{v.risk10}/10</span>
                </div>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-muted-foreground line-through decoration-destructive/70">明天能上线（前瞻题）</span>
                  <span className="font-mono text-xs text-destructive">{v.tomorrow == null ? "—" : `${v.tomorrow.toFixed(2)} 不可信`}</span>
                </div>
                <div className="rounded-lg bg-muted/60 p-3 text-sm">
                  <span className="text-muted-foreground">建议回复（代码模板）：</span>
                  <p className="mt-1 leading-relaxed">{res!.why}</p>
                </div>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {res!.meta.usage.input_tokens} tok · ${res!.meta.cost.toFixed(6)} · {res!.meta.ms}ms
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span>{label}</span>
        <span className="font-mono text-xs text-muted-foreground">{value.toFixed(2)}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
    </div>
  );
}
