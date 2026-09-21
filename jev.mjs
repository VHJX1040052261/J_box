const BASE = "https://api.typesafe.ai/v1/systemone";
const PRICE_PER_MTOK = 0.042;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function askJev(state, questions, { model = "jev-latest", maxAttempts = 5 } = {}) {
  if (!process.env.TYPESAFE_API_KEY) throw new Error("TYPESAFE_API_KEY 未设置");

  for (let attempt = 1; ; attempt++) {
    const t0 = Date.now();
    const res = await fetch(BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ state, model, questions }),
    });
    const ms = Date.now() - t0;
    const text = await res.text();

    if (res.ok) {
      const body = JSON.parse(text);
      const cost = (body.usage.input_tokens / 1e6) * PRICE_PER_MTOK;
      return { ...body.answers, __meta: { model: body.model, usage: body.usage, ms, cost, attempt } };
    }

    const retriable = res.status === 429 || res.status === 529;
    if (!retriable || attempt >= maxAttempts) {
      throw new Error(`TypeSafe HTTP ${res.status}: ${text.slice(0, 400)}`);
    }
    const header = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(header) && header > 0 ? header * 1000 : 300 * 2 ** (attempt - 1));
  }
}
