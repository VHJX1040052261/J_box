import { listPacks, getPack } from "./pack.mjs";
import { runPack, tetrisCases } from "./run.mjs";
import { summarize, fmtSummary } from "./eval.mjs";
import { auditStats } from "./audit.mjs";
import "./packs/triage.mjs";
import "./packs/verify.mjs";
import "./packs/tetris.mjs";

const SAMPLE = Number(process.env.SAMPLE || 1);

console.log(`\n═══ jevkit 内核自检：${listPacks().length} 个题包 ═══`);
for (const p of listPacks()) {
  console.log(`  ${p.id.padEnd(8)} ${p.title}  lint 告警 ${p.lint.length} 条 / 已豁免 ${p.waived.length} 条`);
  for (const w of p.waived) console.log(`      （已豁免 ${w.qid}：${w.why}）`);
}

for (const id of ["triage", "verify", "tetris"]) {
  const pack = getPack(id);
  console.log(`\n── ${pack.id}：${pack.title}`);
  for (const w of pack.lint) console.log(`   ⚠ lint: ${w}`);

  const items = id === "tetris" ? tetrisCases(8) : pack.cases;
  const t0 = Date.now();
  const rows = await runPack(pack, items, { sample: SAMPLE, onEach: (r, i, n) => { if ((i + 1) % 10 === 0 || i + 1 === n) process.stdout.write(`   进度 ${i + 1}/${n}\n`); } });
  console.log(fmtSummary({ ...summarize(rows, pack.title), label: pack.title }));

  const wrong = rows.filter((r) => r.ok === false).slice(0, 5);
  if (wrong.length) {
    console.log("   判错样本：");
    for (const r of wrong) console.log(`     · ${String(r.why).slice(0, 58)}  ← ${r.item.msg || r.item.state || r.item.claim || r.item.piece || ""}`.replace(/\n/g, " ").slice(0, 130));
  }
  console.log(`   墙钟 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

console.log("\n═══ 审计日志累计（jevkit/audit.jsonl）═══");
console.log(JSON.stringify(auditStats(), null, 1));
console.log("\n注：trueErrorRate 为 null 是因为还没有人工复核回流 —— 那是唯一能算出真实错误率的入口。");
