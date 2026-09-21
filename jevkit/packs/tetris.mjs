import { definePack, register } from "../pack.mjs";
import { describeBoard, describeOption, emptyBoard, holeSafe, placements } from "../../tetris.mjs";

/**
 * 俄罗斯方块落点题包。留着它是为了记住一个反面结论：
 * 这是 Jev 表现最差的一处（自己排 21 个落点 → 48 块死；代码先筛到 4 个 → 120 块不死）。
 * 保留 risky 这道题，是为了让 pack.mjs 的前瞻 lint 真的报出来 —— 它实测全程 0.41 无预警能力。
 */
export const tetrisPack = register(definePack({
  id: "tetris",
  title: "俄罗斯方块落点选择",
  questions(state) {
    return {
      move: { type: "choice", instructions: "Tetris. Choose which legal drop the falling piece should take; favor a flat surface with no covered holes and a low stack.", criteria: Object.fromEntries(state.cands.map((c) => [c.id, describeOption(c)])) },
      risky: { type: "noul", instructions: "After this drop the next few pieces will likely stack up out of control", criteria: { true: "Position close to unplayable", false: "Still under control" } },
    };
  },
  stateFor: (item) => ({ board: item.board, piece: item.piece, next: item.next, cands: holeSafe(placements(item.board, item.piece), item.K ?? 4) }),
  normalize: (a) => ({ pred: a.move.choice, conf: a.move.confidence, risky: a.risky.noul }),
  thresholds: {},

  decide(v, _th, ctx) {
    const c = ctx.state.cands.find((x) => x.id === v.pred);
    return { action: v.pred, why: c ? `落点 ${v.pred}：洞 ${c.holes} 最高列 ${c.max}` : "Jev 返回了不在候选里的落点", trace: [] };
  },
  fallback: { action: null, why: "Jev 不可用，退回代码启发式" },

  /** 用例由引擎现算，不预先固定 —— 每个盘面都有唯一最优洞数可对照 */
  cases: [],
  lintCase: { board: emptyBoard(), piece: "T", next: "I", K: 4 },
  lintWaive: { move: "候选集由引擎枚举的合法落点构成，封闭且必有一个成立，no-match 出口无意义" },
  scoreItem(item, decision, v, ctx) {
    const all = placements(item.board, item.piece);
    const bestHoles = Math.min(...all.map((c) => c.holes));
    const chosen = all.find((c) => c.id === v.pred);
    const excess = chosen ? chosen.holes - bestHoles : 99;
    return { ok: excess === 0, kind: "regret", brier: Math.min(excess / 4, 1), excess };
  },
}));
