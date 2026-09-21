import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { askJev } from "./jev.mjs";
import { questions, normalize, QUESTIONS_SIGNATURE } from "./prompt.mjs";
import { cases } from "./cases.mjs";
import { decide, EXPECT_RUNG } from "./router.mjs";

const CACHE = ".jev_raw_judgments.json";
// 题目一改，缓存的判断就是另一套语义；用签名强制失效，避免拿旧分数评新策略。
// v2 起缓存存原始答案而非归一化结果，换 normalize 不必重新推理。
const signature = QUESTIONS_SIGNATURE; // 签名跟着题面走，见 prompt.mjs

async function judgments() {
  if (existsSync(CACHE)) {
    const cached = JSON.parse(readFileSync(CACHE, "utf8"));
    if (cached.signature === signature && cached.entries.length === cases.length) {
      console.log(`复用缓存判断 ${cached.entries.length} 条（签名 ${signature}，0 token 0 花费）\n`);
      return cached.entries;
    }
    console.log(`缓存签名不符（${cached.signature} ≠ ${signature}），题目已改，重新推理\n`);
  }
  const entries = [];
  let tokens = 0;
  for (const { msg, expect } of cases) {
    const { __meta, ...answers } = await askJev(msg, questions);
    tokens += __meta.usage.input_tokens;
    entries.push({ msg, expect, answers });
    process.stdout.write("·");
  }
  console.log(`\n推理 ${entries.length} 条完成，共 ${tokens} tok，已缓存到 ${CACHE}\n`);
  writeFileSync(CACHE, JSON.stringify({ signature, entries }, null, 2));
  return entries;
}

const rows = (await judgments()).map((e) => ({ ...normalize(e.answers), expect: e.expect, msg: e.msg }));

console.log("=== Jev 原始判断（阈值无关）===");
console.log("期望        conf  effort  disc  高危  紧急  unknown  摘要");
for (const r of rows) {
  console.log(
    r.expect.padEnd(11),
    r.conf.toFixed(2).padStart(4),
    r.effort.toFixed(2).padStart(7),
    r.discretion.toFixed(2).padStart(6),
    r.high_stakes.toFixed(2).padStart(6),
    r.urgent.toFixed(2).padStart(6),
    String(r.unknown).padStart(8), "  ",
    r.msg.replace(/\s+/g, " ").slice(0, 30),
  );
}

const grid = {
  intentMinConfidence: [0, 0.3, 0.5, 0.7, 0.9],
  stakeThreshold: [0.5, 0.6, 0.7, 0.8, 1.01],
  discretionToHuman: [0.8, 1.1, 1.4, 1.7, 2.01],
  effortToSpecialist: [0.6, 0.9, 1.2, 1.5, 1.9],
};
const keys = Object.keys(grid);
const results = [];

for (const intentMinConfidence of grid.intentMinConfidence)
  for (const stakeThreshold of grid.stakeThreshold)
    for (const discretionToHuman of grid.discretionToHuman)
      for (const effortToSpecialist of grid.effortToSpecialist) {
        const th = { intentMinConfidence, stakeThreshold, discretionToHuman, effortToSpecialist };
        let auto = 0, spec = 0, human = 0, danger = 0, waste = 0, matched = 0;
        for (const r of rows) {
          const { rung } = decide(r, th);
          if (rung === "code") auto++; else if (rung === "human") human++; else spec++;
          if (rung === EXPECT_RUNG[r.expect]) matched++;
          // 越权自动化：该人工的被自动办了，或该 specialist 的用确定性模板打发
          if (r.expect === "human" && rung !== "human") danger++;
          if (r.expect === "specialist" && rung === "code") danger++;
          // 过度升级：本可低档位处理的白占人工席位
          if (r.expect === "auto" && rung === "human") waste++;
          if (r.expect === "specialist" && rung === "human") waste++;
          if (r.expect === "auto" && rung === "llm") waste++;
        }
        results.push({ th, auto, spec, human, danger, waste, matched });
      }

const n = rows.length;
const nHuman = rows.filter((r) => r.expect === "human").length;
const nSpec = rows.filter((r) => r.expect === "specialist").length;
const nAuto = rows.filter((r) => r.expect === "auto").length;
console.log(`\n=== ${results.length} 组阈值组合，全部复用同一批判断（零额外花费）===`);
console.log(`基数：应人工 ${nHuman} / 应 specialist ${nSpec} / 应自动 ${nAuto}\n`);

results.sort((a, b) => a.danger - b.danger || b.matched - a.matched || a.waste - b.waste);
console.log("conf≥  高危>  disc>  effort> | 自动 专家 人工 | 完全命中 越权 过度升级");
for (const r of results.slice(0, 12)) {
  const t = r.th;
  console.log(
    String(t.intentMinConfidence).padEnd(6),
    String(t.stakeThreshold).padEnd(6),
    String(t.discretionToHuman).padEnd(6),
    String(t.effortToSpecialist).padEnd(9), "|",
    String(r.auto).padStart(3), String(r.spec).padStart(3), String(r.human).padStart(3), "|",
    String(`${r.matched}/${n}`).padStart(8), String(r.danger).padStart(5), String(r.waste).padStart(9),
  );
}

const best = results[0];
const lo = Math.min(...results.map((r) => r.danger));
console.log(`\n最低越权 = ${lo}（共 ${results.filter((r) => r.danger === lo).length} 组并列，已按命中率排序）`);
console.log(`推荐: conf≥${best.th.intentMinConfidence} 高危>${best.th.stakeThreshold} disc>${best.th.discretionToHuman} effort>${best.th.effortToSpecialist}`);
console.log(`  → 自动 ${best.auto}/${n} (${(best.auto / n * 100).toFixed(0)}%) 专家 ${best.spec} 人工 ${best.human}，完全命中 ${best.matched}/${n}，越权 ${best.danger}，过度升级 ${best.waste}`);
const maxAuto = results.filter((r) => r.danger <= lo + 1).sort((a, b) => b.auto - a.auto || b.matched - a.matched)[0];
console.log(`  越权≤${lo + 1} 里自动化最激进: conf≥${maxAuto.th.intentMinConfidence} 高危>${maxAuto.th.stakeThreshold} disc>${maxAuto.th.discretionToHuman} effort>${maxAuto.th.effortToSpecialist} → 自动 ${maxAuto.auto}，命中 ${maxAuto.matched}/${n}，越权 ${maxAuto.danger}`);
