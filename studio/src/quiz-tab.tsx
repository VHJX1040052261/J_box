import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Ans = { p: number; pred?: string; ok: boolean; brier: number; ms?: number; cost?: number; error?: string };
type Sum = { n: number; correct: number; acc: number | null; brier: number | null; cost: number; ms: number };
type Item = { id: string; kind: string; block: string; question: string; state: string; options: string[] | null };
type State = { total: number; items: Item[]; oracles: Record<string, string | number>; ans: { jev: Record<string, Ans>; me: Record<string, Ans> }; sum: { jev: Sum; me: Sum }; jevBusy: boolean };

const fmt = (x: number | null, d = 2) => (x == null ? "—" : x.toFixed(d));

function Panel({ who, color, sum, busy }: { who: string; color: string; sum: Sum; busy?: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className={`flex items-center justify-between text-sm ${color}`}>
          {who}
          {busy && <Badge variant="secondary">作答中…</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-5 gap-1.5">
          {[
            ["已答", sum.n],
            ["准确率", sum.acc == null ? "—" : `${(sum.acc * 100).toFixed(0)}%`],
            ["Brier↓", fmt(sum.brier, 4)],
            ["均耗时", `${sum.ms}ms`],
            ["花费", `$${sum.cost.toFixed(6)}`],
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-md border px-2 py-1">
              <div className="text-[10px] text-muted-foreground">{k}</div>
              <div className="font-mono text-sm font-semibold tabular-nums">{v}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function QuizTab() {
  const [s, setS] = useState<State | null>(null);
  const [onlyDiff, setOnlyDiff] = useState(false);

  const poll = useCallback(async () => {
    try { setS(await (await fetch("/api/quiz")).json()); } catch { /* 服务重启时会短暂失败，忽略 */ }
  }, []);
  useEffect(() => { void poll(); const t = setInterval(poll, 700); return () => clearInterval(t); }, [poll]);

  if (!s) return <p className="py-10 text-center text-sm text-muted-foreground">载入中…（若一直如此，说明 API 服务未启动）</p>;

  const rows = s.items.filter((it) => !onlyDiff || (s.ans.jev[it.id]?.ok !== s.ans.me[it.id]?.ok));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void fetch("/api/quiz/reset", { method: "POST" }).then(poll)}>重置答题</Button>
        <Button size="sm" variant={onlyDiff ? "default" : "outline"} onClick={() => setOnlyDiff((v) => !v)}>只看分歧</Button>
        <Badge variant="outline">{s.total} 题 · A 存在性 / B 证据关系 / C 句子定位</Badge>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          Jev {s.sum.jev.n}/{s.total} 题 · 我 {s.sum.me.n}/{s.total} 题
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Panel who="Jev（System One · 300ms/题）" color="text-violet-600" sum={s.sum.jev} busy={s.jevBusy && s.sum.jev.n < s.total} />
        <Panel who="Qoder（我的模型逐题判断）" color="text-emerald-600" sum={s.sum.me} busy={s.sum.me.n > 0 && s.sum.me.n < s.total} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">逐题对照</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">题号</TableHead>
                <TableHead>题目</TableHead>
                <TableHead className="w-40">Jev</TableHead>
                <TableHead className="w-40">我</TableHead>
                <TableHead className="w-24 text-center">标准答案</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((it) => {
                const j = s.ans.jev[it.id], m = s.ans.me[it.id];
                const cell = (a?: Ans) => {
                  if (!a) return <span className="text-xs text-muted-foreground">未答</span>;
                  if (a.error) return <span className="text-xs text-red-600">错误：{a.error}</span>;
                  const shown = it.kind === "noul" ? `${a.p.toFixed(2)} → ${a.p >= 0.5 ? "是" : "否"}` : `${a.pred}（把握 ${a.p.toFixed(2)}）`;
                  return (
                    <span className={`font-mono text-xs ${a.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 font-semibold"}`}>
                      {a.ok ? "✓ " : "✗ "}{shown}
                    </span>
                  );
                };
                return (
                  <TableRow key={it.id}>
                    <TableCell className="font-mono text-xs">{it.id}</TableCell>
                    <TableCell className="max-w-md">
                      <div className="truncate text-xs" title={it.state}>{it.state.replace(/\n/g, " ⏎ ")}</div>
                    </TableCell>
                    <TableCell>{cell(j)}</TableCell>
                    <TableCell>{cell(m)}</TableCell>
                    <TableCell className="text-center font-mono text-xs text-muted-foreground">{String(s.oracles[it.id])}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
