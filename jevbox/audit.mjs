import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";

const FILE = new URL("./audit.jsonl", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");

const digest = (s) => createHash("sha1").update(typeof s === "string" ? s : JSON.stringify(s)).digest("hex").slice(0, 12);

/**
 * 追加式（append-only）落盘：所有写入都是 append，包括复核。
 * 之前 markReview 是「读全文 → 改 → 整体重写」，一旦和实时决策的 append 交错就丢行 ——
 * 而实时决策正是这个工作台会做的事，所以这个竞态不是理论问题。
 *
 * key = 输入的 sha1 摘要（同一条输入多次判定共享 key，便于看漂移）；
 * id = 每条决策独有，复核挂到 id 上，才不会「推翻一次」变成「推翻这条输入的所有历史判定」。
 * preview 只留前 70 字供人眼扫读 —— 真要脱敏就把它也去掉，现在这版是「可追溯优先」。
 */
export function logDecision({ pack, item, v, meta, decision, source = null }) {
  const trace = decision.trace ?? [];
  const row = {
    t: "d",
    id: randomBytes(5).toString("hex"),
    ts: new Date().toISOString(),
    pack: pack.id,
    // 谁调的：mcp = agent 通过 MCP，cli = 命令行，console = 可视化控制台。
    // 没有它就只能看到「有调用」，看不到「是我的 agent 在调」—— 接入验证要靠这一列。
    source,
    key: digest(item),
    preview: (pack.previewOf?.(item) ?? (typeof item === "string" ? item : JSON.stringify(item))).replace(/\s+/g, " ").slice(0, 70),
    action: decision.action,
    why: decision.why,
    failedGate: trace.find((t) => !t.pass)?.text ?? null,
    vector: v,
    model: meta.model,
    tokens: meta.usage?.input_tokens ?? null,
    cost: meta.cost ?? null,
    ms: meta.ms ?? null,
    sample: meta.sample ?? 1,
    spread: meta.spread ?? null,
  };
  appendFileSync(FILE, JSON.stringify(row) + "\n");
  return row;
}

/** 复核回流：{overturned: 人工是否推翻, expect?: 人工认为正确动作, note?} */
export function markReview(id, review) {
  appendFileSync(FILE, JSON.stringify({ t: "r", id, ts: new Date().toISOString(), ...review }) + "\n");
  return id;
}

/** 读回并把复核记录合并到对应决策上；后写的复核覆盖先写的（人改主意以最后一次为准） */
export function readAudit() {
  if (!existsSync(FILE)) return [];
  const out = new Map();
  for (const line of readFileSync(FILE, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; } // 半截行：进程被砍时真会出现，跳过而不是崩
    if (r.t === "d") out.set(r.id, { ...r, review: null });
    else if (r.t === "r" && out.has(r.id)) {
      const { t, ts, id, ...rest } = r;
      out.get(r.id).review = { ...out.get(r.id).review, ...rest, at: ts };
    }
  }
  return [...out.values()];
}

/** 按题包汇总：动作分布、真实被推翻率（需要 review 数据）、k 次采样抖动 */
export function auditStats() {
  const rows = readAudit();
  const by = {};
  for (const r of rows) {
    by[r.pack] ??= { n: 0, actions: {}, reviewed: 0, overturned: 0, cost: 0, ms: [], spread: 0 };
    const b = by[r.pack];
    b.n++;
    b.actions[r.action] = (b.actions[r.action] || 0) + 1;
    b.cost += r.cost || 0;
    if (r.ms) b.ms.push(r.ms);
    if (r.review) { b.reviewed++; if (r.review.overturned) b.overturned++; }
    b.spread += (r.spread || []).reduce((s, x) => s + x.range, 0);
  }
  return Object.fromEntries(Object.entries(by).map(([k, v]) => {
    const ms = v.ms.sort((a, b) => a - b);
    return [k, {
      n: v.n,
      actions: v.actions,
      cost: +v.cost.toFixed(6),
      p50ms: ms[Math.floor(ms.length / 2)] ?? null,
      reviewed: v.reviewed,
      overturned: v.overturned,
      trueErrorRate: v.reviewed ? +(v.overturned / v.reviewed).toFixed(3) : null,
      avgSpread: +(v.spread / v.n).toFixed(3),
    }];
  }));
}
