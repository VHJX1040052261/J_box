/**
 * 同一套题、同一个机械 oracle，两个选手：Jev（内核题包）vs 我（模型作答，答案预先落在 pk-answers.json）。
 * 之所以答案是我在对话里逐条写完再提交，而不是让代码替我「模拟一个对手」：
 * 那样得出的对比只能说明启发式行不行，说明不了模型行不行。
 *
 * 判分口径两边一致：noul 用二元 Brier，choice 用多类 Brier。
 * Jev 交的是真实概率分布；我只交点估计，pk-answers.json 的 p 会被展开成
 * 「所选拿 p、其余均分 1−p」后再算 Brier —— 不会因为我给不出分布就免测校准。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { quizItems, gradeItem } from "../quiz.mjs";
import { runPack } from "./run.mjs";
import { summarize, fmtSummary } from "./eval.mjs";
import { verifyPack } from "./packs/verify.mjs";

const items = quizItems();
const mine = JSON.parse(readFileSync(new URL("./pk-answers.json", import.meta.url), "utf8"));
const byId = Object.fromEntries(mine.map((m) => [m.id, m]));

const meRows = items.map((it, i) => {
  const a = byId[it.id];
  if (!a) return { i, item: it, action: null, why: "未作答", ok: false, brier: 1 };
  // pk-answers.json 里的 p 一律是「对我所选答案的把握」，而 gradeItem 要的是 P(yes)。
  // 直接把把握当 P(yes) 会把「笃定地答否」算成笃定地答是 —— 上一版就是这样误判我错了 5 条。
  const p = it.kind === "noul" ? (a.pred === "yes" ? a.p : 1 - a.p) : a.p;
  const g = gradeItem(it, p, a.pred, null);
  return { i, item: it, action: a.pred, why: `p=${p.toFixed(2)}`, ok: g.ok, brier: g.brier };
});

const CACHE = new URL("./.pk-jev.json", import.meta.url);
let jevRows;
if (process.env.PK_REUSE && existsSync(CACHE)) {
  jevRows = JSON.parse(readFileSync(CACHE, "utf8"));
  console.log(`（Jev 臂复用上次结果，本次未花钱）`);
} else {
  jevRows = await runPack(verifyPack, items, { sample: Number(process.env.SAMPLE || 3) });
  writeFileSync(CACHE, JSON.stringify(jevRows.map(({ item, ...r }) => r)));
}

const A = summarize(jevRows, "Jev (jev-latest)");
const B = summarize(meRows, "我（点估计）");

const pct = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
console.log(`\n═══ 判断力同台：${items.length} 条机械可判分题 ═══\n`);
console.log("                        准确率      平均Brier↓    p50延迟    单条成本");
for (const s of [A, B]) {
  console.log(
    `  ${s.label.padEnd(20)}${pct(s.acc).padStart(7)}   ${s.brier.toFixed(4).padStart(9)}   ` +
    `${(s.p50ms == null ? "—" : s.p50ms + "ms").padStart(8)}   ${s.cost ? "$" + (s.cost / s.n).toFixed(6) : "—"}`);
}

console.log("\n逐题对照（只列至少一方判错的）：");
for (let i = 0; i < items.length; i++) {
  if (jevRows[i].ok && meRows[i].ok) continue;
  const it = items[i];
  console.log(`  ${it.id} 答案=${String(it.oracle).padEnd(4)} | Jev ${(jevRows[i].action ?? "—").toString().padEnd(4)} ${jevRows[i].ok ? "✓" : "✗"} p=${jevRows[i].v?.p?.toFixed(2)} | 我 ${(meRows[i].action ?? "—").toString().padEnd(4)} ${meRows[i].ok ? "✓" : "✗"} p=${byId[it.id]?.p.toFixed(2)}`);
  console.log(`      ${it.state.replace(/\s+/g, " ").slice(0, 96)}`);
}

console.log("\n分档位准确率：");
for (const blk of ["A", "B", "C"]) {
  const idx = items.map((it, i) => (it.block === blk ? i : -1)).filter((i) => i >= 0);
  const j = idx.filter((i) => jevRows[i].ok).length, m = idx.filter((i) => meRows[i].ok).length;
  console.log(`  ${blk} (${idx.length}题)  Jev ${j}/${idx.length}   我 ${m}/${idx.length}`);
}

// 双方全对时，成绩就没信息量了 —— 有信息量的是「谁在哪个字上心虚」
// 两边都换算成「对自己所选答案的把握」，否则 noul 的 P(yes) 和我的答题把握不是同一个量
const rowsX = items.map((it, i) => ({
  id: it.id,
  jev: it.kind === "noul" ? Math.max(jevRows[i].v.p, 1 - jevRows[i].v.p) : jevRows[i].v.p,
  me: byId[it.id].p,
  runner: jevRows[i].v.probs ? Object.values(jevRows[i].v.probs).sort((a, b) => b - a)[1] : null,
}));
const gap = rowsX.map((r) => ({ ...r, d: Math.abs(r.jev - r.me) })).sort((a, b) => b.d - a.d).slice(0, 6);
console.log("\n把握度分歧最大的 6 题（都是双方答对的题，比的是校准而非对错）：");
for (const r of gap) {
  const runner = r.runner == null ? "" : `  Jev 次选 ${r.runner.toFixed(3)}`;
  console.log(`  ${r.id.padEnd(4)} Jev ${r.jev.toFixed(2)} vs 我 ${r.me.toFixed(2)}  差 ${r.d.toFixed(2)}${runner}`);
}
console.log("\n注意：这套题库是我自己造的，所以这是「出题人自测」，不是 held-out 盲测 ——");
console.log("      100% 只能说明 Jev 在出题人所理解的规则上与出题人一致，不能推广到未见的真实工单。");

console.log(`\n${fmtSummary({ ...A, label: "Jev 完整指标" })}`);
