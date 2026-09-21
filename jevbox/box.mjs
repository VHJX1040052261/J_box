import { askJev } from "./jev.mjs";
import { logDecision } from "./audit.mjs";
import { PRESETS, SCREEN_QUESTION } from "./presets.mjs";

/**
 * 盒子的引擎：所有工具都走这里，保证三件事在任何调用方身上都成立 ——
 * 补 no-match 出口、缺 key 时显式不可用、每次调用都落审计并回报真实成本。
 * 这三条是这一轮实测换来的，散落到每个调用方手里一定会漏。
 */

// 分隔符要收 _ 和 -：选项常写成 not_mentioned / no_match，只允许 \s 会认不出，
// 于是盒子会往已经有出口的题里再塞一个 undecidable（实测踩过，白烧 token 还污染选项集）。
const NOMATCH = /(^|[^a-z])(unknown|none|other|n[/ _-]?a|unclear|undecidable|not[\s_-]+(mentioned|stated|provided|available|applicable)|no[\s_-]+match|(不适用|无法判定|无匹配|未提及|未涉及|信息不足))/i;
const NOMATCH_FILL = { key: "undecidable", desc: "信息不足，以上都不成立" };

/** choice 缺 no-match 就自动补一个。实测：缺出口时模糊输入能拿到 0.95 的假自信。 */
export function patchQuestions(questions) {
  let patched = false;
  const out = {};
  for (const [id, q] of Object.entries(questions)) {
    if (q.type === "choice") {
      const keys = Object.keys(q.criteria || {});
      if (!keys.some((k) => NOMATCH.test(k))) {
        out[id] = { ...q, criteria: { ...q.criteria, [NOMATCH_FILL.key]: NOMATCH_FILL.desc } };
        patched = true;
        continue;
      }
    }
    out[id] = q;
  }
  return { questions: out, patched };
}

/** 把 Jev 的类型化答案压成纯数值/字符串，调用方不用懂 noul/choice/score 的结构 */
function flatten(answers) {
  const v = {};
  for (const [id, a] of Object.entries(answers)) {
    if (a.type === "noul") v[id] = a.noul;
    else if (a.type === "choice") {
      v[id] = a.choice;
      v[`${id}_conf`] = a.confidence;
      v[`${id}_probs`] = a.probabilities;
    } else if (a.type === "score") {
      v[id] = a.score;
      v[`${id}_conf`] = a.confidence;
    }
  }
  return v;
}

const UNAVAILABLE = {
  ok: false,
  error: "Jev 不可用：服务端未设置 TYPESAFE_API_KEY",
  degraded: true,
  hint: "盒子不会编造概率。要么配 key，要么让调用方走自己的保守分支。",
};

export async function runPreset(name, args, { sample = 1, source = null } = {}) {
  const preset = PRESETS[name];
  if (!preset) return { ok: false, error: `未知预设 ${name}`, available: Object.keys(PRESETS) };
  for (const a of preset.args) {
    if (args[a] == null || args[a] === "") return { ok: false, error: `缺少参数 ${a}` };
  }
  if (!process.env.TYPESAFE_API_KEY) return { ...UNAVAILABLE, tool: name };

  const spec = preset.raw ? args.questions : preset.questions(args);
  const { questions, patched } = patchQuestions(spec);
  const state = preset.raw ? args.state : stateOf(name, args);

  const runs = [];
  for (let i = 0; i < Math.max(1, sample); i++) {
    const a = await askJev(state, questions);
    const { __meta, ...rest } = a;
    runs.push({ v: flatten(rest), meta: __meta });
  }
  const v = merge(runs.map((r) => r.v));
  const meta = {
    model: runs[0].meta.model,
    ms: Math.round(runs.reduce((s, r) => s + r.meta.ms, 0) / runs.length),
    cost: runs.reduce((s, r) => s + r.meta.cost, 0),
    // logDecision 读的是 usage.input_tokens，这里保持同构，否则审计里 token 全是 null
    usage: { input_tokens: runs.reduce((s, r) => s + r.meta.usage.input_tokens, 0), output_tokens: 0 },
    tokens: runs.reduce((s, r) => s + r.meta.usage.input_tokens, 0),
    sample: runs.length,
  };
  logDecision({ pack: { id: `box:${name}` }, item: state, v, meta, decision: { action: verdictOf(name, v), why: "", trace: [] }, source });
  return { ok: true, tool: name, patched, v, meta };
}

/** 多次采样合并：数值取中位数，字符串取多数票，概率分布取首次 */
function merge(vs) {
  if (vs.length === 1) return vs[0];
  const out = {};
  for (const k of Object.keys(vs[0])) {
    const vals = vs.map((x) => x[k]);
    if (typeof vals[0] === "number") out[k] = [...vals].sort((a, b) => a - b)[Math.floor(vals.length / 2)];
    else if (vals[0] && typeof vals[0] === "object") out[k] = vals[0];
    else out[k] = vals.sort((a, b) => vals.filter((x) => x === b).length - vals.filter((x) => x === a).length)[0];
  }
  return out;
}

/** 每个预设一个「盒子给出的结论」，纯代码规则，不是 Jev 写的 */
function verdictOf(name, v) {
  if (name === "guardrail") return (v.jailbreak ?? 0) >= 0.5 || (v.leaks_secret ?? 0) >= 0.5 ? "block" : (v.needs_human ?? 0) >= 0.6 ? "human" : "pass";
  if (name === "route") return v.tier;
  if (name === "verify") return v.relation;
  if (name === "trace_scan") return v.status;
  return v.relation ?? v.tier ?? null;
}

function stateOf(name, args) {
  if (name === "verify") return `证据：\n${args.evidence}\n\n待核验：\n${args.claim}`;
  if (name === "guardrail") return args.text;
  if (name === "route") return args.prompt;
  if (name === "trace_scan") return `目标：${args.goal}\n\n轨迹：\n${typeof args.trace === "string" ? args.trace : JSON.stringify(args.trace, null, 1)}`;
  return String(args.state ?? "");
}

/** AI Map-Reduce：一次调用只能判一条，所以这里做的是「只回命中项 + 总花费」 */
export async function screen(items, what, { threshold = 0.5, sample = 1, source = null } = {}) {
  if (!process.env.TYPESAFE_API_KEY) return { ...UNAVAILABLE, tool: "screen" };
  const { questions } = patchQuestions(SCREEN_QUESTION(what));
  const hits = [];
  let cost = 0, tokens = 0, ms = 0;
  for (const [i, item] of items.entries()) {
    const state = typeof item === "string" ? item : JSON.stringify(item);
    const runs = [];
    for (let n = 0; n < sample; n++) {
      const a = await askJev(state, questions);
      runs.push(a.hit.noul);
      cost += a.__meta.cost;
      tokens += a.__meta.usage.input_tokens;
      ms += a.__meta.ms;
    }
    const p = [...runs].sort((x, y) => x - y)[Math.floor(runs.length / 2)];
    if (p >= threshold) hits.push({ i, p, preview: state.replace(/\s+/g, " ").slice(0, 90) });
  }
  const meta = {
    cost,
    tokens,
    ms: Math.round(ms / Math.max(1, items.length)),
    model: "jev-latest",
    // logDecision 读 usage.input_tokens；粗筛是 N 次调用的总和，这里如实记总量而不是均值
    usage: { input_tokens: tokens, output_tokens: 0 },
    sample,
  };
  logDecision({
    pack: { id: "box:screen" },
    item: { what, scanned: items.length },
    v: { kept: hits.length, threshold },
    meta,
    decision: { action: `kept ${hits.length}/${items.length}`, why: what, trace: [] },
    source,
  });
  return {
    ok: true,
    tool: "screen",
    scanned: items.length,
    kept: hits.length,
    hits,
    meta,
    note: `粗筛把 ${items.length} 条压到 ${hits.length} 条交给大模型；剩下的 ${items.length - hits.length} 条没花你一分钱 token。`,
  };
}
