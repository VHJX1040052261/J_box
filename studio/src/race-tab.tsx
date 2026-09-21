import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Slider } from "@/components/ui/slider";
import { COLORS, COLS, ROWS, pieceCells } from "@engine";

type Cand = { id: string; rot: number; col: number; cleared: number; holes: number; heights: number[]; bumpiness: number; aggregate: number; max: number };
type Anim = { piece: string; rot: number; col: number; fromRow: number; toRow: number; offsets: number[][]; clearedRows: number[]; seq: number };
type Snap = {
  name: string; board: (string | null)[][]; piece: string | null; next: string | null;
  pieces: number; lines: number; score: number; over: boolean; reason: string;
  holes: number; max: number; bumpiness: number; heights: number[];
  asks: number; cost: number; confAvg: number | null; riskyAvg: number | null;
  last: any; lastMove: { id: string; rot: number; cells: number[][]; cleared: number; piece: string } | null;
  anim: Anim | null; cands: Cand[]; autoId: string | null;
};

const CELL = 20;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Canvas({ board, piece, flash }: {
  board: (string | null)[][];
  piece: { cells: number[][]; kind: string } | null;
  flash: number[][] | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    ctx.fillStyle = "#0a0a0a"; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) ctx.strokeRect(c * CELL, r * CELL, CELL, CELL);
    const box = (r: number, c: number, color: string, alpha = 1) => {
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
      ctx.globalAlpha = alpha; ctx.fillStyle = color;
      ctx.fillRect(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2);
      ctx.globalAlpha = 1;
    };
    board.forEach((row, r) => row.forEach((s, c) => s && box(r, c, COLORS[s as keyof typeof COLORS] ?? "#888")));
    piece?.cells.forEach(([r, c]) => box(r, c, COLORS[piece.kind as keyof typeof COLORS] ?? "#888", 0.95));
    flash?.forEach(([r, c]) => box(r, c, "#ffffff", 0.85));
  }, [board, piece, flash]);
  return <canvas ref={ref} width={COLS * CELL} height={ROWS * CELL} className="rounded-md border" />;
}

/** 把一步落子演成「出生 → 旋转到目标朝向 → 逐行下落 → 锁定」。seq 用于丢弃被更新一步取代的旧动画。 */
function PlayerPanel({ snap, title, tone, speed }: { snap: Snap; title: string; tone: string; speed: number }) {
  const [view, setView] = useState<{ board: (string | null)[][]; piece: { cells: number[][]; kind: string } | null; flash: number[][] | null }>({ board: snap.board, piece: null, flash: null });
  const prevRef = useRef(snap);
  const seqRef = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = snap;
    if (snap.pieces > prev.pieces && snap.anim && snap.pieces - prev.pieces === 1) {
      void run(prev.board, snap);
    } else if (!busyRef.current) {
      setView({ board: snap.board, piece: null, flash: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap]);

  async function run(oldBoard: (string | null)[][], s: Snap) {
    const a = s.anim!;
    const my = ++seqRef.current;
    busyRef.current = true;
    const at = (row: number, offsets: number[][]) => ({ cells: offsets.map(([r, c]) => [r + row, a.col + c]), kind: a.piece });
    // 不管掉 6 行还是 20 行，整段动画都归一化到约 0.8s，否则近距离看不清、远距离会堆积滞后
    const rows = Math.max(1, a.toRow - a.fromRow);
    const per = Math.max(16, Math.min(speed, Math.round((speed * 6) / rows)));

    setView({ board: oldBoard, piece: at(a.fromRow, pieceCells(a.piece, 0)), flash: null });
    await sleep(per * 2); if (my !== seqRef.current) return;

    setView({ board: oldBoard, piece: at(a.fromRow, a.offsets), flash: null });
    await sleep(per * 2); if (my !== seqRef.current) return;

    for (let row = a.fromRow; row < a.toRow; row++) {
      setView({ board: oldBoard, piece: at(row + 1, a.offsets), flash: null });
      await sleep(per); if (my !== seqRef.current) return;
    }

    setView({ board: s.board, piece: null, flash: s.lastMove?.cells ?? null });
    await sleep(a.clearedRows.length ? per * 8 : per * 2);
    if (my !== seqRef.current) return;
    setView({ board: s.board, piece: null, flash: null });
    busyRef.current = false;
  }

  const lm = snap.lastMove;
  return (
    <Card>
      <CardHeader>
        <CardTitle className={`flex items-center justify-between text-sm ${tone}`}>
          {title}
          <Badge variant={snap.over ? "destructive" : view.piece ? "default" : "secondary"}>
            {snap.over ? `已顶出 · ${snap.reason}` : view.piece ? "下落中" : "进行中"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex justify-center"><Canvas {...view} /></div>
        <div className="grid grid-cols-4 gap-1.5">
          {[
            ["块数", snap.pieces, ""], ["消行", snap.lines, ""], ["得分", snap.score, ""],
            ["洞", snap.holes, snap.holes > 8 ? "text-red-600" : snap.holes > 3 ? "text-amber-600" : ""],
            ["最高列", snap.max, snap.max > 12 ? "text-red-600" : ""], ["凸起", snap.bumpiness, ""],
            ["当前/下一", `${snap.piece ?? "—"}→${snap.next ?? "—"}`, ""],
            [title.startsWith("Jev") ? "花费" : "conf", title.startsWith("Jev") ? `$${snap.cost.toFixed(5)}` : snap.confAvg != null ? snap.confAvg.toFixed(2) : "—", ""],
          ].map(([k, v, t]) => (
            <div key={String(k)} className="rounded-md border px-2 py-1">
              <div className="text-[10px] text-muted-foreground">{k}</div>
              <div className={`font-mono text-sm font-semibold tabular-nums ${t}`}>{v}</div>
            </div>
          ))}
        </div>
        {lm && (
          <div className="flex items-center gap-2 rounded-md bg-muted/60 p-2 font-mono text-[11px]">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: COLORS[lm.piece as keyof typeof COLORS] }} />
            本步 {lm.piece} 旋转 <b>r{lm.rot}</b> → {lm.id}
            {lm.cleared > 0 && <b className="text-emerald-600"> 消 {lm.cleared} 行</b>}
            {snap.last?.conf != null && <span className="ml-auto text-muted-foreground">conf {snap.last.conf.toFixed(2)} · risky {snap.last.risky?.toFixed(2)} · {snap.last.ms}ms</span>}
          </div>
        )}
        {snap.last?.error && <div className="font-mono text-[11px] text-red-600">错误：{snap.last.error}</div>}
      </CardContent>
    </Card>
  );
}

export function RaceTab() {
  const [jev, setJev] = useState<Snap | null>(null);
  const [me, setMe] = useState<Snap | null>(null);
  const [busy, setBusy] = useState(false);
  const [pilot, setPilot] = useState(false);
  const [speed, setSpeed] = useState(120);
  const [err, setErr] = useState<string | null>(null);
  const pilotRef = useRef(pilot);
  pilotRef.current = pilot;

  const poll = useCallback(async () => {
    try {
      const r = await fetch("/api/race");
      const d = await r.json();
      setJev(d.jev); setMe(d.me); setBusy(Boolean(d.jevBusy));
      if (pilotRef.current && !d.me.over && d.me.autoId) {
        await fetch("/api/race/move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: d.me.autoId }) });
      }
    } catch (e) { setErr(String((e as Error).message)); }
  }, []);

  useEffect(() => {
    void poll();
    const t = setInterval(poll, 400);
    return () => clearInterval(t);
  }, [poll]);

  async function move(id: string) {
    const r = await fetch("/api/race/move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (!r.ok) { const b = await r.json(); setErr(b.error ?? `HTTP ${r.status}`); return; }
    setErr(null); void poll();
  }

  const verdict = jev && me
    ? jev.over && me.over ? "两局都结束了"
      : jev.over ? `Jev 已顶出（${jev.pieces} 块），我方仍在下（${me.pieces} 块）`
      : me.over ? `我方已顶出（${me.pieces} 块），Jev 仍在下（${jev.pieces} 块）`
      : me.pieces > jev.pieces ? `我方领先 ${me.pieces - jev.pieces} 块` : jev.pieces > me.pieces ? `Jev 领先 ${jev.pieces - me.pieces} 块` : "并列"
    : "载入中";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void fetch("/api/race/reset", { method: "POST" }).then(poll)}>重开两局</Button>
        <Button size="sm" variant={pilot ? "default" : "outline"} onClick={() => setPilot((p) => !p)}>{pilot ? "代打中（公式，不是我）" : "启发式代打"}</Button>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">动画速度</span>
          <Slider className="w-28" min={40} max={400} step={20} value={[speed]} onValueChange={([v]) => setSpeed(v)} />
          <span className="font-mono text-[11px]">{speed === 40 ? "快" : speed === 400 ? "慢" : `${speed}`}</span>
        </div>
        {busy && <Badge variant="secondary">Jev 思考中</Badge>}
        <span className="ml-auto text-sm font-medium">{verdict}</span>
      </div>

      {err && (
        <Alert variant="destructive">
          <AlertTitle>落子被拒</AlertTitle>
          <AlertDescription className="font-mono text-xs">{err}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {jev && <PlayerPanel snap={jev} title="Jev（System One 模型）" tone="text-violet-600" speed={speed} />}
        {me && <PlayerPanel snap={me} title={pilot ? "启发式公式代打（不是我）" : "Qoder（我的模型逐子推理）"} tone="text-emerald-600" speed={speed} />}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            我方当前块 {me?.piece ?? "—"} 的 {me?.cands.length ?? 0} 个合法落点
            <span className="ml-2 text-xs font-normal text-muted-foreground">含 4 个旋转 × 各列；点一行即替我落子</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-1 sm:grid-cols-2">
            {(me?.cands ?? []).map((c) => (
              <button key={c.id} onClick={() => void move(c.id)} className="flex items-center gap-2 rounded-md border px-2 py-1 text-left text-xs hover:bg-accent">
                <span className="w-12 shrink-0 font-mono">{c.id}</span>
                <span className="w-16 shrink-0">消{c.cleared} 洞{c.holes}</span>
                <span className="w-12 shrink-0">凸{c.bumpiness}</span>
                <span className="w-10 shrink-0">高{c.max}</span>
                <span className="flex-1 truncate font-mono text-[10px] text-muted-foreground">{c.heights.join("")}</span>
                {me?.autoId === c.id && <Badge variant="outline" className="h-4 shrink-0 px-1 text-[9px]">启发式</Badge>}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
