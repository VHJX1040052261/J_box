import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { ascii, clearLines, emptyBoard, lock, placements, profile } from "./tetris.mjs";

const FILE = ".race.json";
const API = "http://127.0.0.1:8787/api/tetris-move";
const SEED = 20260919;
const SHAPES = ["I", "O", "T", "S", "Z", "J", "L"];

// 同一副牌序：否则比的是运气不是决策
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

const newPlayer = () => ({ board: emptyBoard(), pieces: 0, lines: 0, score: 0, over: false, reason: "", asks: 0, cost: 0, conf: [] });
const QUEUE = bagSequence(400);

function load() {
  if (!existsSync(FILE)) writeFileSync(FILE, JSON.stringify({ i: 0, a: newPlayer(), b: newPlayer(), log: [] }));
  return JSON.parse(readFileSync(FILE, "utf8"));
}
const save = (s) => writeFileSync(FILE, JSON.stringify(s));

function apply(player, piece, cand) {
  const { board, cleared } = clearLines(lock(player.board, cand.cells, cand.row, cand.col, piece));
  player.board = board;
  player.pieces++;
  player.lines += cleared;
  player.score += [0, 100, 300, 500, 800][cleared] * (1 + Math.floor(player.lines / 10));
}

function show(name, p, extra) {
  const pr = profile(p.board);
  console.log(`── ${name} ${p.over ? `【已顶出：${p.reason}】` : ""}`);
  console.log(`   块 ${p.pieces} 消行 ${p.lines} 分 ${p.score} 洞 ${pr.holes} 最高列 ${pr.max} 凸起 ${pr.bumpiness}${extra ? "  " + extra : ""}`);
  console.log(ascii(p.board, 10).split("\n").map((r) => "   " + r.replace(/\./g, "·")).join("\n"));
}

async function askJev(player, piece, next) {
  const cands = placements(player.board, piece);
  if (!cands.length) { player.over = true; player.reason = "无合法落点"; return null; }
  const t0 = Date.now();
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board: player.board, shape: piece, next, cands }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || `HTTP ${r.status}`);
      player.asks++;
      player.cost += b.meta.cost;
      player.conf.push(b.move.confidence);
      const cand = cands.find((c) => c.id === b.move.choice);
      if (!cand) { player.over = true; player.reason = `Jev 返回非法落点 ${b.move.choice}`; return null; }
      return { cand, move: b.move, risky: b.risky, ms: Date.now() - t0, tok: b.meta.usage.input_tokens, attempts: attempt };
    } catch (e) {
      lastErr = e;
      if (attempt < 4) await new Promise((res) => setTimeout(res, 400 * attempt));
    }
  }
  throw lastErr;
}

const cmd = process.argv[2] ?? "status";
const st = load();

if (cmd === "reset") {
  save({ i: 0, a: newPlayer(), b: newPlayer(), log: [] });
  console.log("已重置，双方回到空盘，牌序相同。");
  process.exit(0);
}

if (cmd === "ask") {
  const piece = QUEUE[st.i];
  const cands = placements(st.b.board, piece);
  if (!cands.length) { console.log("B 方无合法落点，已顶出。"); process.exit(0); }
  console.log(`\n回合 ${st.i + 1}　方块 = ${piece}　（Jev 此刻正在它自己的盘面上被问，你看不到它的选择）`);
  console.log("你的盘面（底 10 行，· 空 # 实）：");
  console.log(ascii(st.b.board, 10).split("\n").map((l) => "   " + l.replace(/\./g, "·")).join("\n"));
  const pr = profile(st.b.board);
  console.log(`   列高 ${pr.heights.join("")}  洞 ${pr.holes}  最高 ${pr.max}`);
  console.log("\n候选落点（rot/col；heights 是落子并消行后的列高）：");
  console.log("  id      消行  洞  凸起  最高  总高   落子后列高");
  for (const c of cands) {
    console.log(`  ${c.id.padEnd(7)} ${String(c.cleared).padStart(3)} ${String(c.holes).padStart(4)} ${String(c.bumpiness).padStart(5)} ${String(c.max).padStart(5)} ${String(c.aggregate).padStart(6)}   ${c.heights.join("")}`);
  }
  console.log(`\n下一块是 ${QUEUE[st.i + 1]}。选定后执行：node race.mjs play <id>`);
  process.exit(0);
}

if (cmd === "play") {
  const idB = process.argv[3];
  const piece = QUEUE[st.i];
  if (!idB) { console.log("用法：node race.mjs play <id>"); process.exit(1); }

  const candsB = placements(st.b.board, piece);
  const pickB = candsB.find((c) => c.id === idB);
  if (!pickB) { console.log(`非法落点 ${idB}。可选：${candsB.map((c) => c.id).join(" ")}`); process.exit(1); }
  apply(st.b, piece, pickB);

  let jevNote = "Jev 已顶出，本轮跳过";
  if (!st.a.over) {
    try {
      const r = await askJev(st.a, piece, QUEUE[st.i + 1]);
      if (r) {
        apply(st.a, piece, r.cand);
        jevNote = `Jev 选 ${r.move.choice}（conf ${r.move.confidence.toFixed(2)}，risky ${r.risky.toFixed(2)}，${r.ms}ms ${r.tok}tok）`;
        if (r.move.choice === idB) st.log.push(`回合${st.i + 1} 同选 ${idB}`);
        else st.log.push(`回合${st.i + 1} 分歧：你 ${idB} / Jev ${r.move.choice}`);
      } else jevNote = st.a.reason;
    } catch (e) {
      // 不落盘直接退出：让这一回合可重放，避免一次网络抖动把双方牌序永久错开
      console.error(`Jev 调用失败（已重试 4 次）：${e.message}\n状态未写入，重跑同一条 play 命令即可。`);
      process.exit(1);
    }
  }

  st.i++;
  save(st);

  console.log(`\n=== 回合 ${st.i}　方块 ${piece} ===`);
  console.log(`你选 ${idB}　|　${jevNote}`);
  show("A · Jev", st.a, `$${st.a.cost.toFixed(5)}`);
  show("B · 你", st.b);
  const agree = st.log.filter((l) => l.includes("同选")).length;
  console.log(`\n进度：回合 ${st.i}/400　同选 ${agree}/${st.log.length}`);
  if (st.a.over || st.b.over) console.log("!!! 有一方已顶出，用 node race.mjs status 看结论");
  else console.log("下一步：node race.mjs ask");
  process.exit(0);
}

const prA = profile(st.a.board), prB = profile(st.b.board);
const avg = (x) => (x.conf.length ? (x.conf.reduce((a, b) => a + b, 0) / x.conf.length).toFixed(2) : "—");
console.log(`\n=== 对战状态（回合 ${st.i}）===`);
console.log("方          存活  块数  消行  得分   洞   最高  凸起  平均conf  花费");
for (const [n, p, pr] of [["A Jev", st.a, prA], ["B 你", st.b, prB]]) {
  console.log(
    n.padEnd(11),
    (p.over ? "否" : "是").padStart(4),
    String(p.pieces).padStart(6),
    String(p.lines).padStart(5),
    String(p.score).padStart(6),
    String(pr.holes).padStart(5),
    String(pr.max).padStart(5),
    String(pr.bumpiness).padStart(5),
    String(avg(p)).padStart(9),
    `$${p.cost.toFixed(5)}`.padStart(10),
  );
}
console.log(`\n同选 ${st.log.filter((l) => l.includes("同选")).length} / 分歧 ${st.log.filter((l) => l.includes("分歧")).length}`);
