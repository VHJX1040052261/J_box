#!/usr/bin/env node
/**
 * 盒子的命令行门面。存在的理由不是给人敲，而是：任何能跑 shell 的模型都能用这个盒子，
 * 不依赖它是否支持 MCP。MCP 是首选路径，CLI 是保底路径。
 *
 *   node jevbox/cli.mjs verify '{"claim":"...","evidence":"..."}'
 *   node jevbox/cli.mjs guardrail '{"text":"..."}'
 *   node jevbox/cli.mjs screen '{"items":[...],"what":"..."}'
 */
import { runPreset, screen, patchQuestions } from "./box.mjs";
import { PRESETS } from "./presets.mjs";

const [cmd, argJson] = process.argv.slice(2);

if (!cmd || cmd === "help" || cmd === "--list") {
  console.log(JSON.stringify({
    tools: [...Object.keys(PRESETS), "screen"],
    presets: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, { title: v.title, args: v.args }])),
    note: "第二个参数是 JSON。choice 题缺 no-match 出口时盒子会自动补，返回里 patched=true。",
  }, null, 2));
  process.exit(0);
}

let args = {};
if (argJson) {
  try { args = JSON.parse(argJson); }
  catch (e) { console.error(JSON.stringify({ ok: false, error: `参数不是合法 JSON：${e.message}` })); process.exit(2); }
}

const t0 = Date.now();
const out = cmd === "screen"
  ? await screen(args.items ?? [], args.what ?? "与主题相关", { threshold: args.threshold ?? 0.5, sample: args.sample ?? 1, source: "cli" })
  : await runPreset(cmd, args, { sample: args.sample ?? 1, source: "cli" });

console.log(JSON.stringify({ ...out, wall_ms: Date.now() - t0 }, null, 2));
process.exit(out.ok ? 0 : 1);
