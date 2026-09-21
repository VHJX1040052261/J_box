import { askJev } from "./jev.mjs";
import { questions, normalize } from "./prompt.mjs";
import { cases } from "./cases.mjs";
import { decide, deterministicRung, llmRung, EXPECT_RUNG } from "./router.mjs";

let tokens = 0, cost = 0, worstMs = 0;
const tally = { code: 0, llm: 0, human: 0 };
let matched = 0;

for (const [i, { msg, expect }] of cases.entries()) {
  const { __meta, ...answers } = await askJev(msg, questions);
  const v = normalize(answers);
  const { rung, why } = decide(v);
  const priority = v.urgent > 0.8 ? "加急" : "常规";
  const ok = rung === EXPECT_RUNG[expect];

  tokens += __meta.usage.input_tokens;
  cost += __meta.cost;
  worstMs = Math.max(worstMs, __meta.ms);
  tally[rung]++;
  if (ok) matched++;

  console.log(`\n─── #${i + 1} 期望=${expect.padEnd(10)} ${msg.slice(0, 40)}${msg.length > 40 ? "…" : ""}`);
  console.log(`   intent=${answers.intent.choice.padEnd(9)} conf=${v.conf.toFixed(2)} effort=${v.effort.toFixed(2)} disc=${v.discretion.toFixed(2)} 高危=${v.high_stakes.toFixed(2)} 紧急=${v.urgent.toFixed(2)}`);
  console.log(`   → ${rung.toUpperCase().padEnd(5)} 优先级=${priority} | ${why} ${ok ? "✓" : `✗ 期望 ${EXPECT_RUNG[expect].toUpperCase()}`}`);
  if (rung === "code") console.log(`   ✓ ${deterministicRung(answers.intent.choice)}`);
  if (rung === "llm") console.log(`   → ${await llmRung(msg, answers.intent.choice)}`);
  if (rung === "human") console.log(`   → 进人工队列`);
  console.log(`   ${__meta.usage.input_tokens} tok  $${__meta.cost.toFixed(7)}  ${__meta.ms}ms  ${__meta.model}`);
}

console.log(`\n=== ${cases.length} 条 / ${tokens} tok / $${cost.toFixed(6)} / 最慢单次 ${worstMs}ms ===`);
console.log(`分流 code:${tally.code} llm:${tally.llm} human:${tally.human}  档位完全命中 ${matched}/${cases.length}`);
console.log(`折算 100 万条 ≈ $${(cost / cases.length * 1e6).toFixed(2)}  1 美元 ≈ ${Math.round(1 / (cost / cases.length)).toLocaleString("en-US")} 条`);
