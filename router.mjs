import { decide, normalize, EXPECT_RUNG, DEFAULTS } from "./policy.mjs";

export { decide, normalize, EXPECT_RUNG, DEFAULTS };

export function deterministicRung(intent) {
  return `确定性处理器 ${intent}：查库并回复模板`;
}

export async function llmRung(message, intent) {
  if (!process.env.LLM_API_KEY) return `未配置 LLM_API_KEY —— 挂起等待 specialist(${intent})，未真正调用推理模型`;
  const res = await fetch(process.env.LLM_BASE_URL || "https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.LLM_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.LLM_MODEL || "gpt-4o-mini",
      messages: [{ role: "user", content: `Handle this ${intent} support request:\n\n${message}` }],
    }),
  });
  if (!res.ok) throw new Error(`LLM rung HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  return body.choices?.[0]?.message?.content?.slice(0, 200) ?? "(空响应)";
}
