import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { askJev } from "../jev.mjs";
import { questions, QUESTIONS_SIGNATURE } from "../prompt.mjs";
import { normalize, decide, DEFAULTS } from "../policy.mjs";
import { logDecision, markReview, readAudit, auditStats } from "../jevkit/audit.mjs";
import { askPack } from "../jevkit/pack.mjs";
import { cases } from "../cases.mjs";
import { describeBoard, describeOption, heuristicPick, holeSafe } from "../tetris.mjs";
import { candidates, createGame, currentPiece, makeQueue, nextPiece, snapshot, starve, step } from "../race-engine.mjs";
import { gradeItem, quizItems } from "../quiz.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CACHE = join(here, "..", ".jev_raw_judgments.json");
const PORT = Number(process.env.PORT || 8787);

const send = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

const readBody = (req) => new Promise((resolve, reject) => {
  let raw = "";
  req.on("data", (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
  req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
});

const MOVE_INSTRUCTIONS =
  "Tetris playfield. Choose which legal drop the falling piece should take. " +
  "Favor a flat surface with no covered holes and a low stack; take line clears only when they do not cost you the flatness.";

async function jevChoose(board, shape, next, cands) {
  const answers = await askJev(describeBoard(board, shape, next), {
    move: { type: "choice", instructions: MOVE_INSTRUCTIONS, criteria: Object.fromEntries(cands.map((c) => [c.id, describeOption(c)])) },
    risky: {
      type: "noul",
      instructions: "The chosen drop leaves the playfield in a state where the next few pieces are likely to stack up out of control",
      criteria: { true: "Position is close to unplayable", false: "Position remains under control" },
    },
  });
  const { __meta, ...rest } = answers;
  return { move: rest.move, risky: rest.risky.noul, meta: __meta };
}

// 两局完全独立：Jev 那局由下面的定时器自己连续下，我这局只在收到落子时才走。
// 唯一共享的是同一副牌序 —— 否则「谁坚持最久」会被手气污染。
let JEV, MINE, jevBusy = false;

function resetRace() {
  const queue = makeQueue(400);
  JEV = createGame("Jev", [...queue]);
  MINE = createGame("Qoder", queue);
}
resetRace();

setInterval(async () => {
  // 定时器里抛出的未捕获异常会终止整个进程，连带判断题一起挂掉，所以这里必须兜住
  try {
    if (jevBusy || JEV.over || !process.env.TYPESAFE_API_KEY) return;
    const cands = candidates(JEV);
    if (!cands.length) return;
    // JEV_PRUNE=N：先由代码淘汰会新增洞的落点，只留 N 个最少洞最平的给 Jev 裁量
    const pruned = process.env.JEV_PRUNE ? holeSafe(cands, Number(process.env.JEV_PRUNE)) : cands;
    jevBusy = true;
    const t0 = Date.now();
    try {
      const r = await jevChoose(JEV.board, currentPiece(JEV), nextPiece(JEV), pruned);
      if (step(JEV, r.move.choice)) {
        JEV.asks++;
        JEV.cost += r.meta.cost;
        JEV.conf.push(r.move.confidence);
        JEV.risky.push(r.risky);
        JEV.last = { id: r.move.choice, conf: r.move.confidence, risky: r.risky, ms: Date.now() - t0, tok: r.meta.usage.input_tokens, model: r.meta.model, pruned: `${pruned.length}/${cands.length}` };
      }
    } catch (e) {
      JEV.last = { error: String(e.message ?? e).slice(0, 160), ms: Date.now() - t0 };
    } finally {
      jevBusy = false;
    }
  } catch (e) {
    JEV.last = { error: `定时器异常：${String(e.message ?? e).slice(0, 120)}` };
  }
}, Number(process.env.JEV_TICK || 900));

// ── 判断力对战：Jev 由定时器逐题作答，另一侧由外部选手 POST 答案 ──
let QUIZ;
function resetQuiz() { QUIZ = { items: quizItems(), ans: { jev: {}, me: {} }, jevBusy: false }; }
resetQuiz();

/**
 * 解析选手提交的选项。优先用下标：中文/非 ASCII 选项标签经过 Windows 控制台
 * 编码往返会变成乱码（实测 "支持" → "֧"），用下标可以彻底绕开。
 */
function resolvePred(it, a) {
  if (it.kind === "noul") return undefined;
  if (typeof a.predIndex === "number" && Array.isArray(it.options) && it.options[a.predIndex] != null) return String(it.options[a.predIndex]);
  return a.pred == null ? undefined : String(a.pred);
}

function summary(side) {
  const rows = Object.values(QUIZ.ans[side]);
  if (!rows.length) return { n: 0, correct: 0, acc: null, brier: null, cost: 0, ms: 0 };
  const correct = rows.filter((r) => r.ok).length;
  return {
    n: rows.length,
    correct,
    acc: correct / rows.length,
    brier: rows.reduce((s, r) => s + r.brier, 0) / rows.length,
    cost: rows.reduce((s, r) => s + (r.cost || 0), 0),
    ms: Math.round(rows.reduce((s, r) => s + (r.ms || 0), 0) / rows.length),
  };
}

function grade(it, p, pred, probs) {
  const r = gradeItem(it, p, pred, probs);
  return { p, pred, ok: r.ok, brier: r.brier, oracle: it.oracle };
}

function jevAsk(it) {
  const q = it.kind === "noul"
    ? { answer: { type: "noul", instructions: it.question } }
    : { answer: { type: "choice", instructions: it.question, criteria: Object.fromEntries(it.options.map((o) => [o, null])) } };
  return askJev(it.state, q);
}

setInterval(async () => {
  if (QUIZ.jevBusy || !process.env.TYPESAFE_API_KEY) return;
  const it = QUIZ.items.find((x) => !QUIZ.ans.jev[x.id]);
  if (!it) return;
  QUIZ.jevBusy = true;
  const t0 = Date.now();
  try {
    const a = await jevAsk(it);
    const p = it.kind === "noul" ? a.answer.noul : Number(a.answer.confidence);
    const pred = it.kind === "noul" ? undefined : a.answer.choice;
    QUIZ.ans.jev[it.id] = { ...grade(it, p, pred, a.answer.probabilities), ms: Date.now() - t0, cost: a.__meta.cost, raw: a.answer };
  } catch (e) {
    QUIZ.ans.jev[it.id] = { error: String(e.message ?? e).slice(0, 120), ok: false, brier: 1, ms: Date.now() - t0 };
  } finally {
    QUIZ.jevBusy = false;
  }
}, Number(process.env.QUIZ_TICK || 1200));

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      return send(res, 200, {
        keyConfigured: Boolean(process.env.TYPESAFE_API_KEY),
        model: "jev-latest",
        // Jev 走哪种架构：full = 全部合法落点自己排；prune = 代码先淘汰会造洞的再让它裁量
        jevMode: process.env.JEV_PRUNE ? `prune-${process.env.JEV_PRUNE}` : "full",
      });
    }

    if (req.method === "GET" && url.pathname === "/api/questions") {
      return send(res, 200, questions);
    }

    // 缓存的是 Jev 的原始答案，归一化在这里做 —— 改 normalize 不必重新推理。
    // 但签名不符就是另一套题目的答案了，必须当没缓存，否则题面改完页面还在演旧分数。
    if (req.method === "GET" && url.pathname === "/api/dataset") {
      const cached = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : null;
      const fresh = cached?.signature === QUESTIONS_SIGNATURE && cached?.entries?.length === cases.length;
      if (cached && !fresh) console.log(`缓存签名 ${cached.signature} ≠ 当前 ${QUESTIONS_SIGNATURE}，按未缓存处理`);
      const entries = fresh ? cached.entries : [];
      const items = cases.map((c, i) => ({
        expect: c.expect,
        msg: c.msg,
        v: entries[i]?.answers ? normalize(entries[i].answers) : null,
      }));
      return send(res, 200, { fromCache: items.every((x) => x.v), signature: QUESTIONS_SIGNATURE, items });
    }

    // 每次真实评估都落一条审计。没有「人工是否推翻」这个回流环，
    // 能算出来的只有代理准确率（对上一个启发式标注），永远算不出真实错误率。
    if (req.method === "POST" && url.pathname === "/api/evaluate") {
      const { state, thresholds } = await readBody(req);
      if (!state?.trim()) return send(res, 400, { error: "state 不能为空" });
      if (!process.env.TYPESAFE_API_KEY) return send(res, 500, { error: "服务端未设置 TYPESAFE_API_KEY" });
      const answers = await askJev(state, questions);
      const { __meta, ...rest } = answers;
      const v = normalize(rest);
      const th = { ...DEFAULTS, ...(thresholds ?? {}) };
      const d = decide(v, th);
      const log = logDecision({
        pack: { id: "triage" }, item: state, v, meta: __meta,
        decision: { action: d.rung, why: d.why, trace: d.trace },
      });
      return send(res, 200, { raw: rest, v, meta: __meta, verdict: d, auditId: log.id, thresholdsUsed: th });
    }

    if (req.method === "GET" && url.pathname === "/api/audit") {
      const rows = readAudit();
      return send(res, 200, { stats: auditStats(), recent: rows.slice(-30).reverse() });
    }

    if (req.method === "POST" && url.pathname === "/api/review") {
      const { id, overturned, expect, note } = await readBody(req);
      if (!id) return send(res, 400, { error: "缺少决策 id" });
      markReview(id, { overturned: Boolean(overturned), expect: expect ?? null, note: note ?? null });
      return send(res, 200, { ok: true, stats: auditStats() });
    }

    // 需求雷达：概率来自 Jev，「建议回复」是 bossPack.decide 的本地查表
    if (req.method === "GET" && url.pathname === "/api/boss") {
      const { bossThread } = await import("../jevkit/packs/boss.mjs");
      return send(res, 200, { thread: bossThread.map((t) => t.text) });
    }

    if (req.method === "POST" && url.pathname === "/api/boss") {
      const { messages } = await readBody(req);
      if (!Array.isArray(messages) || !messages.length) return send(res, 400, { error: "缺少 messages" });
      if (!process.env.TYPESAFE_API_KEY) return send(res, 500, { error: "服务端未设置 TYPESAFE_API_KEY" });
      const { getPack } = await import("../jevkit/pack.mjs");
      await import("../jevkit/packs/boss.mjs");
      const pack = getPack("boss");
      const last = String(messages[messages.length - 1] ?? "");
      const item = {
        text: last,
        role: "老板",
        thread: messages.slice(0, -1).map((m) => ({ role: "老板", text: String(m) })),
      };
      const { v, meta } = await askPack(pack, item);
      const d = pack.decide(v, undefined, { item });
      const log = logDecision({ pack, item, v, meta, decision: d });
      return send(res, 200, { v, why: d.why, action: d.action, trace: d.trace, lints: pack.lint, meta, auditId: log.id });
    }

    // Jev 只负责“在代码算好的合法落点里挑一个”——枚举与算数全在代码侧
    if (req.method === "POST" && url.pathname === "/api/tetris-move") {
      const { board, shape, next, cands } = await readBody(req);
      if (!process.env.TYPESAFE_API_KEY) return send(res, 500, { error: "服务端未设置 TYPESAFE_API_KEY" });
      if (!Array.isArray(cands) || !cands.length) return send(res, 400, { error: "没有合法落点" });
      const { move, risky, meta } = await jevChoose(board, shape, next, cands);
      return send(res, 200, {
        move,
        risky,
        baseline: heuristicPick(cands).id,
        picked: cands.find((c) => c.id === move.choice) ?? null,
        cands: cands.map(({ cells, picture, ...light }) => light),
        meta: { model: meta.model, usage: meta.usage, ms: meta.ms, cost: meta.cost },
      });
    }

    if (req.method === "GET" && url.pathname === "/api/race") {
      return send(res, 200, { jev: snapshot(JEV), me: snapshot(MINE), jevBusy });
    }

    if (req.method === "POST" && url.pathname === "/api/race/move") {
      const { id } = await readBody(req);
      if (MINE.over) return send(res, 409, { error: "我方已顶出，需先重开" });
      if (!step(MINE, id)) return send(res, 400, { error: `非法落点 ${id}`, ok: candidates(MINE).map((c) => c.id) });
      MINE.last = { id };
      return send(res, 200, snapshot(MINE));
    }

    if (req.method === "POST" && url.pathname === "/api/race/reset") {
      resetRace();
      return send(res, 200, { jev: snapshot(JEV), me: snapshot(MINE) });
    }

    if (req.method === "GET" && url.pathname === "/api/quiz") {
      return send(res, 200, {
        total: QUIZ.items.length,
        items: QUIZ.items.map(({ oracle, ...pub }) => pub),
        oracles: Object.fromEntries(QUIZ.items.map((x) => [x.id, x.oracle])),
        ans: QUIZ.ans,
        sum: { jev: summary("jev"), me: summary("me") },
        jevBusy: QUIZ.jevBusy,
      });
    }

    // 选手端：只给题目和题号，绝不给 oracle，也不给对手答案
    if (req.method === "GET" && url.pathname === "/api/quiz/ask") {
      const it = QUIZ.items.find((x) => !QUIZ.ans.me[x.id]);
      if (!it) return send(res, 200, { done: true });
      const { oracle, ...pub } = it;
      return send(res, 200, { ...pub, remaining: QUIZ.items.filter((x) => !QUIZ.ans.me[x.id]).length });
    }

    if (req.method === "POST" && url.pathname === "/api/quiz/answer") {
      const { id, p, pred, predIndex, probs } = await readBody(req);
      const it = QUIZ.items.find((x) => x.id === id);
      if (!it) return send(res, 400, { error: `没有题号 ${id}` });
      if (QUIZ.ans.me[id]) return send(res, 409, { error: `${id} 已作答` });
      if (typeof p !== "number") return send(res, 400, { error: "缺少概率 p" });
      QUIZ.ans.me[id] = { ...grade(it, p, resolvePred(it, { pred, predIndex }), probs), ms: 0, cost: 0 };
      return send(res, 200, { ok: true, remaining: QUIZ.items.filter((x) => !QUIZ.ans.me[x.id]).length });
    }

    // 一次性取出全部未答题（不含 oracle、不含对手答案），供选手一轮读完、逐题作答
    if (req.method === "GET" && url.pathname === "/api/quiz/all") {
      const left = QUIZ.items.filter((x) => !QUIZ.ans.me[x.id]);
      return send(res, 200, { remaining: left.length, items: left.map(({ oracle, ...pub }) => pub) });
    }

    if (req.method === "POST" && url.pathname === "/api/quiz/bulk") {
      const { answers } = await readBody(req);
      if (!Array.isArray(answers)) return send(res, 400, { error: "answers 需为数组" });
      let done = 0;
      const rejected = [];
      for (const a of answers) {
        const it = QUIZ.items.find((x) => x.id === a.id);
        if (!it || QUIZ.ans.me[it.id] || typeof a.p !== "number") { rejected.push(a?.id); continue; }
        QUIZ.ans.me[it.id] = { ...grade(it, a.p, resolvePred(it, a), a.probs), ms: a.ms ?? 0, cost: 0 };
        done++;
      }
      return send(res, 200, { ok: true, recorded: done, rejected, remaining: QUIZ.items.filter((x) => !QUIZ.ans.me[x.id]).length });
    }

    if (req.method === "POST" && url.pathname === "/api/quiz/reset") {
      resetQuiz();
      return send(res, 200, { ok: true, total: QUIZ.items.length });
    }

    return send(res, 404, { error: "not found" });
  } catch (err) {
    return send(res, 502, { error: String(err?.message ?? err) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Jev 分诊 API 代理 → http://127.0.0.1:${PORT}`);
  console.log(`TYPESAFE_API_KEY: ${process.env.TYPESAFE_API_KEY ? "已加载（仅存在于本进程，不下发浏览器）" : "未设置 —— /api/evaluate 会报错"}`);
});
