import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SourceBadge, VerdictBadge, sourceClass } from "./parts";

type Row = {
  id: string;
  ts: string;
  pack: string;
  source: string | null;
  preview: string;
  action: string | null;
  vector: Record<string, any>;
  tokens: number | null;
  cost: number | null;
  ms: number | null;
  sample: number;
  review: { overturned?: boolean; expect?: string | null; note?: string | null } | null;
};

type Stats = Record<string, { n: number; actions: Record<string, number>; cost: number; p50ms: number | null; reviewed: number; overturned: number; trueErrorRate: number | null }>;

const POLL_MS = 1500;

/**
 * 实时调用流。这一页是「agent 真的在用盒子」的唯一证据：
 * MCP server、CLI、控制台三个进程写的是同一个 jevbox/audit.jsonl，
 * 所以 agent 在它自己的会话里调一次 jev_guardrail，这里 1.5 秒内就冒出一行 source=agent·MCP。
 */
export function StreamTab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [stats, setStats] = useState<Stats>({});
  const [total, setTotal] = useState(0);
  const [live, setLive] = useState(true);
  const seen = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!live) return;
    let stopped = false;
    const tick = async () => {
      try {
        const [a, s] = await Promise.all([
          fetch("/api/audit?limit=80").then((r) => r.json()),
          fetch("/api/stats").then((r) => r.json()),
        ]);
        if (stopped) return;
        const incoming: Row[] = a.rows ?? [];
        const added = incoming.filter((r) => !seen.current.has(r.id)).map((r) => r.id);
        for (const id of added) seen.current.add(id);
        if (added.length) {
          setFresh(new Set(added));
          setTimeout(() => setFresh(new Set()), 2400);
        }
        setRows(incoming);
        setTotal(a.total ?? 0);
        setStats(s ?? {});
      } catch {
        // 后端没起来时不刷屏，下一轮再试
      }
    };
    void tick();
    const t = setInterval(tick, POLL_MS);
    return () => { stopped = true; clearInterval(t); };
  }, [live]);

  async function review(id: string, overturned: boolean) {
    await fetch("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, overturned }),
    });
    const s = await fetch("/api/stats").then((r) => r.json());
    setStats(s);
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, review: { ...(r.review ?? {}), overturned } } : r)));
  }

  const bySource = rows.reduce<Record<string, number>>((acc, r) => {
    const cls = sourceClass(r.source);
    acc[cls] = (acc[cls] ?? 0) + 1;
    return acc;
  }, {});

  const totals = Object.values(stats).reduce(
    (acc, s) => ({ n: acc.n + s.n, cost: acc.cost + s.cost, reviewed: acc.reviewed + s.reviewed, overturned: acc.overturned + s.overturned }),
    { n: 0, cost: 0, reviewed: 0, overturned: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="累计调用" value={String(totals.n)} hint={`审计文件共 ${total} 行`} />
        <Stat label="累计花费" value={`$${totals.cost.toFixed(6)}`} hint="$0.042 / 百万 input token" />
        <Stat label="人工复核" value={String(totals.reviewed)} hint="点每行的 认可 / 推翻" />
        <Stat
          label="真实被推翻率"
          value={totals.reviewed ? `${((totals.overturned / totals.reviewed) * 100).toFixed(1)}%` : "—"}
          hint={totals.reviewed ? `${totals.overturned} 条被推翻` : "没有复核数据就算不出错误率"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            实时调用流
            <Badge variant="outline" className="font-mono">每 {POLL_MS} ms 拉一次</Badge>
            <span className="ml-auto flex items-center gap-2">
              <span className={`inline-block h-2 w-2 rounded-full ${live ? "animate-pulse bg-emerald-500" : "bg-muted-foreground"}`} />
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setLive((v) => !v)}>{live ? "暂停" : "继续"}</Button>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">source 这一列是关键</span>：
            标 <SourceBadge source="mcp" /> 的行不是控制台发出的，是 agent 在它自己的会话里通过 MCP 调的 ——
            三个入口写同一个审计文件，所以这里能直接看见接入是否真的生效。
          </p>

          {/*
            接入存活计数。加它是因为同一类事故连着犯了两次：MCP 配置写好、codex 钩子装好，
            两边都「看起来正常」，实际一个调用都没进来 —— 而页面只显示「有 127 行」，看不出来源。
            未信任的 codex 钩子会被静默跳过，不报错也不留痕，所以「没行」必须被显式说出来。
          */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {(["mcp", "harness", "cli", "console"] as const).map((cls) => {
              const n = bySource[cls] ?? 0;
              const external = cls === "mcp" || cls === "harness";
              return (
                <span key={cls} className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${n === 0 && external ? "border-amber-500/50 bg-amber-500/10" : "border-border"}`}>
                  <SourceBadge source={cls} />
                  <span className="font-mono tabular-nums">{n}</span>
                </span>
              );
            })}
            {!(bySource.mcp > 0) && !(bySource.harness > 0) && (
              <span className="text-[11px] text-amber-700 dark:text-amber-400">
                最近 {rows.length} 行里没有任何 agent / 钩子来源 —— 若你刚配好接入，这通常意味着它没真的生效（MCP 要 <span className="font-mono">/mcp reload</span>；codex 钩子要过信任闸门），而不是「今天刚好没调用」。
              </span>
            )}
          </div>
          {!rows.length && <p className="py-10 text-center text-sm text-muted-foreground">还没有调用记录。去「工具台」点一次，或者让 agent 调一个 jev_ 工具。</p>}
          {rows.length > 0 && (
            <div className="max-h-[560px] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">时间</TableHead>
                    <TableHead className="w-28">来源</TableHead>
                    <TableHead className="w-28">工具</TableHead>
                    <TableHead>输入摘要</TableHead>
                    <TableHead className="w-28">结论</TableHead>
                    <TableHead className="w-44">概率</TableHead>
                    <TableHead className="w-24 text-right">成本</TableHead>
                    <TableHead className="w-32 text-right">复核</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id} className={fresh.has(r.id) ? "bg-emerald-500/10" : undefined}>
                      <TableCell className="font-mono text-[10px] text-muted-foreground">{r.ts.slice(11, 19)}</TableCell>
                      <TableCell><SourceBadge source={r.source} /></TableCell>
                      <TableCell className="font-mono text-[11px]">{r.pack.replace("box:", "jev_")}</TableCell>
                      <TableCell className="max-w-[320px] truncate text-xs" title={r.preview}>{r.preview}</TableCell>
                      <TableCell><VerdictBadge action={r.action} /></TableCell>
                      <TableCell className="font-mono text-[10px] text-muted-foreground">{probsOf(r.vector)}</TableCell>
                      <TableCell className="text-right font-mono text-[10px] tabular-nums text-muted-foreground">
                        {r.cost != null ? `$${r.cost.toFixed(6)}` : "—"}
                        {r.ms != null && <span className="block">{r.ms} ms</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.review?.overturned != null ? (
                          <Badge variant="outline" className={r.review.overturned ? "border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-400" : "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"}>
                            {r.review.overturned ? "已推翻" : "已认可"}
                          </Badge>
                        ) : (
                          <span className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => void review(r.id, false)}>认可</Button>
                            <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => void review(r.id, true)}>推翻</Button>
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {Object.keys(stats).length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">按工具汇总</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>工具</TableHead>
                  <TableHead className="text-right">次数</TableHead>
                  <TableHead>动作分布</TableHead>
                  <TableHead className="text-right">p50 延迟</TableHead>
                  <TableHead className="text-right">花费</TableHead>
                  <TableHead className="text-right">被推翻率</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(stats).map(([k, s]) => (
                  <TableRow key={k}>
                    <TableCell className="font-mono text-[11px]">{k.replace("box:", "jev_")}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{s.n}</TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">{Object.entries(s.actions).map(([a, n]) => `${a}×${n}`).join("  ")}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{s.p50ms ?? "—"} ms</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">${s.cost.toFixed(6)}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{s.trueErrorRate != null ? `${(s.trueErrorRate * 100).toFixed(1)}%` : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className="font-mono text-2xl font-semibold tabular-nums">{value}</div>
        <div className="mt-1 text-[10px] leading-snug text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}

/** 一行里塞不下完整分布，只留最能说明问题的几个数 */
function probsOf(v: Record<string, any> | null): string {
  if (!v) return "—";
  const parts: string[] = [];
  for (const [k, val] of Object.entries(v)) {
    if (k.endsWith("_probs") || k.endsWith("_conf")) continue;
    if (typeof val === "number") parts.push(`${k} ${val.toFixed(2)}`);
    else if (typeof val === "string") parts.push(`${k}=${val}`);
    if (parts.length >= 3) break;
  }
  return parts.join("  ") || "—";
}
