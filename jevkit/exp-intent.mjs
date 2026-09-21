/**
 * A/B：只改 intent 的题面 rubric，阈值和用例完全不变，看准确率变化是 rubric 的还是碰运气。
 * 旧 rubric 里没有履约/订单这一档，#45120 那条被判 unknown(0.97) —— 那是我的分类表缺档，不是 Jev 错。
 */
import { askJev } from "../jev.mjs";
import { questions as NEW_Q, normalize } from "../prompt.mjs";
import { decide } from "../policy.mjs";
import { cases } from "../cases.mjs";

const OLD_INTENT = {
  type: "choice",
  instructions: "Which team should handle this customer message?",
  criteria: {
    billing: "Payments, invoices, refunds, subscription or payment-provider problems",
    technical: "Bugs, outages, login failures, integration or API problems",
    sales: "Pricing, plan features, upgrades, pre-sales questions about buying",
    unknown: "Nothing above fits: the message has no concrete actionable problem, is chit-chat, or is too vague to assign",
  },
};

const arms = {
  old: { ...NEW_Q, intent: OLD_INTENT },
  new: NEW_Q,
};

const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
// 数值取中位数，choice 取多数票，概率分布对象不参与合并
const merge = (runs) => Object.fromEntries(Object.keys(runs[0]).map((k) => {
  const vals = runs.map((r) => r[k]);
  if (typeof vals[0] === "number") return [k, med(vals)];
  if (typeof vals[0] === "boolean" || typeof vals[0] === "string") {
    return [k, vals.sort((a, b) => vals.filter((x) => x === b).length - vals.filter((x) => x === a).length)[0]];
  }
  return [k, vals[0]];
}));

const SAMPLE = Number(process.env.SAMPLE || 3);
const tally = {};

for (const [arm, q] of Object.entries(arms)) {
  tally[arm] = { hit: 0, rows: [] };
  for (const c of cases) {
    const runs = [];
    for (let i = 0; i < SAMPLE; i++) runs.push(normalize(await askJev(c.msg, q)));
    const v = merge(runs);
    const d = decide(v);
    const want = { auto: "code", specialist: "llm", human: "human" }[c.expect];
    const ok = d.rung;
    tally[arm].hit += ok === want;
    tally[arm].rows.push({ msg: c.msg, want, got: ok, ok: ok === want, v, why: d.why });
  }
}

const fmt = (x) => (x >= 0.995 ? "1.00" : x.toFixed(2));
console.log(`\n同一批 ${cases.length} 条用例 × ${SAMPLE} 次采样取中位数，只有 intent rubric 不同：\n`);
for (const [arm, t] of Object.entries(tally)) {
  console.log(`  ${arm} 分诊准确率 ${t.hit}/${cases.length} = ${(t.hit / cases.length * 100).toFixed(0)}%`);
}
console.log("\n逐条对照（只列两臂结论不同或任一臂判错的）：\n");
for (let i = 0; i < cases.length; i++) {
  const a = tally.old.rows[i], b = tally.new.rows[i];
  if (a.ok && b.ok && a.got === b.got) continue;
  console.log(`  #${i + 1} 期望 ${a.want.padEnd(5)} | 旧 ${a.got.padEnd(5)} conf=${fmt(a.v.conf)} intent=${a.v.choice.padEnd(11)} ${a.ok ? "✓" : "✗"}`);
  console.log(`           期望 ${b.want.padEnd(5)} | 新 ${b.got.padEnd(5)} conf=${fmt(b.v.conf)} intent=${b.v.choice.padEnd(11)} ${b.ok ? "✓" : "✗"}   ${b.why}`);
  console.log(`           ${a.msg.replace(/\s+/g, " ").slice(0, 78)}`);
}
