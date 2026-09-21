import { clearLines, emptyBoard, heuristicPick, lock, placements, profile, seededBag } from "./tetris.mjs";

const SCORE_TABLE = [0, 100, 300, 500, 800];

export function createGame(name, queue) {
  return { name, queue, idx: 0, board: emptyBoard(), pieces: 0, lines: 0, score: 0, over: false, reason: "", asks: 0, cost: 0, conf: [], risky: [], last: null };
}

export const currentPiece = (g) => g.queue[g.idx];
export const nextPiece = (g) => g.queue[g.idx + 1] ?? g.queue[g.idx];

export function candidates(g) {
  if (g.over) return [];
  const piece = currentPiece(g);
  if (!piece) { g.over = true; g.reason = "牌堆已用尽"; return []; }
  return placements(g.board, piece);
}

export function step(g, cand) {
  if (g.over) return false;
  const cands = candidates(g);
  const pick = cand ?? null;
  const chosen = pick ? cands.find((c) => c.id === pick) : null;
  if (!chosen) return false;
  const landed = lock(g.board, chosen.cells, chosen.row, chosen.col, currentPiece(g));
  // 消掉的行会让上方格子整体下移，高亮坐标必须跟着换算，否则动画会画错位
  const fullRows = landed.reduce((acc, row, r) => (row.every((c) => c) ? [...acc, r] : acc), []);
  const cells = chosen.cells.map(([dr, dc]) => {
    const r = chosen.row + dr;
    return [r - fullRows.filter((x) => x < r).length, chosen.col + dc];
  });
  const { board, cleared } = clearLines(landed);
  g.lastMove = { id: chosen.id, rot: chosen.rot, cells, cleared, piece: currentPiece(g) };
  // 前端要演的是「出生 → 旋转到目标朝向 → 逐行下落 → 锁定」，所以这里给的是下落的起点与终点，不是结果盘面
  g.anim = {
    piece: currentPiece(g),
    rot: chosen.rot,
    col: chosen.col,
    fromRow: -4,
    toRow: chosen.row,
    offsets: chosen.cells,
    clearedRows: fullRows,
    seq: g.pieces + 1,
  };
  g.board = board;
  g.pieces++;
  g.lines += cleared;
  g.score += SCORE_TABLE[cleared] * (1 + Math.floor(g.lines / 10));
  g.idx++;
  if (!candidates(g).length) { g.over = true; g.reason = "无合法落点，顶出"; }
  return true;
}

export function starve(g) {
  if (g.over) return;
  if (!candidates(g).length) { g.over = true; g.reason = "无合法落点，顶出"; }
}

export function snapshot(g) {
  const p = profile(g.board);
  return {
    name: g.name,
    board: g.board,
    piece: g.over ? null : currentPiece(g),
    next: g.over ? null : nextPiece(g),
    pieces: g.pieces, lines: g.lines, score: g.score,
    over: g.over, reason: g.reason,
    holes: p.holes, max: p.max, bumpiness: p.bumpiness, heights: p.heights,
    asks: g.asks, cost: g.cost,
    confAvg: g.conf.length ? g.conf.reduce((a, b) => a + b, 0) / g.conf.length : null,
    riskyAvg: g.risky.length ? g.risky.reduce((a, b) => a + b, 0) / g.risky.length : null,
    last: g.last,
    lastMove: g.lastMove ?? null,
    anim: g.anim ?? null,
    cands: candidates(g).map(({ picture, ...c }) => c),
    autoId: (() => { const c = candidates(g); return c.length ? heuristicPick(c).id : null; })(),
  };
}

export function makeQueue(n = 400, seed = 20260919) {
  return seededBag(n, seed);
}
