import { clearLines, emptyBoard, heuristicPick, lock, placements, seededBag } from "./tetris.mjs";

const API = "http://127.0.0.1:8787/api/tetris-move";
const N = Number(process.argv[2] || 30);
const queue = seededBag(N * 3, 777);

// 用启发式铺出若干真实中局盘面，保证测的是“有井有坡”的局面而不是空盘
let b = emptyBoard();
const positions = [];
for (let i = 0; positions.length < N && i < queue.length - 1; i++) {
  const piece = queue[i];
  const cands = placements(b, piece);
  if (!cands.length) break;
  if (cands.length >= 6) positions.push({ board: b.map((r) => [...r]), piece, next: queue[i + 1], cands });
  const p = heuristicPick(cands);
  b = clearLines(lock(b, p.cells, p.row, p.col, piece)).board;
}

function reorder(cands, mode) {
  if (mode === "asc") return [...cands].sort((x, y) => x.rot - y.rot || x.col - y.col);
  if (mode === "desc") return [...cands].sort((x, y) => y.rot - x.rot || y.col - x.col);
  let s = 991;
  const arr = [...cands];
  for (let i = arr.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

const modes = ["asc", "desc", "shuffled"];
const out = {};
for (const m of modes) out[m] = { rot: { 0: 0, 1: 0, 2: 0, 3: 0 }, firstIdx: 0, n: 0, err: "" };

for (const m of modes) {
  for (const pos of positions) {
    const ordered = reorder(pos.cands, m);
    try {
      const r = await fetch(API, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board: pos.board, shape: pos.piece, next: pos.next, cands: ordered }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      const idx = ordered.findIndex((c) => c.id === body.move.choice);
      const cand = ordered[idx];
      out[m].rot[cand.rot]++;
      if (idx === 0) out[m].firstIdx++;
      out[m].n++;
    } catch (e) { out[m].err = e.message; break; }
  }
}

console.log(`\n${positions.length} 个真实中局盘面 × 3 种选项排列方式（共 ${Object.values(out).reduce((a, x) => a + x.n, 0)} 次调用）`);
console.log("\n选项顺序            r0     r1     r2     r3    非0旋转占比   选中排第一的选项");
for (const m of modes) {
  const o = out[m];
  const pct = (x) => `${(x / Math.max(o.n, 1) * 100).toFixed(0)}%`;
  const nonZero = (o.n - o.rot[0]) / Math.max(o.n, 1);
  console.log(
    (m === "asc" ? "旋转升序(现状)" : m === "desc" ? "旋转降序" : "随机打乱").padEnd(18),
    ["0", "1", "2", "3"].map((k) => pct(o.rot[k])).map((s) => s.padEnd(6)).join(" "),
    `${(nonZero * 100).toFixed(0)}%`.padStart(9),
    `${pct(o.firstIdx)} (${o.firstIdx}/${o.n})`.padStart(16),
    o.err ? " 中断:" + o.err : "",
  );
}
console.log(`\n参考：启发式在同一批盘面上的非 0 旋转比例 = ${(positions.reduce((a, p) => a + (heuristicPick(p.cands).rot !== 0 ? 1 : 0), 0) / positions.length * 100).toFixed(0)}%`);
