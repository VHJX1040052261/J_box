import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { MetaLine, VectorView, VerdictBadge } from "./parts";

type Tool = {
  id: string;
  mcp: string;
  title: string;
  args: string[];
  optArgs: string[];
  raw?: boolean;
  example: Record<string, any>;
};

type CallResult = {
  ok: boolean;
  tool?: string;
  patched?: boolean;
  v?: Record<string, any>;
  hits?: { i: number; p: number; preview: string }[];
  scanned?: number;
  kept?: number;
  note?: string;
  meta?: any;
  error?: string;
  degraded?: boolean;
  hint?: string;
};

/** 参数控件按名字分派：questions 是 JSON，items 是一行一条，threshold 是数字，其余按文本 */
const JSON_ARGS = new Set(["questions"]);
const LINES_ARGS = new Set(["items"]);
const NUMBER_ARGS = new Set(["threshold", "sample"]);

function stringifyExample(value: any): string {
  if (value == null) return "";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.join("\n");
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function parseArg(name: string, raw: string): any {
  if (NUMBER_ARGS.has(name)) return raw.trim() === "" ? undefined : Number(raw);
  if (JSON_ARGS.has(name)) return raw.trim() ? JSON.parse(raw) : undefined;
  if (LINES_ARGS.has(name)) return raw.split("\n").map((l) => l.trim()).filter(Boolean);
  return raw;
}

export function ConsoleTab({ tools }: { tools: Tool[] }) {
  const [current, setCurrent] = useState<string>(tools[0]?.id ?? "verify");
  const [form, setForm] = useState<Record<string, string>>({});
  const [sample, setSample] = useState(1);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CallResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tool = tools.find((t) => t.id === current);

  // 换工具就把表单填成它的示例，省得每次手敲；示例是真跑过的输入
  useEffect(() => {
    if (!tool) return;
    const next: Record<string, string> = {};
    for (const a of [...tool.args, ...tool.optArgs]) next[a] = stringifyExample(tool.example?.[a]);
    setForm(next);
    setResult(null);
    setError(null);
  }, [current, tools]);

  async function run() {
    if (!tool) return;
    setBusy(true);
    setError(null);
    try {
      const args: Record<string, any> = {};
      for (const a of [...tool.args, ...tool.optArgs]) {
        const v = parseArg(a, form[a] ?? "");
        if (v !== undefined && v !== "") args[a] = v;
      }
      const res = await fetch("/api/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: tool.id, args, sample }),
      });
      const body = (await res.json()) as CallResult;
      setResult(body);
      if (!body.ok) setError(body.error ?? `HTTP ${res.status}`);
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_minmax(0,1.1fr)]">
      <Card className="h-fit">
        <CardHeader><CardTitle className="text-base">八个工具</CardTitle></CardHeader>
        <CardContent className="space-y-1.5">
          {tools.map((t) => (
            <button
              key={t.id}
              onClick={() => setCurrent(t.id)}
              className={`w-full rounded-md border px-2.5 py-2 text-left transition-colors ${t.id === current ? "border-primary bg-primary/5" : "hover:bg-muted/60"}`}
            >
              <div className="font-mono text-[11px] text-muted-foreground">{t.mcp}</div>
              <div className="text-sm font-medium">{t.title}</div>
            </button>
          ))}
          <p className="pt-2 text-[11px] leading-relaxed text-muted-foreground">
            控制台和 agent 走的是同一份 <span className="font-mono">jevbox/box.mjs</span>，概率不是这里另算的。
          </p>
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            入参
            <Badge variant="secondary" className="font-mono">{tool?.mcp}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[...(tool?.args ?? []), ...(tool?.optArgs ?? [])].map((a) => {
            const optional = tool?.optArgs?.includes(a);
            const value = form[a] ?? "";
            const rows = JSON_ARGS.has(a) ? 10 : LINES_ARGS.has(a) ? 6 : value.length > 60 || a === "trace" || a === "evidence" ? 4 : 2;
            return (
              <div key={a} className="space-y-1">
                <label className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                  {a}
                  {optional && <Badge variant="outline" className="h-4 px-1 text-[9px]">可选</Badge>}
                  {LINES_ARGS.has(a) && <span className="text-[10px]">一行一条</span>}
                </label>
                {NUMBER_ARGS.has(a) ? (
                  <Textarea value={value} onChange={(e) => setForm((f) => ({ ...f, [a]: e.target.value }))} rows={1} className="font-mono text-xs" />
                ) : (
                  <Textarea value={value} onChange={(e) => setForm((f) => ({ ...f, [a]: e.target.value }))} rows={rows} className="font-mono text-xs" />
                )}
              </div>
            );
          })}

          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">采样次数</span>
            {[1, 3, 5].map((n) => (
              <Button key={n} size="sm" variant={sample === n ? "default" : "outline"} className="h-7 w-9 px-0 font-mono text-xs" onClick={() => setSample(n)}>
                {n}
              </Button>
            ))}
            <span className="text-[10px] text-muted-foreground">取中位数压抖动</span>
          </div>

          <Button onClick={() => void run()} disabled={busy} className="w-full">
            {busy && <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
            {busy ? "等待 Jev 返回…" : "调用盒子"}
          </Button>

          {error && (
            <Alert variant="destructive">
              <AlertTitle>{result?.degraded ? "盒子显式不可用" : "调用失败"}</AlertTitle>
              <AlertDescription className="font-mono text-xs">
                {error}
                {result?.hint && <span className="mt-1 block text-[11px]">{result.hint}</span>}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            返回
            {result?.ok && result.tool !== "screen" && <VerdictBadge action={verdictOf(result.tool ?? "", result.v ?? {})} />}
            {result?.patched && <Badge variant="outline" className="border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400">盒子补了 no-match 出口</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!result && <p className="py-8 text-center text-sm text-muted-foreground">选一个工具，点「调用盒子」</p>}

          {result?.ok && result.tool === "screen" && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary">扫了 {result.scanned} 条</Badge>
                <Badge variant="secondary">留下 {result.kept} 条</Badge>
                <Badge variant="outline" className="font-mono">${(result.meta?.cost ?? 0).toFixed(6)}</Badge>
              </div>
              <div className="space-y-1">
                {(result.hits ?? []).map((h) => (
                  <div key={h.i} className="flex items-start gap-2 rounded-md border bg-card/50 px-2 py-1.5">
                    <span className="mt-0.5 font-mono text-[10px] text-muted-foreground">#{h.i}</span>
                    <span className="flex-1 text-xs">{h.preview}</span>
                    <span className="font-mono text-[11px] font-bold tabular-nums text-emerald-600">{h.p.toFixed(2)}</span>
                  </div>
                ))}
                {!(result.hits ?? []).length && <p className="py-4 text-center text-xs text-muted-foreground">没有命中</p>}
              </div>
              {result.note && <p className="text-[11px] leading-relaxed text-muted-foreground">{result.note}</p>}
            </div>
          )}

          {result?.ok && result.tool !== "screen" && result.v && <VectorView v={result.v} />}

          {result && <MetaLine meta={result.meta} />}

          {result && (
            <details className="rounded-md border bg-muted/40 px-2 py-1">
              <summary className="cursor-pointer font-mono text-[11px] text-muted-foreground">原始 JSON</summary>
              <pre className="mt-1 max-h-64 overflow-auto font-mono text-[10px] leading-relaxed">{JSON.stringify(result, null, 2)}</pre>
            </details>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** 和 box.mjs 的 verdictOf 同一套规则；这里只为了在标题上提前显示结论 */
function verdictOf(tool: string, v: Record<string, any>): string | null {
  if (tool === "guardrail") return (v.jailbreak ?? 0) >= 0.5 || (v.leaks_secret ?? 0) >= 0.5 ? "block" : (v.needs_human ?? 0) >= 0.6 ? "human" : "pass";
  if (tool === "route") return v.tier ?? null;
  if (tool === "verify") return v.relation ?? null;
  if (tool === "trace_scan") return v.status ?? null;
  return null;
}
