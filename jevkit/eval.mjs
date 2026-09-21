/** 把一次 run 的结果压成可读指标：准确率、多类 Brier、延迟、成本、降级数 */
export function summarize(rows, label = "") {
  const graded = rows.filter((r) => r.ok !== null && r.ok !== undefined);
  const done = rows.filter((r) => !r.degraded);
  const ms = done.map((r) => r.meta?.ms).filter(Boolean).sort((a, b) => a - b);
  const cost = done.reduce((s, r) => s + (r.meta?.cost || 0), 0);
  const tokens = done.reduce((s, r) => s + (r.meta?.usage?.input_tokens || 0), 0);
  const spread = done.flatMap((r) => r.meta?.spread || []);
  // 有争议的标注不静默计入成绩：单列出来，两个数一起看
  const disputed = graded.filter((r) => !r.ok && r.item?.dispute);
  const clean = graded.filter((r) => !disputed.includes(r));
  return {
    label,
    n: rows.length,
    graded: graded.length,
    correct: graded.filter((r) => r.ok).length,
    acc: graded.length ? graded.filter((r) => r.ok).length / graded.length : null,
    disputed: disputed.length,
    cleanN: clean.length,
    cleanCorrect: clean.filter((r) => r.ok).length,
    accClean: clean.length ? clean.filter((r) => r.ok).length / clean.length : null,
    disputes: disputed.map((r) => r.item.dispute),
    brier: graded.length ? graded.reduce((s, r) => s + r.brier, 0) / graded.length : null,
    degraded: rows.length - done.length,
    cost,
    tokens,
    p50ms: ms.length ? ms[Math.floor(ms.length / 2)] : null,
    maxMs: ms.length ? ms[ms.length - 1] : null,
    jitter: spread.length ? +(spread.reduce((s, x) => s + x.range, 0) / spread.length).toFixed(3) : null,
    byAction: rows.reduce((m, r) => ({ ...m, [r.action]: (m[r.action] || 0) + 1 }), {}),
  };
}

export function fmtSummary(s) {
  const pct = (x) => (x == null ? "—" : `${(x * 100).toFixed(0)}%`);
  return [
    `${s.label || "run"}`,
    `  样本 ${s.n}（可判分 ${s.graded}）  准确率 ${pct(s.acc)}${s.disputed ? `（剔除 ${s.disputed} 条争议标注后 ${pct(s.accClean)}）` : ""}  平均Brier ${s.brier == null ? "—" : s.brier.toFixed(4)}`,
    `  p50 ${s.p50ms ?? "—"}ms  峰值 ${s.maxMs ?? "—"}ms  降级 ${s.degraded} 条  花费 $${s.cost.toFixed(6)}（${s.tokens} tok）`,
    s.jitter != null ? `  k次采样字段平均极差 ${s.jitter}（Jev 不可复现程度）` : "",
    `  动作分布 ${JSON.stringify(s.byAction)}`,
  ].filter(Boolean).join("\n");
}
