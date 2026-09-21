import { askJev } from "./jev.mjs";
import { clearLines, emptyBoard, heuristicPick, lock, placements, seededBag } from "./tetris.mjs";

const REPS = Number(process.argv[2] || 4);
const CAP = Number(process.argv[3] || 160);
const INSTRUCTIONS =
  "Tetris playfield. Choose which legal drop the falling piece should take. " +
  "Favor a flat surface with no covered holes and a low stack; take line clears only when they do not cost you the flatness.";

function optionText(c, mode) {
  return mode === "plain"
    ? `rotation ${c.rot}, column ${c.col}, clears ${c.cleared} line(s), holes ${c.holes}, bumpiness ${c.bumpiness}, tallest column ${c.max}. Resulting bottom 12 rows:\n${c.picture}`
    : `drop at column ${c.col} in this orientation. The piece you would place is drawn as + ; # is already solid, . is empty. After this drop: lines cleared ${c.cleared}, total holes ${c.holes}, bumpiness ${c.bumpiness}, tallest column ${c.max}.\n${c.marked}`;
}

/** 代码先做掉 Jev 做不到的那步：把会新增洞的落点全部淘汰，只留最少洞里最平的 K 个 */
function prune(cands, K) {
  const minHoles = Math.min(...cands.map((c) => c.holes));
  const safe = cands.filter((c) => c.holes === minHoles).sort((a, b) => a.aggregate - b.aggregate || a.bumpiness - b.bumpiness);
  return safe.slice(0, K);
}

const CONDITIONS = {
  plain: { marked: false, K: Infinity },
  // marked 已单独测过与 plain 无可测差异（t=1.33），这里不再占轮次
  "hybrid-4": { marked: true, K: 4 },
  "hybrid-2": { marked: true, K: 2 },
};

function profileOf(board) {
  let holes = 0; const heights = [];
  for (let c = 0; c < 10; c++) {
    let h = 0;
    for (let r = 0; r < 20; r++) if (board[r][c]) { h = 20 - r; break; }
    heights.push(h);
    let seen = false;
    for (let r = 0; r < 20; r++) { if (board[r][c]) seen = true; else if (seen) holes++; }
  }
  return { holes, max: Math.max(...heights) };
}

async function play(seed, cond) {
  const { marked, K } = CONDITIONS[cond];
  const mode = marked ? "marked" : "plain";
  const queue = seededBag(CAP + 10, seed);
  let board = emptyBoard(), pieces = 0, lines = 0, asked = 0, confs = [], err = "";
  for (let i = 0; i < CAP; i++) {
    const piece = queue[i];
    const all = placements(board, piece);
    if (!all.length) break;
    const cands = K === Infinity ? all : prune(all, K);
    const state = `Tetris well is 10 columns wide. Bottom 12 rows shown top-to-bottom; # is solid, . is empty.\n${board.slice(8).map((r) => r.map((c) => (c ? "#" : ".")).join("")).join("\n")}\nThe piece to place now is ${piece}; the one after it is ${queue[i + 1]}.`;
    try {
      const a = await askJev(state, {
        move: { type: "choice", instructions: INSTRUCTIONS, criteria: Object.fromEntries(cands.map((c) => [c.id, optionText(c, mode)])) },
      });
      asked++;
      confs.push(a.move.confidence);
      const pick = all.find((c) => c.id === a.move.choice);
      if (!pick) { err = `非法落点 ${a.move.choice}`; break; }
      const { board: nb, cleared } = clearLines(lock(board, pick.cells, pick.row, pick.col, piece));
      board = nb; pieces++; lines += cleared;
    } catch (e) { err = e.message; break; }
  }
  const p = profileOf(board);
  return { pieces, lines, holes: p.holes, asked, conf: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0, err };
}

const seeds = Array.from({ length: REPS }, (_, i) => 1000 + i * 37);
const names = Object.keys(CONDITIONS);
const res = Object.fromEntries(names.map((n) => [n, []]));
for (const s of seeds) for (const n of names) { res[n].push(await play(s, n)); process.stdout.write("."); }

const errs = names.flatMap((n) => res[n].filter((x) => x.err));
if (errs.length * 2 >= REPS * names.length) { console.log(`\n实验无效：${errs.length} 局报错。首条：${errs[0].err}`); process.exit(1); }

const stat = (arr) => {
  const v = arr.map((x) => x.pieces).sort((a, b) => a - b);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(v.length - 1, 1));
  return { v, mean, sd, holes: arr.reduce((a, x) => a + x.holes, 0) / arr.length, conf: arr.reduce((a, x) => a + x.conf, 0) / arr.length, lines: arr.reduce((a, x) => a + x.lines, 0) / arr.length };
};
const base = stat(res.plain);
console.log(`\n每局存活块数（同 4 副牌序 × ${names.length} 种架构，上限 ${CAP}）\n`);
console.log("架构          各局存活              均值±SD      终局洞  消行  平均conf");
for (const n of names) {
  const s = stat(res[n]);
  const d = s.mean - base.mean, se = Math.sqrt((s.sd ** 2 + base.sd ** 2) / REPS) || 1;
  console.log(
    n.padEnd(13),
    s.v.join(" ").padEnd(21),
    `${s.mean.toFixed(1)}±${s.sd.toFixed(1)}`.padStart(10),
    `${s.holes.toFixed(1)}`.padStart(7),
    `${s.lines.toFixed(1)}`.padStart(5),
    `${s.conf.toFixed(2)}`.padStart(9),
    n === "plain" ? "" : `  vs旧 ${d >= 0 ? "+" : ""}${d.toFixed(1)} t=${(d / se).toFixed(2)}`,
  );
}
const hs = [];
for (const s of seeds) {
  const q = seededBag(CAP + 10, s); let b = emptyBoard(), n = 0;
  for (let i = 0; i < CAP; i++) { const c = placements(b, q[i]); if (!c.length) break; const p = heuristicPick(c); b = clearLines(lock(b, p.cells, p.row, p.col, q[i])).board; n++; }
  hs.push(n);
}
console.log(`\n参照 启发式同牌序: ${hs.join(" ")}（上限 ${CAP}）`);
if (errs.length) console.log(`部分局报错 ${errs.length} 次: ${[...new Set(errs.map((e) => e.err))].join(" | ")}`);
