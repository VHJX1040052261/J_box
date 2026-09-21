const KEY = process.env.TYPESAFE_API_KEY;
if (!KEY) { console.error("TYPESAFE_API_KEY 未设置"); process.exit(1); }

const msg = process.argv[2] || "你好，我们对接你们的支付回调，第三天开始持续返回 500，重新生成 API key 之后仍然失败。";
const { questions } = await import("./prompt.mjs");

const payload = { state: msg, model: "jev-latest", questions };
const masked = `${KEY.slice(0, 12)}…${KEY.slice(-6)}`;

console.log("┌─ 发出 ─────────────────────────────────────────────");
console.log("POST /v1/systemone HTTP/1.1");
console.log("Host: api.typesafe.ai");
console.log(`Authorization: Bearer ${masked}  ← 已掩码，实际发送的是完整密钥`);
console.log("Content-Type: application/json");
console.log("\n请求体（这就是 Jev 收到的全部内容）:");
console.log(JSON.stringify(payload, null, 2));

const t0 = performance.now();
const res = await fetch("https://api.typesafe.ai/v1/systemone", {
  method: "POST",
  headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
const ms = (performance.now() - t0).toFixed(0);
const raw = await res.text();

console.log("\n└─ 返回 ─────────────────────────────────────────────");
console.log(`HTTP ${res.status} ${res.statusText} · 往返 ${ms}ms · ${raw.length} 字节`);
console.log("响应体（未经任何加工）:");
console.log(JSON.stringify(JSON.parse(raw), null, 2));

console.log("\n我从中读到的只有这些字段:");
const a = JSON.parse(raw).answers;
console.log(`  intent.choice=${a.intent.choice}  intent.confidence=${a.intent.confidence}`);
console.log(`  effort.score=${a.effort.score}  discretion.score=${a.discretion.score}`);
console.log(`  flag_high_stakes.noul=${a.flag_high_stakes.noul}  urgent.noul=${a.urgent.noul}`);
console.log("  ← 没有思考过程、没有解释文本。阈值判定发生在 router.mjs，不在 Jev。");
