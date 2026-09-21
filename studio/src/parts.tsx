import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { RUNG_LABEL, DEFAULTS } from "@policy";

export type Thresholds = typeof DEFAULTS;

export type Vector = {
  unknown: boolean;
  choice: string;
  conf: number;
  probabilities: Record<string, number>;
  effort: number;
  effortProbabilities: Record<string, number>;
  discretion: number;
  discretionProbabilities: Record<string, number>;
  high_stakes: number;
  urgent: number;
};

export type Gate = { pass: boolean; text: string };

export const RUNG_STYLE: Record<string, string> = {
  code: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/40",
  llm: "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/40",
  human: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40",
};

export function RungBadge({ rung }: { rung: string }) {
  return (
    <Badge variant="outline" className={RUNG_STYLE[rung]}>
      {RUNG_LABEL[rung as keyof typeof RUNG_LABEL] ?? rung}
    </Badge>
  );
}

export function Bars({ data, winner }: { data: Record<string, number>; winner?: string }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-1.5">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-2">
          <span className={`w-16 shrink-0 text-right font-mono text-[11px] ${k === winner ? "font-bold text-foreground" : "text-muted-foreground"}`}>{k}</span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all duration-500 ${k === winner ? "bg-primary" : "bg-primary/35"}`}
              style={{ width: `${Math.max(v * 100, 1)}%` }}
            />
          </div>
          <span className="w-11 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{v.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

export function ScoreRow({ label, score, probs, levels }: { label: string; score: number; probs: Record<string, number>; levels: string[] }) {
  return (
    <div className="space-y-2 rounded-lg border bg-card/50 p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="font-mono text-lg font-semibold tabular-nums">{score.toFixed(2)}</span>
      </div>
      <div className="relative h-2 rounded-full bg-muted">
        {levels.map((_, i) => (
          <span key={i} className="absolute top-[-3px] h-4 w-px bg-border" style={{ left: `${(i / (levels.length - 1)) * 100}%` }} />
        ))}
        <span
          className="absolute top-[-5px] h-4 w-[3px] -translate-x-1/2 rounded-full bg-primary shadow"
          style={{ left: `${(score / (levels.length - 1)) * 100}%` }}
        />
      </div>
      <div className="space-y-1">
        {levels.map((lv, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-4 shrink-0 text-right font-mono text-[10px] text-muted-foreground">{i}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary/30" style={{ width: `${Math.max((probs?.[String(i)] ?? 0) * 100, 1)}%` }} />
            </div>
            <span className="flex-1 truncate text-[11px] text-muted-foreground" title={lv}>{lv}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Probability({ label, value, warn = 0.7 }: { label: string; value: number; warn?: number }) {
  const hot = value > warn;
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full transition-all duration-500 ${hot ? "bg-amber-500" : "bg-primary/40"}`} style={{ width: `${Math.max(value * 100, 1)}%` }} />
      </div>
      <span className={`w-11 shrink-0 font-mono text-[11px] tabular-nums ${hot ? "font-bold text-amber-600" : "text-muted-foreground"}`}>{value.toFixed(2)}</span>
    </div>
  );
}

export function Trace({ gates }: { gates: Gate[] }) {
  return (
    <ol className="space-y-1">
      {gates.map((g, i) => (
        <li key={i} className="flex items-start gap-2 text-xs">
          <span className={`mt-0.5 font-mono ${g.pass ? "text-emerald-600" : "text-amber-600"}`}>{g.pass ? "✓" : "✗"}</span>
          <span className={g.pass ? "text-muted-foreground" : "font-medium text-foreground"}>{g.text}</span>
        </li>
      ))}
    </ol>
  );
}

export function MetaLine({ usage, ms, model }: { usage?: { input_tokens: number; output_tokens: number }; ms: number; model: string }) {
  if (!usage) return null;
  return (
    <>
      <Separator className="my-3" />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
        <span>model {model}</span>
        <span>in {usage.input_tokens} tok</span>
        <span>out {usage.output_tokens} tok（无文本）</span>
        <span>${((usage.input_tokens / 1e6) * 0.042).toFixed(7)}</span>
        <span>{ms} ms</span>
      </div>
    </>
  );
}
