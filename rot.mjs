import { clearLines, emptyBoard, heuristicPick, lock, placements } from "./tetris.mjs";
import { seededBag } from "./tetris.mjs";

const API = "http://127.0.0.1:8787";
const N = Number(process.argv[2] || 60);
const queue = seededBag(N + 10, 4242);

const avail = { 0: 0, 1: 0, 2: 0, 3: 0 };
const chosenH = { 0: 0, 1: 0, 2: 0, 3: 0 };
const chosenJ = { 0: 0, 1: 0, 2: 0, 3: 0 };
let jevCalls = 0, jevErr = "";

let bh = emptyBoard();
const positions = [];
for (let i = 0; i < N; i++) {
  const piece = queue[i];
  const cands = placements(bh, piece);
  if (!cands.length) break;
  const rots = new Set(cands.map((c) => c.rot));
  for (const r of rots) avail[r]++;
  positions.push({ board: bh.map((r) => [...r]), piece, next: queue[i + 1], cands });
  const p = heuristicPick(cands);
  chosenH[p.rot]++;
  const { board } = clearLines(lock(bh, p.cells, p.row, p.col, piece));
  bh = board;
}

for (const pos of positions.slice(0, 25)) {
  try {
    const r = await fetch(API + "/api/tetris-move", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ board: pos.board, shape: pos.piece, next: pos.next, cands: pos.cands }),
    });
    const b = await r.json();
    if (!r.ok) throw new Error(b.error);
    const c = pos.cands.find((x) => x.id === b.move.choice);
    if (c) chosenJ[c.rot]++;
    jevCalls++;
  } catch (e) { jevErr = e.message; break; }
}

const pct = (x, n) => `${x} (${(x / Math.max(n, 1) * 100).toFixed(0)}%)`;
console.log(`\n局面数：启发式统计 ${positions.length} 步，Jev 实际问了 ${jevCalls} 步${jevErr ? "（后中断：" + jevErr + "）" : ""}`);
console.log("\n每个局面里「有几种旋转可用」（出现次数）");
console.log("  rot0 可用:", avail[0], " rot1:", avail[1], " rot2:", avail[2], " rot3:", avail[3]);
console.log("\n实际选中该旋转的次数");
console.log("  启发式  r0", pct(chosenH[0], positions.length), " r1", pct(chosenH[1], positions.length), " r2", pct(chosenH[2], positions.length), " r3", pct(chosenH[3], positions.length));
console.log("  Jev     r0", pct(chosenJ[0], jevCalls), " r1", pct(chosenJ[1], jevCalls), " r2", pct(chosenJ[2], jevCalls), " r3", pct(chosenJ[3], jevCalls));
