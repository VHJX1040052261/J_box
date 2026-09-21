/**
 * 打包多题是这里唯一的省钱手段（state 只摄取一次），但内核里 triage 的 k 次极差 0.123，
 * verify 只有 0.006 —— 差别看着像「一次问 5 题」vs「一次问 1 题」。
 * 先用 intent 试过：4 条工单上单题和打包的极差都是 0.000（全部饱和在 1.00），假设不成立，
 * 那份抖动来自 score 题而不是 choice 题，所以这里换成 effort 重测。
 * 如果打包让极差上升，那省钱和稳定就是一笔要明算的账。
 */
import { askJev } from "../jev.mjs";
import { questions } from "../prompt.mjs";
import { cases } from "../cases.mjs";

const K = Number(process.env.K || 9);
const pick = cases.filter((c, i) => [0, 5, 11, 13].includes(i)).map((c) => c.msg);
// intent 在这 4 条上全部饱和在 1.00，比不出抖动；effort 是 0–2 的连续分，才是会抖的那个
const FIELD = process.env.FIELD || "effort";
const single = { [FIELD]: questions[FIELD] };
// score 题取 .score，choice 取 .confidence，noul 取 .noul
const NJ = Object.keys(questions).length; // 打包那次一共拿回几道题的判断
const val = (a) => a[FIELD].score ?? a[FIELD].confidence ?? a[FIELD].noul;

let cost = 0;
const list = [];
for (const msg of pick) {
  const alone = [], packed = [];
  let t1 = 0, t5 = 0;
  for (let i = 0; i < K; i++) {
    // 交替发送，排除时间漂移
    let a = await askJev(msg, single); alone.push(val(a)); cost += a.__meta.cost;
    t1 = a.__meta.usage.input_tokens;
    a = await askJev(msg, questions); packed.push(val(a)); cost += a.__meta.cost;
    t5 = a.__meta.usage.input_tokens;
  }
  list.push({ msg, alone, packed, t1, t5 });
}

const rng = (xs) => Math.max(...xs) - Math.min(...xs);
const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log(`\n═══ 同一道 ${FIELD} 题：单题调用 vs 打包进 ${NJ} 题（${list.length} 条工单 × ${K} 次，$${cost.toFixed(5)}）═══\n`);
console.log("  单题p50  单题极差 | 打包p50  打包极差 | token 单题→打包   工单");
for (const r of list) {
  console.log(`  ${med(r.alone).toFixed(2)}     ${rng(r.alone).toFixed(2)}     |  ${med(r.packed).toFixed(2)}     ${rng(r.packed).toFixed(2)}     |   ${r.t1} → ${r.t5}   ${r.msg.replace(/\s+/g, " ").slice(0, 30)}`);
}
const a = list.reduce((s, r) => s + rng(r.alone), 0) / list.length;
const b = list.reduce((s, r) => s + rng(r.packed), 0) / list.length;

const tok1 = list.reduce((s, r) => s + r.t1, 0) / list.length;
const tokN = list.reduce((s, r) => s + r.t5, 0) / list.length;
console.log(`\n  平均极差：单题 ${a.toFixed(3)} vs 打包 ${b.toFixed(3)}  ${a > 0.001 ? `（打包/单题 ${(b / a).toFixed(1)}×）` : "（单题侧几乎为 0，倍率无意义）"}`);
console.log(`  平均 token：单次 ${Math.round(tok1)}（1 判断）vs ${Math.round(tokN)}（${NJ} 判断）`);
console.log(`  折算每个判断：单题 ${Math.round(tok1)} tok vs 打包 ${Math.round(tokN / NJ)} tok，省 ${Math.round((1 - tokN / NJ / tok1) * 100)}%`);
console.log("\n  读法：打包让其余题共用同一次 state 摄取，所以每个判断的均价该下降；");
console.log("  要盯的是极差有没有跟着上升 —— 那才说明省下来的钱是拿稳定性换的。");
