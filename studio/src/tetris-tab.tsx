import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  COLORS, COLS, ROWS, emptyBoard, heuristicPick, lock, clearLines,
  placements, profile, randomBag,
} from "@engine";

type Cand = { id: string; rot: number; col: number; row: number; cells: number[][]; cleared: number; holes: number; bumpiness: number; aggregate: number; max: number };
type JevMove = { choice: string; confidence: number; probabilities: Record<string, number> };
type Phase = "idle" | "thinking" | "chosen" | "over";
type Driver = "jev" | "baseline" | "manual";

const CELL = 22;

export function TetrisTab() {
  const [board, setBoard] = useState(emptyBoard());
  const [queue, setQueue] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [cands, setCands] = useState<Cand[]>([]);
  const [shape, setShape] = useState("");
  const [move, setMove] = useState<JevMove | null>(null);
  const [risky, setRisky] = useState(0);
  const [baselineId, setBaselineId] = useState("");
  const [running, setRunning] = useState(false);
  const [driver, setDriver] = useState<Driver>("jev");
  const [gap, setGap] = useState(500);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [st, setSt] = useState({ pieces: 0, lines: 0, score: 0, tokens: 0, cost: 0, agree: 0, asks: 0, lats: [] as number[] });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const askRef = useRef(0);
  const boardRef = useRef(board);
  boardRef.current = board;

  const reset = useCallback(() => {
    setBoard(emptyBoard()); setQueue([]); setCands([]); setMove(null); setPhase("idle");
    setRunning(false); setError(null); setLog([]); setShape(""); setRisky(0); setBaselineId("");
    askRef.current = 0;
    setSt({ pieces: 0, lines: 0, score: 0, tokens: 0, cost: 0, agree: 0, asks: 0, lats: [] });
  }, []);

  const applyMove = useCallback((c: Cand, s: string) => {
    const landed = clearLines(lock(boardRef.current, c.cells, c.row, c.col, s));
    setBoard(landed.board);
    setSt((p) => ({
      ...p,
      pieces: p.pieces + 1,
      lines: p.lines + c.cleared,
      score: p.score + [0, 100, 300, 500, 800][c.cleared] * (1 + Math.floor(p.lines / 10)),
    }));
    setCands([]); setMove(null);
  }, []);

  // 出块 → 代码枚举合法落点 → 交给 Jev 选
  const spawn = useCallback(() => {
    let q = queue.length ? [...queue] : randomBag();
    if (q.length < 2) q = [...q, ...randomBag()];
    const s = q.shift()!;
    const next = q.shift()!;
    setQueue(q); setShape(s);
    const list = placements(boardRef.current, s);
    if (!list.length) { setPhase("over"); setRunning(false); return; }
    setCands(list);
    setPhase("thinking");
    void (async () => {
      const t0 = Date.now();
      try {
        const res = await fetch("/api/tetris-move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ board: boardRef.current, shape: s, next, cands: list }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        const ms = Date.now() - t0;
        setMove(body.move); setRisky(body.risky); setBaselineId(body.baseline);
        setSt((p) => ({
          ...p,
          asks: p.asks + 1,
          tokens: p.tokens + body.meta.usage.input_tokens,
          cost: p.cost + body.meta.cost,
          agree: p.agree + (body.move.choice === body.baseline ? 1 : 0),
          lats: [...p.lats, ms].slice(-60),
        }));
        setLog((p) => [
          `#${++askRef.current} ${s} → ${body.move.choice}（基线 ${body.baseline}${body.move.choice === body.baseline ? " 一致" : " 分歧"}）conf ${body.move.confidence.toFixed(2)} · ${ms}ms · ${body.meta.usage.input_tokens}tok`,
          ...p,
        ].slice(0, 12));
        setPhase("chosen");
      } catch (e) {
        setError((e as Error).message); setPhase("over"); setRunning(false);
      }
    })();
  }, [queue]);

  useEffect(() => {
    if (phase === "idle" && running) spawn();
  }, [phase, running, spawn]);

  useEffect(() => {
    if (phase !== "chosen" || !running || driver === "manual" || !move) return;
    const id = driver === "jev" ? move.choice : baselineId;
    const c = cands.find((x) => x.id === id);
    if (!c) return;
    const t = setTimeout(() => { applyMove(c, shape); setPhase("idle"); }, gap);
    return () => clearTimeout(t);
  }, [phase, running, driver, move, baselineId, cands, shape, gap, applyMove]);

  function draw() {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = "#0a0a0a"; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) ctx.strokeRect(c * CELL, r * CELL, CELL, CELL);
    const paint = (r: number, c: number, color: string, alpha = 1) => {
      ctx.globalAlpha = alpha; ctx.fillStyle = color;
      ctx.fillRect(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2);
      ctx.globalAlpha = 1;
    };
    board.forEach((row, r) => row.forEach((s, c) => s && paint(r, c, COLORS[s as keyof typeof COLORS])));
    const chosen = move && driver !== "baseline" ? cands.find((x) => x.id === move.choice) : cands.find((x) => x.id === baselineId);
    if (chosen && phase === "chosen") chosen.cells.forEach(([dr, dc]) => { const r = chosen.row + dr; if (r >= 0) paint(r, chosen.col + dc, "#ffffff", 0.3); });
  }
  useEffect(draw, [board, cands, move, baselineId, phase, shape, driver]);

  const lats = [...st.lats].sort((a, b) => a - b);
  const p50 = lats[Math.floor(lats.length * 0.5)] ?? 0;
  const p95 = lats[Math.floor(lats.length * 0.95)] ?? 0;
  const prof = profile(board);
  const nextShape = queue[0] ?? "—";

  return (
    <div className="grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            盘面
            <Badge variant={phase === "thinking" ? "default" : "secondary"}>
              {phase === "thinking" ? "Jev 思考中…" : phase === "chosen" ? (driver === "manual" ? "等你选" : "落子") : phase === "over" ? "已结束" : "待命"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <canvas ref={canvasRef} width={COLS * CELL} height={ROWS * CELL} className="rounded-md border" />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">下一块</span>
            <span className="inline-block h-5 w-5 rounded-sm" style={{ background: COLORS[nextShape as keyof typeof COLORS] ?? "transparent" }} />
            <span className="font-mono text-sm">{nextShape}</span>
            {phase === "thinking" && <span className="ml-auto inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setRunning((r) => !r)} disabled={phase === "over"}>{running ? "暂停" : "开始"}</Button>
            <Button size="sm" variant="outline" onClick={reset}>重置</Button>
            <Button size="sm" variant="outline" onClick={() => { setRunning(false); spawn(); }} disabled={phase === "thinking" || phase === "over"}>单步问一次</Button>
          </div>
          <div className="flex gap-1">
            {(["jev", "baseline", "manual"] as Driver[]).map((d) => (
              <Button key={d} size="sm" variant={driver === d ? "default" : "outline"} className="flex-1 text-[11px]" onClick={() => setDriver(d)}>
                {d === "jev" ? "Jev 驱动" : d === "baseline" ? "启发式驱动" : "人工挑选"}
              </Button>
            ))}
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-muted-foreground"><span>每块间隔</span><span className="font-mono">{gap}ms</span></div>
            <Slider min={0} max={2000} step={50} value={[gap]} onValueChange={([v]) => setGap(v)} />
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertTitle>出错</AlertTitle>
              <AlertDescription className="font-mono text-xs">{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["块数", st.pieces], ["消行", st.lines], ["得分", st.score],
            ["花费", `$${st.cost.toFixed(5)}`],
            ["token", st.tokens], ["p50 / p95", `${p50}/${p95}ms`],
            ["与基线一致", `${st.agree}/${st.asks}`], ["洞 / 最高列", `${prof.holes}/${prof.max}`],
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-lg border bg-card p-2.5">
              <div className="text-[10px] text-muted-foreground">{k}</div>
              <div className="font-mono text-base font-semibold tabular-nums">{v}</div>
            </div>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              代码枚举出的 {cands.length} 个合法落点
              {move && <span className="font-mono text-xs text-muted-foreground">risky noul = {risky.toFixed(2)}</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {!move && <p className="py-6 text-center text-sm text-muted-foreground">还没有 Jev 的分布</p>}
            {cands.map((c) => {
              const prob = move?.probabilities[c.id] ?? 0;
              const isJev = move?.choice === c.id;
              const isBase = baselineId === c.id;
              return (
                <button
                  key={c.id}
                  disabled={!move}
                  onClick={() => { if (driver === "manual" && move) { applyMove(c, shape); setPhase("idle"); } }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors ${driver === "manual" && move ? "hover:bg-accent" : ""}`}
                >
                  <span className="w-12 shrink-0 font-mono">{c.id}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className={`h-full rounded-full transition-all duration-500 ${isJev ? "bg-primary" : "bg-primary/25"}`} style={{ width: `${Math.max(prob * 100, 0.5)}%` }} />
                  </div>
                  <span className="w-10 shrink-0 text-right font-mono tabular-nums">{prob.toFixed(2)}</span>
                  <span className="w-28 shrink-0 font-mono text-[10px] text-muted-foreground">
                    洞{c.holes} 凸{c.bumpiness} 高{c.max} 消{c.cleared}
                  </span>
                  <span className="flex w-16 shrink-0 gap-1">
                    {isJev && <Badge variant="default" className="h-4 px-1 text-[9px]">Jev</Badge>}
                    {isBase && <Badge variant="outline" className="h-4 px-1 text-[9px]">基线</Badge>}
                  </span>
                </button>
              );
            })}
            <Separator className="my-2" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              候选由代码穷举并去重（相同结果盘面只留一个），每个选项的描述里带<strong>落子后的 ASCII 盘面</strong>与洞数、凸起度、最高列 ——
              这些算数 Jev 不做，它只做「哪个更好」这一判断。
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">决策日志</CardTitle></CardHeader>
          <CardContent>
            {!log.length ? <p className="py-4 text-center text-sm text-muted-foreground">尚无记录</p> : (
              <ul className="space-y-1">
                {log.map((l, i) => <li key={i} className={`font-mono text-[11px] ${i === 0 ? "text-foreground" : "text-muted-foreground"}`}>{l}</li>)}
              </ul>
            )}
          </CardContent>
        </Card>

        <Tooltip>
          <TooltipTrigger asChild>
            <p className="cursor-help text-[11px] underline decoration-dotted">为什么 Jev 的 confidence 这么低？</p>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-sm">
            14 个候选里往往有好几个都算合理，概率被摊薄，confidence 自然低。这不代表它选错了 —— confidence 衡量的是分布集中程度，不是对错。
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
