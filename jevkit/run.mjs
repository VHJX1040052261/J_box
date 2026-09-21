import * as TETRIS from "../tetris.mjs";
import { askPackStable } from "./pack.mjs";
import { logDecision } from "./audit.mjs";

/**
 * 跑一个题包。三件事内建：k 次采样压抖动、失败走降级路径、逐条落审计日志。
 * ctx 里带回 state，供 pack.decide / pack.scoreItem 读取候选等上下文。
 */
export async function runPack(pack, items, { sample = 1, thresholds, onEach } = {}) {
  const th = thresholds ?? pack.thresholds;
  const out = [];
  for (const [i, item] of items.entries()) {
    const state = pack.stateFor(item);
    let v, meta;
    try {
      ({ v, meta } = await askPackStable(pack, item, { sample }));
    } catch (e) {
      const d = pack.fallback ?? { action: null, why: "无降级路径" };
      const row = { i, item, action: d.action, why: `${d.why}（${String(e.message ?? e).slice(0, 60)}）`, degraded: true, ok: null, brier: null };
      out.push(row);
      onEach?.(row, i, items.length);
      continue;
    }

    const decision = pack.decide(v, th, { state, item });
    let scored = { ok: null, brier: null };
    try { scored = pack.scoreItem(item, decision, v, { state }) ?? scored; } catch { /* 题包没给评分就不判分 */ }

    const row = {
      i, item, v, meta,
      action: decision.action,
      why: decision.why,
      degraded: false,
      ok: scored?.ok ?? null,
      brier: scored?.brier ?? null,
    };
    logDecision({ pack, item, v, meta, decision });
    out.push(row);
    onEach?.(row, i, items.length);
  }
  return out;
}

/** 造若干俄罗斯方块盘面：先用启发式铺 n 步，拿到真实中局而不是空盘 */
export function tetrisCases(n = 8, seed = 20260920) {
  const { emptyBoard, placements, heuristicPick, lock, clearLines, seededBag } = TETRIS;
  const q = seededBag(n * 4 + 10, seed);
  let b = emptyBoard();
  const out = [];
  for (let i = 0; i < n; i++) {
    const piece = q[i];
    const cands = placements(b, piece);
    if (!cands.length) break;
    out.push({ board: b.map((r) => [...r]), piece, next: q[i + 1], K: 4 });
    const p = heuristicPick(cands);
    b = clearLines(lock(b, p.cells, p.row, p.col, piece)).board;
  }
  return out;
}
