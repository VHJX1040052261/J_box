/**
 * state 的「形状」是一个没人告诉我的变量：文档说可以是 string 也可以是结构化对象，
 * 但没说把同一段文本包进对象会不会改变判断。上一轮实测它确实改变 —— 这条把它测准。
 * A 档 12 题：机械可判、答案唯一，所以 p 的偏移只能是打包方式造成的。
 */
import { askJev } from "../jev.mjs";
import { quizItems } from "../quiz.mjs";

const K = Number(process.env.K || 5);
const items = quizItems().filter((it) => it.block === "A");
const q = (it) => ({ answer: { type: "noul", instructions: it.question } });
const asObject = (it) => ({ kind: it.kind, question: it.question, options: it.options, text: it.state });

const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const spread = (xs) => Math.max(...xs) - Math.min(...xs);
let cost = 0;
const rows = [];

for (const it of items) {
  const bare = [], obj = [];
  let tokBare = 0, tokObj = 0;
  for (let i = 0; i < K; i++) {
    // 交替发送，避免把「先后顺序」带来的漂移算到「形状」头上
    let a = await askJev(it.state, q(it)); bare.push(a.answer.noul); cost += a.__meta.cost;
    tokBare = a.__meta.usage.input_tokens;
    a = await askJev(asObject(it), q(it)); obj.push(a.answer.noul); cost += a.__meta.cost;
    tokObj = a.__meta.usage.input_tokens;
  }
  rows.push({ id: it.id, bare, obj, tokBare, tokObj, truth: Number(it.oracle) });
}

console.log(`\n═══ 同一段文本：裸 string vs 包成 JSON 对象（A 档 ${items.length} 题 × ${K} 次交替采样，$${cost.toFixed(5)}）═══\n`);
console.log("  题号   裸文本p  极差   对象p   极差   Δp     真值  二元Brier 裸→对象");
let shifted = 0, up = 0, down = 0;
const brier = (r, key) => r[key].reduce((s, p) => s + (p - r.truth) ** 2, 0) / r[key].length;
for (const r of rows) {
  const mb = med(r.bare), mo = med(r.obj), d = mo - mb;
  if (Math.abs(d) > 0.05) { shifted++; d < 0 ? down++ : up++; }
  console.log(`  ${r.id.padEnd(4)}  ${mb.toFixed(2)}    ${spread(r.bare).toFixed(2)}   ${mo.toFixed(2)}   ${spread(r.obj).toFixed(2)}  ${(d >= 0 ? "+" : "") + d.toFixed(2)}   ${r.truth}    ${brier(r, "bare").toFixed(3)} → ${brier(r, "obj").toFixed(3)}`);
}
const avg = (k) => rows.reduce((s, r) => s + brier(r, k), 0) / rows.length;
console.log(`\n  p 偏移 >0.05 的：${shifted}/${rows.length} 题（变低 ${down}、变高 ${up}）`);
console.log(`  平均二元 Brier（越低越准）：裸文本 ${avg("bare").toFixed(4)} vs 对象 ${avg("obj").toFixed(4)}`);
console.log(`  平均极差：裸文本 ${(rows.reduce((s, r) => s + spread(r.bare), 0) / rows.length).toFixed(3)} vs 对象 ${(rows.reduce((s, r) => s + spread(r.obj), 0) / rows.length).toFixed(3)}`);
console.log(`  平均 input tokens：裸 ${Math.round(rows.reduce((s, r) => s + r.tokBare, 0) / rows.length)} vs 对象 ${Math.round(rows.reduce((s, r) => s + r.tokObj, 0) / rows.length)}（对象还更贵）`);
console.log("\n  结论进内核：pack.askPack 只把 pack.stateFor(item) 的返回值发给 Jev，");
console.log("  题型/选项一律走 questions(state, item) 的第二参数，不允许混进 state。");
