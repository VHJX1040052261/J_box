/**
 * 把聊天截图那套「Jev 实时判断老板需求」真跑一遍，并且顺手检验图里最可疑的那一条：
 * 「明天能上线吧 → 正常开发 0% / 演示版 88%」。同一道题在 5 条消息上各采 K 次，
 * 如果它对每条消息给出的概率都差不多、而且不随对话推进而变，那这个数就是编的。
 */
import { askJev } from "../jev.mjs";
import { getPack } from "./pack.mjs";
import "./packs/boss.mjs";
import { runPack } from "./run.mjs";
import { bossThread } from "./packs/boss.mjs";

const pack = getPack("boss");

console.log(`\n═══ 题包注册：${pack.title} ═══`);
for (const w of pack.lint) console.log(`  ⚠ lint: ${w}`);
if (!pack.lint.length) console.log("  （lint 没报 —— 说明守卫没生效，这本身就是问题）");

const SAMPLE = Number(process.env.SAMPLE || 1);
const rows = await runPack(pack, bossThread, { sample: SAMPLE });

console.log(`\n── 逐条判断（概率来自 Jev，「建议」是本地查表，不是它写的）──\n`);
for (const [i, r] of rows.entries()) {
  const v = r.v;
  console.log(`  第 ${i + 1} 条  「${r.item.text}」`);
  console.log(`    淡化了范围 ${v.under_scope.toFixed(2)}   新增独立目标 ${v.new_goal.toFixed(2)}   索要时间承诺 ${v.time_commit.toFixed(2)}`);
  console.log(`    「简单点」= ${v.simple_means.padEnd(11)} 置信 ${v.simple_conf.toFixed(2)}   返工范围折算 ${v.risk10}/10`);
  console.log(`    已谈定 ${v.settled.toFixed(2)}  →  ${r.action.padEnd(8)} ${r.why}`);
  console.log(`    ${r.meta.usage.input_tokens} tok  $${r.meta.cost.toFixed(6)}  ${r.meta.ms}ms`);
  console.log();
}

const K = Number(process.env.K || 5);
console.log(`\n── 检验图里那句「明天能上线 → 演示版 88%」：同一道前瞻题，每条消息采 ${K} 次 ──\n`);
const probe = [];
for (const [i, item] of bossThread.entries()) {
  const ps = [];
  for (let n = 0; n < K; n++) {
    const a = await askJev(pack.stateFor(item), { q: pack.questions.deliverable_by_tomorrow });
    ps.push(a.q.noul);
  }
  ps.sort((x, y) => x - y);
  probe.push({ i, med: ps[Math.floor(K / 2)], min: ps[0], max: ps[K - 1] });
}
for (const p of probe) {
  console.log(`  第 ${p.i + 1} 条  中位 ${p.med.toFixed(2)}  区间 ${p.min.toFixed(2)}–${p.max.toFixed(2)}   「${bossThread[p.i].text}」`);
}
const meds = probe.map((p) => p.med);
const band = Math.max(...meds) - Math.min(...meds);
console.log(`\n  5 条消息的中位概率跨度 = ${band.toFixed(2)}。`);
console.log(`  「在吗？有个小需求」和「明天能上线吧」对同一道前瞻题给出的概率${band < 0.15 ? "几乎一样" : "有差别"} ——`);
console.log(band < 0.15
  ? "  说明它读不出「哪条在问工期」，这个数对任何消息都是同一个常数，截图里那种 0%/12%/88% 的分布不是 Jev 能给的。"
  : "  至少它对不同消息有区分度，但仍无对照真值可判对错（前瞻题没有 oracle）。");
