/**
 * 检验内核里最值钱的一个假设：Jev 的 confidence 低，是否真的预示它这条会抖？
 * 如果是，「按概率门控 + 只在它心虚的地方多采样/走正则」就有依据；
 * 如果不是，askPackStable 的 k 次采样就是在给随机噪声交税。
 * A 档 12 条是刻意挑的：全部机械可判、且其中 4 条实测落在 0.5 附近。
 */
import { askJev } from "../jev.mjs";
import { quizItems, A_QUESTION } from "../quiz.mjs";

const K = Number(process.env.K || 9);
const items = quizItems().filter((it) => it.block === "A");
const TOK = /(¥|\$|€|元|美元|欧元|英镑|日元|dollar[s]?|euro[s]?|pound[s]?|sterling|yen|USD|RMB|EUR|GBP)/i;

let cost = 0;
const out = [];
for (const it of items) {
  const ps = [];
  for (let i = 0; i < K; i++) {
    const a = await askJev(it.state, { answer: { type: "noul", instructions: A_QUESTION } });
    ps.push(a.answer.noul);
    cost += a.__meta.cost;
  }
  const s = it.state, m = TOK.exec(s);
  const digits = [...s.matchAll(/\d/g)].map((x) => x.index);
  const numFirst = m && digits.length && Math.min(...digits) < m.index;
  ps.sort((a, b) => a - b);
  const med = ps[Math.floor(K / 2)];
  // 抖 = k 次里跨越 0.5 判定线；不跨线的话再多噪声也不影响下游结论
  out.push({ id: it.id, med, min: ps[0], max: ps[K - 1], flips: ps.filter((p) => (p >= 0.5) !== (med >= 0.5)).length, numFirst, s });
}

const r = (x, y) => {
  const n = x.length, mx = x.reduce((a, b) => a + b) / n, my = y.reduce((a, b) => a + b) / n;
  const cov = x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0);
  return cov / Math.sqrt(x.reduce((s, v) => s + (v - mx) ** 2, 0) * y.reduce((s, v) => s + (v - my) ** 2, 0));
};

console.log(`\n═══ confidence 是否预测抖动（${items.length} 题 × ${K} 次独立调用，$${cost.toFixed(5)}）═══\n`);
console.log("  题号  中位p  极差   跨0.5次数  语序        原文");
for (const o of out) {
  console.log(`  ${o.id.padEnd(4)} ${o.med.toFixed(2)}  ${(o.max - o.min).toFixed(2)}   ${String(o.flips).padStart(2)}/${K}      ${(o.numFirst ? "数字在前" : "标记在前").padEnd(10)} ${o.s.replace(/\s+/g, " ").slice(0, 44)}`);
}

const near = out.filter((o) => Math.abs(o.med - 0.5) <= 0.25);
const far = out.filter((o) => Math.abs(o.med - 0.5) > 0.25);
const corr = r(out.map((o) => Math.abs(o.med - 0.5)), out.map((o) => o.max - o.min));
console.log(`\n  距判定线 ≤0.25 的 ${near.length} 题：平均极差 ${(near.reduce((s, o) => s + o.max - o.min, 0) / near.length).toFixed(3)}，出现跨线翻转 ${near.filter((o) => o.flips).length} 题`);
console.log(`  距判定线 >0.25 的 ${far.length} 题：平均极差 ${(far.reduce((s, o) => s + o.max - o.min, 0) / far.length).toFixed(3)}，出现跨线翻转 ${far.filter((o) => o.flips).length} 题`);
console.log(`  |p−0.5| 与极差的相关系数 r = ${corr.toFixed(2)}（越负说明「越心虚越抖」成立）`);
console.log(`  语序：数字在前 4 题中位 p ${(out.filter((o) => o.numFirst).map((o) => o.med).reduce((a, b) => a + b) / 4).toFixed(2)} vs 标记在前 ${(out.filter((o) => !o.numFirst).map((o) => o.med).reduce((a, b) => a + b) / 8).toFixed(2)}`);
