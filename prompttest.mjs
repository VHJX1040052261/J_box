import { askJev } from "./jev.mjs";
import { clearLines, describeBoard, emptyBoard, heuristicPick, lock, placements, seededBag } from "./tetris.mjs";

const REPS = Number(process.argv[2] || 4);
const CAP = Number(process.argv[3] || 120);
const INSTRUCTIONS =
  "Tetris playfield. Choose which legal drop the falling piece should take. " +
  "Favor a flat surface with no covered holes and a low stack; take line clears only when they do not cost you the flatness.";

// 两种提示唯一差别：选项里是否把新方块用 + 标出来
function optionText(c, marked) {
  return marked
    ? `drop at column ${c.col} in this orientation. The piece you would place is drawn as + ; # is already solid, . is empty. After this drop: lines cleared ${c.cleared}, total holes ${c.holes}, bumpiness ${c.bumpiness}, tallest column ${c.max}.\n${c.marked}`
    : `rotation ${c.rot}, column ${c.col}, clears ${c.cleared} line(s), holes ${c.holes}, bumpiness ${c.bumpiness}, tallest column ${c.max}. Resulting bottom 12 rows:\n${c.picture}`;
}

async function play(seed, marked) {
  const queue = seededBag(CAP + 10, seed);
  let board = emptyBoard();
  let pieces = 0, holes = 0, lines = 0, confs = [], err = "";
  for (let i = 0; i < CAP; i++) {
    const piece = queue[i];
    const cands = placements(board, piece);
    if (!cands.length) { const h = cands.length; holes = countHoles(board); break; }
    const state = `Tetris well is 10 columns wide. Bottom 12 rows shown top-to-bottom; # is solid, . is empty.\n${board.slice(8).map((r) => r.map((c) => (c ? "#" : ".")).join("")).join("\n")}\nThe piece to place now is ${piece}; the one after it is ${queue[i + 1]}.`;
    try {
      const a = await askJev(state, {
        move: { type: "choice", instructions: INSTRUCTIONS, criteria: Object.fromEntries(cands.map((c) => [c.id, optionText(c, marked)])) },
      });
      const pick = cands.find((c) => c.id === a.move.choice);
      if (!pick) { err = `非法落点 ${a.move.choice}`; break; }
      confs.push(a.move.confidence);
      const { board: nb, cleared } = clearLines(lock(board, pick.cells, pick.row, pick.col, piece));
      board = nb; pieces++; lines += cleared;
    } catch (e) { err = e.message; break; }
  }
  const p = profileOf(board);
  return { pieces, holes: p.holes, lines, conf: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0, err };
}

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
function countHoles(b) { return profileOf(b).holes; }

const seeds = Array.from({ length: REPS }, (_, i) => 1000 + i * 37);
const res = { marked: [], plain: [] };
for (const s of seeds) {
  for (const k of ["plain", "marked"]) {
    res[k].push(await play(s, k === "marked"));
    process.stdout.write(".");
  }
}

const stat = (arr) => {
  const v = arr.map((x) => x.pieces).sort((a, b) => a - b);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(v.length - 1, 1));
  return { v, mean, sd, holes: arr.reduce((a, x) => a + x.holes, 0) / arr.length, conf: arr.reduce((a, x) => a + x.conf, 0) / arr.length };
};
const a = stat(res.plain), b = stat(res.marked);
const errs = [...res.plain, ...res.marked].filter((x) => x.err);
if (errs.length * 2 >= res.plain.length + res.marked.length) {
  console.log(`\n实验无效：${errs.length}/${res.plain.length + res.marked.length} 局报错，不足以比较。首条错误：${errs[0].err}`);
  process.exit(1);
}
console.log(`\n每局存活块数（同牌序，${REPS} 次配对）`);
console.log("  纯数字提示 (旧):", a.v.join(" "), ` 均值 ${a.mean.toFixed(1)} ±${a.sd.toFixed(1)}  终局洞 ${a.holes.toFixed(1)}  conf ${a.conf.toFixed(2)}`);
console.log("  标出方块 (新):", b.v.join(" "), ` 均值 ${b.mean.toFixed(1)} ±${b.sd.toFixed(1)}  终局洞 ${b.holes.toFixed(1)}  conf ${b.conf.toFixed(2)}`);
const d = b.mean - a.mean;
const se = Math.sqrt((a.sd ** 2 + b.sd ** 2) / REPS);
console.log(`\n差值 ${d >= 0 ? "+" : ""}${d.toFixed(1)} 块，合并标准误 ±${se.toFixed(1)} → t = ${(d / (se || 1)).toFixed(2)}`);
console.log(Math.abs(d) / (se || 1) < 2 ? "结论：差异落在噪声内，不能说标出方块有提升。" : "结论：差异超出噪声，标出方块确有提升。");
if (errs.length) console.log("部分局报错:", errs.map((x) => x.err).join(" | "));
console.log(`参照：同一批牌序下启发式一律跑满 ${CAP} 块不死。`);
