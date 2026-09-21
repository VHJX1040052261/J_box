import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

/**
 * 盒子的返回值是「压平后的答案」：noul 是纯数字，choice 是 字符串 + _conf + _probs，score 是 数字 + _conf。
 * 所以这里不写死字段名，按后缀分派 —— jev_judge 允许调用方自带题面，字段名是不可预知的。
 */
export type Flat = Record<string, any>;

const ACTION_STYLE: Record<string, string> = {
  block: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/40",
  human: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40",
  pass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/40",
  off_topic: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/40",
  none: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/40",
  small: "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/40",
  large: "bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/40",
  supports: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/40",
  contradicts: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/40",
  not_mentioned: "bg-muted text-muted-foreground border-border",
  undecidable: "bg-muted text-muted-foreground border-border",
  progress: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/40",
  done: "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/40",
  redundant: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40",
  contradiction: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/40",
  tool_misuse: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/40",
};

export function VerdictBadge({ action }: { action: string | null }) {
  if (action == null) return <Badge variant="outline" className="text-muted-foreground">无结论</Badge>;
  return <Badge variant="outline" className={ACTION_STYLE[action] ?? "bg-primary/10 text-primary border-primary/40"}>{action}</Badge>;
}

const SOURCE_LABEL: Record<string, string> = { mcp: "agent · MCP", cli: "命令行", console: "控制台" };
const SOURCE_STYLE: Record<string, string> = {
  mcp: "bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/40",
  cli: "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/40",
  console: "bg-muted text-muted-foreground border-border",
};

export function SourceBadge({ source }: { source: string | null }) {
  const key = source ?? "console";
  return <Badge variant="outline" className={SOURCE_STYLE[key] ?? SOURCE_STYLE.console}>{SOURCE_LABEL[key] ?? key}</Badge>;
}

export function Bars({ data, winner }: { data: Record<string, number>; winner?: string }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-1.5">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-2">
          <span className={`w-28 shrink-0 truncate text-right font-mono text-[11px] ${k === winner ? "font-bold text-foreground" : "text-muted-foreground"}`} title={k}>{k}</span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className={`h-full rounded-full transition-all duration-500 ${k === winner ? "bg-primary" : "bg-primary/35"}`} style={{ width: `${Math.max(v * 100, 1)}%` }} />
          </div>
          <span className="w-11 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{v.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

export function Probability({ label, value, warn = 0.7 }: { label: string; value: number; warn?: number }) {
  const hot = value > warn;
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 truncate font-mono text-[11px] text-muted-foreground" title={label}>{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full transition-all duration-500 ${hot ? "bg-amber-500" : "bg-primary/40"}`} style={{ width: `${Math.max(value * 100, 1)}%` }} />
      </div>
      <span className={`w-11 shrink-0 font-mono text-[11px] tabular-nums ${hot ? "font-bold text-amber-600" : "text-muted-foreground"}`}>{value.toFixed(2)}</span>
    </div>
  );
}

/** 把压平后的答案渲染出来：分布画条，标量画概率条，字符串给徽章 */
export function VectorView({ v }: { v: Flat }) {
  const keys = Object.keys(v).filter((k) => !k.endsWith("_probs") && !k.endsWith("_conf"));
  return (
    <div className="space-y-3">
      {keys.map((k) => {
        const val = v[k];
        const probs = v[`${k}_probs`];
        const conf = v[`${k}_conf`];
        if (probs && typeof probs === "object") {
          return (
            <div key={k} className="space-y-1.5 rounded-lg border bg-card/50 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-muted-foreground">{k} · choice</span>
                <span className="flex items-center gap-2">
                  <VerdictBadge action={String(val)} />
                  <span className="font-mono text-[11px] text-muted-foreground">conf {Number(conf ?? 0).toFixed(2)}</span>
                </span>
              </div>
              <Bars data={probs} winner={String(val)} />
            </div>
          );
        }
        if (typeof val === "number") {
          return (
            <div key={k} className="rounded-lg border bg-card/50 p-3">
              <Probability label={k} value={val} />
              {conf != null && <p className="mt-1 pl-28 font-mono text-[10px] text-muted-foreground">confidence {Number(conf).toFixed(2)}</p>}
            </div>
          );
        }
        return (
          <div key={k} className="flex items-center justify-between rounded-lg border bg-card/50 px-3 py-2">
            <span className="font-mono text-xs text-muted-foreground">{k}</span>
            <span className="text-sm">{String(val)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function MetaLine({ meta }: { meta?: { model?: string; ms?: number; cost?: number; tokens?: number; sample?: number } }) {
  if (!meta) return null;
  return (
    <>
      <Separator className="my-3" />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
        <span>model {meta.model ?? "jev-latest"}</span>
        {meta.tokens != null && <span>in {meta.tokens} tok</span>}
        <span>out 0 tok（Jev 不生成文本）</span>
        {meta.cost != null && <span>${meta.cost.toFixed(7)}</span>}
        {meta.ms != null && <span>{meta.ms} ms</span>}
        {meta.sample != null && meta.sample > 1 && <span>sample ×{meta.sample}（取中位数）</span>}
      </div>
    </>
  );
}
