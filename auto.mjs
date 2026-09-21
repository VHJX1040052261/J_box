import { readFileSync, writeFileSync } from "node:fs";
import { clearLines, emptyBoard, heuristicPick, lock, placements, profile } from "./tetris.mjs";

const API = "http://127.0.0.1:8787/api/tetris-move";
const SEED = 20260919;
const CAP = Number(process.argv[2] || 250);
const SHAPES = ["I", "O", "T", "S", "Z", "J", "L"];

function bagSequence(n) {
  let a = SEED;
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [];
  while (out.length < n) {
    const bag = [...SHAPES];
    for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    out.push(...bag);
  }
  return out.slice(0, n);
}

const newP = (name) => ({ name, board: emptyBoard(), pieces: 0, lines: 0, score: 0, over: false, reason: "", cost: 0, conf: [], risky: [], cands: [] });

async function jevMove(p, piece, next) {
  const cands = placements(p.board, piece);
  if (!cands.length) { p.over = true; p.reason = "无合法落点"; return null; }
  p.cands.push(cands.length);
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const r = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board: p.board, shape: piece, next, cands }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || `HTTP ${r.status}`);
      p.cost += b.meta.cost;
      p.conf.push(b.move.confidence);
      p.risky.push(b.risky);
      const cand = cands.find((c) => c.id === b.move.choice);
      if (!cand) { p.over = true; p.reason = `返回非法落点 ${b.move.choice}`; return null; }
      return cand;
    } catch (e) {
      if (attempt === 5) { p.over = true; p.reason = `接口持续失败：${e.message}`; return null; }
      await new Promise((res) => setTimeout(res, 500 * attempt));
    }
  }
}

function apply(p, piece, cand) {
  const { board, cleared } = clearLines(lock(p.board, cand.cells, cand.row, cand.col, piece));
  p.board = board;
  p.lines += cleared;
  p.pieces++;
  p.score += [0, 100, 300, 500, 800][cleared] * (1 + Math.floor(p.lines / 10));
}

const QUEUE = bagSequence(CAP + 20);
const A = newP("Jev");
const B = newP("启发式");
const agreeLog = [];

for (let i = 0; i < CAP && QUEUE.length; i++) {
  const piece = QUEUE[i];
  const next = QUEUE[i + 1] ?? piece;
  if (!A.over) { const c = await jevMove(A, piece, next); if (c) apply(A, piece, c); }
  if (!B.over) {
    const cands = placements(B.board, piece);
    if (!cands.length) B.over = true, B.reason = "无合法落点";
    else apply(B, piece, heuristicPick(cands));
  }
  if (i % 10 === 9 || A.over !== B.over) {
    const pa = profile(A.board), pb = profile(B.board);
    console.log(`块${String(Math.max(A.pieces, B.pieces)).padStart(3)} | Jev ${A.over ? "顶出" : `洞${pa.holes} 高${pa.max} 消${A.lines} 分${A.score}`} | 启发式 ${B.over ? "顶出" : `洞${pb.holes} 高${pb.max} 消${B.lines} 分${B.score}`}`);
  }
  if (A.over && B.over) break;
}

const avg = (x) => (x.length ? (x.reduce((a, b) => a + b, 0) / x.length).toFixed(3) : "—");
writeFileSync(".auto_race.json", JSON.stringify({
  jev: { ...A, board: undefined, conf: undefined, risky: undefined, cands: undefined },
  baseline: { ...B, board: undefined },
  confAvg: avg(A.conf), riskyAvg: avg(A.risky), candAvg: avg(A.cands),
}, null, 2));

console.log("\n=== 长局结果（同一副牌序）===");
for (const p of [A, B]) {
  const pr = profile(p.board);
  console.log(
    p.name.padEnd(8),
    "存活块数", String(p.pieces).padStart(4),
    "消行", String(p.lines).padStart(3),
    "得分", String(p.score).padStart(5),
    "终局洞", String(pr.holes).padStart(3),
    "终局最高", String(pr.max).padStart(3),
    p.over ? `｜${p.reason}` : "｜跑满上限未死",
  );
}
console.log(`\nJev 平均 confidence ${avg(A.conf)}  平均 risky ${avg(A.risky)}  平均候选数 ${avg(A.cands)}  总花费 $${A.cost.toFixed(5)}`);
