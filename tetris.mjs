export const COLS = 10;
export const ROWS = 20;
export const SHAPES = ["I", "O", "T", "S", "Z", "J", "L"];
export const COLORS = { I: "#22d3ee", O: "#facc15", T: "#c084fc", S: "#4ade80", Z: "#f87171", J: "#60a5fa", L: "#fb923c" };

const BASE = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
};

function rotateCW(m) {
  return m.map((_, r) => m.map((row) => row[r]).reverse());
}

const ROTATIONS = Object.fromEntries(
  SHAPES.map((s) => {
    let m = BASE[s];
    const list = [0, 1, 2, 3].map(() => {
      const cur = m;
      m = rotateCW(m);
      return cur;
    });
    return [s, list];
  }),
);

const cellsOf = (matrix) => {
  const out = [];
  matrix.forEach((row, r) => row.forEach((v, c) => v && out.push([r, c])));
  return out;
};

const CELLS = Object.fromEntries(SHAPES.map((s) => [s, ROTATIONS[s].map(cellsOf)]));

export const emptyBoard = () => Array.from({ length: ROWS }, () => Array(COLS).fill(null));

export function pieceCells(shape, rot) {
  return CELLS[shape][((rot % 4) + 4) % 4];
}

export function randomBag() {
  const bag = [...SHAPES];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

// 定序牌堆：对战必须共用同一块序列，否则比的是手气不是决策
export function seededBag(n, seed = 20260919) {
  let a = seed;
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [];
  while (out.length < n) {
    const bag = [...SHAPES];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    out.push(...bag);
  }
  return out.slice(0, n);
}

export function collide(board, cells, row, col) {
  for (const [dr, dc] of cells) {
    const r = row + dr;
    const c = col + dc;
    if (c < 0 || c >= COLS || r >= ROWS) return true;
    if (r >= 0 && board[r][c]) return true;
  }
  return false;
}

export function lock(board, cells, row, col, shape) {
  const next = board.map((r) => [...r]);
  for (const [dr, dc] of cells) {
    const r = row + dr;
    const c = col + dc;
    if (r >= 0 && r < ROWS) next[r][c] = shape;
  }
  return next;
}

export function clearLines(board) {
  const kept = board.filter((row) => row.some((c) => !c));
  const cleared = ROWS - kept.length;
  while (kept.length < ROWS) kept.unshift(Array(COLS).fill(null));
  return { board: kept, cleared };
}

export function profile(board) {
  const heights = [];
  let holes = 0;
  for (let c = 0; c < COLS; c++) {
    let h = 0;
    for (let r = 0; r < ROWS; r++) if (board[r][c]) { h = ROWS - r; break; }
    heights.push(h);
    let seen = false;
    for (let r = 0; r < ROWS; r++) {
      if (board[r][c]) seen = true;
      else if (seen) holes++;
    }
  }
  let bumpiness = 0;
  for (let i = 0; i < COLS - 1; i++) bumpiness += Math.abs(heights[i] - heights[i + 1]);
  return { heights, holes, bumpiness, aggregate: heights.reduce((a, b) => a + b, 0), max: Math.max(...heights) };
}

export function ascii(board, rows = 12) {
  return board.slice(ROWS - rows).map((r) => r.map((c) => (c ? "#" : ".")).join("")).join("\n");
}

/** 把刚落下的方块单独标成 + ，否则模型得自己差分两张图才知道它放了什么 */
export function asciiMarked(board, cells, row, col, shape, rows = 12) {
  const mark = new Set(cells.map(([dr, dc]) => `${row + dr},${col + dc}`));
  return board.slice(ROWS - rows).map((r, ri) =>
    r.map((c, ci) => (mark.has(`${ROWS - rows + ri},${ci}`) ? "+" : c ? "#" : ".")).join(""),
  ).join("\n");
}

// 代码负责穷举与算数：所有合法落点、以及每个落点造成的后果
export function placements(board, shape) {
  const rots = CELLS[shape];
  if (!rots) return [];
  const seen = new Map();
  for (let rot = 0; rot < rots.length; rot++) {
    const cells = rots[rot];
    for (let col = -2; col < COLS; col++) {
      if (collide(board, cells, 0, col) && collide(board, cells, -1, col) && collide(board, cells, -2, col)) continue;
      let row = -2;
      while (!collide(board, cells, row + 1, col)) row++;
      if (cells.some(([dr]) => row + dr < 0)) continue;
      const landed = lock(board, cells, row, col, shape);
      const { board: after, cleared } = clearLines(landed);
      const key = ascii(after, ROWS);
      if (seen.has(key)) continue;
      const p = profile(after);
      seen.set(key, {
        id: `r${rot}c${col}`,
        rot,
        col,
        row,
        cells,
        cleared,
        holes: p.holes,
        heights: p.heights,
        bumpiness: p.bumpiness,
        aggregate: p.aggregate,
        max: p.max,
        picture: ascii(after),
        marked: asciiMarked(landed, cells, row, col, shape),
      });
    }
  }
  const list = [...seen.values()].sort((a, b) => a.rot - b.rot || a.col - b.col);
  // 高堆叠的自杀落点直接剔除；上限必须大于「旋转数 × 列数」，否则会静默丢掉合法落点
  return list.filter((c) => c.max < ROWS - 1);
}

/**
 * 把「会不会造出无法消除的洞」这一步交给代码：先淘汰所有非最少洞的落点，
 * 再按平整度留 K 个。这是 Jev 排不动的那一步。
 */
export function holeSafe(cands, K = 4) {
  if (!cands.length) return cands;
  const minHoles = Math.min(...cands.map((c) => c.holes));
  return cands
    .filter((c) => c.holes === minHoles)
    .sort((a, b) => a.aggregate - b.aggregate || a.bumpiness - b.bumpiness)
    .slice(0, K);
}

export function heuristicPick(cands) {
  let best = cands[0];
  let bestScore = -Infinity;
  for (const c of cands) {
    const s = 6 * c.cleared - 0.5 * c.aggregate - 4 * c.holes - 0.8 * c.bumpiness - 1.5 * Math.max(0, c.max - 6);
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return best;
}

export function describeBoard(board, shape, nextShape) {
  return `Tetris well is 10 columns wide. Bottom 12 rows shown top-to-bottom; # is solid, . is empty.\n${ascii(board)}\nThe piece to place now is ${shape}; the one after it is ${nextShape}. Each option below redraws this board with that piece put in place, marked as + .`;
}

export function describeOption(c) {
  return `drop at column ${c.col} in this orientation. The piece you would place is drawn as + ; # is already solid, . is empty. After this drop: lines cleared ${c.cleared}, total holes ${c.holes}, bumpiness ${c.bumpiness}, tallest column ${c.max}.\n${c.marked}`;
}
