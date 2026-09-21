import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DEFAULTS, EXPECT_RUNG, THRESHOLD_META, decide } from "@policy";
import { RungBadge, Trace, type Thresholds, type Vector } from "./parts";

type Item = { msg: string; expect: string; v: Vector | null };

export function BatchTab({ items, thresholds, setThresholds }: {
  items: Item[];
  thresholds: Thresholds;
  setThresholds: (t: Thresholds) => void;
}) {
  const judged = useMemo(
    () => items.map((it) => (it.v ? { ...it, verdict: decide(it.v, thresholds) } : null)).filter(Boolean) as (Item & { verdict: ReturnType<typeof decide> })[],
    [items, thresholds],
  );

  const stats = useMemo(() => {
    const s = { code: 0, llm: 0, human: 0, danger: 0, waste: 0, matched: 0 };
    for (const r of judged) {
      const want = EXPECT_RUNG[r.expect as keyof typeof EXPECT_RUNG];
      s[r.verdict.rung as "code" | "llm" | "human"]++;
      if (r.verdict.rung === want) s.matched++;
      if (r.expect === "human" && r.verdict.rung !== "human") s.danger++;
      if (r.expect === "specialist" && r.verdict.rung === "code") s.danger++;
      if (r.expect === "auto" && r.verdict.rung === "human") s.waste++;
      if (r.expect === "specialist" && r.verdict.rung === "human") s.waste++;
      if (r.expect === "auto" && r.verdict.rung === "llm") s.waste++;
    }
    return { ...s, n: judged.length };
  }, [judged]);

  const ready = items.filter((i) => i.v).length;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              阈值
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => setThresholds({ ...DEFAULTS })}>重置</Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {THRESHOLD_META.map((meta) => {
              const key = meta.key as keyof Thresholds;
              return (
              <div key={meta.key} className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help text-xs underline decoration-dotted">{meta.label}</span>
                    </TooltipTrigger>
                    <TooltipContent side="right">{meta.hint}</TooltipContent>
                  </Tooltip>
                  <span className="font-mono text-sm tabular-nums">{thresholds[key].toFixed(2)}</span>
                </div>
                <Slider
                  min={meta.min} max={meta.max} step={meta.step}
                  value={[thresholds[key]]}
                  onValueChange={([val]) => setThresholds({ ...thresholds, [key]: val })}
                />
              </div>
              );
            })}
            <Separator />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              拖动时重新判定的是本地缓存的 {ready} 条原始判断，<span className="font-medium text-foreground">不产生任何 API 调用</span>。
              这就是把判断题与阈值分开的收益。
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">当前分流</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex h-3 overflow-hidden rounded-full bg-muted">
              {(["code", "llm", "human"] as const).map((k) => (
                <div
                  key={k}
                  className={k === "code" ? "bg-emerald-500" : k === "llm" ? "bg-sky-500" : "bg-amber-500"}
                  style={{ width: `${(stats[k] / Math.max(stats.n, 1)) * 100}%` }}
                  title={`${k} ${stats[k]}`}
                />
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {(["code", "llm", "human"] as const).map((k) => (
                <div key={k} className="rounded-md border py-1.5">
                  <div className="font-mono text-lg leading-none tabular-nums">{stats[k]}</div>
                  <div className="mt-1 text-[10px] text-muted-foreground">{k === "code" ? "自动" : k === "llm" ? "专家" : "人工"}</div>
                </div>
              ))}
            </div>
            <Separator />
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">越权自动化（危险）</span>
                <span className={`font-mono font-semibold ${stats.danger ? "text-red-600" : "text-emerald-600"}`}>{stats.danger}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">过度升级（浪费人力）</span>
                <span className={`font-mono font-semibold ${stats.waste ? "text-amber-600" : "text-emerald-600"}`}>{stats.waste}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">与标注期望一致</span>
                <span className="font-mono font-semibold">{stats.matched}/{stats.n}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            标注用例逐条判定
            <Badge variant="secondary">{ready}/{items.length} 条已有判断</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>工单</TableHead>
                <TableHead className="text-right">conf</TableHead>
                <TableHead className="text-right">难度</TableHead>
                <TableHead className="text-right">裁量</TableHead>
                <TableHead className="text-right">高危</TableHead>
                <TableHead className="text-center">期望</TableHead>
                <TableHead className="text-center">判定</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it, i) => {
                const row = judged.find((j) => j.msg === it.msg);
                const want = EXPECT_RUNG[it.expect as keyof typeof EXPECT_RUNG];
                return (
                  <TableRow key={i}>
                    <TableCell className="max-w-[280px]">
                      <div className="truncate text-xs">{it.msg}</div>
                      {row && (
                        <div className="mt-1 space-y-1 text-[10px] text-muted-foreground">
                          <div className="truncate font-mono">intent={row.v!.choice} · {row.verdict.why}</div>
                          <Trace gates={row.verdict.trace} />
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{it.v ? it.v.conf.toFixed(2) : "—"}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{it.v ? it.v.effort.toFixed(2) : "—"}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{it.v ? it.v.discretion.toFixed(2) : "—"}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{it.v ? it.v.high_stakes.toFixed(2) : "—"}</TableCell>
                    <TableCell className="text-center">
                      <RungBadge rung={want} />
                      <div className="mt-1 text-[10px] text-muted-foreground">{it.expect}</div>
                    </TableCell>
                    <TableCell className="text-center">
                      {row ? (
                        <>
                          <RungBadge rung={row.verdict.rung} />
                          <div className={`mt-1 text-[10px] font-medium ${row.verdict.rung === want ? "text-emerald-600" : "text-amber-600"}`}>
                            {row.verdict.rung === want ? "一致" : "偏离"}
                          </div>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">无判断</span>
                      )}
                    </TableCell>
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
