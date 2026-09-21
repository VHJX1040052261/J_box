import { askJev } from "../jev.mjs";

export { askJev };

/**
 * 题包 = 一组窄题 + 归一化 + 阈值策略 + 可评测用例。
 * 注册时强制跑两条 lint，因为它们都是这一轮实测踩出来的坑，不该靠人记住。
 */
const NOMATCH = /(^|[^a-z])(unknown|none|other|n\/?a|unclear|not\s+(mentioned|stated|provided|available)|不适用|无法判定|无匹配|未提及|未涉及)/i;
// 中文没有词边界，\b 会把整串中文前瞻全部放过（实测「预计后续会失控」不匹配）。
// 所以中英分开写：英文靠 \b 限定词，中文直接匹配子串。
const LOOKAHEAD_EN = /\b(will|likely|upcoming|next (few|couple)|in the future|going to)\b/i;
const LOOKAHEAD_ZH = /(预计|将来|接下来|明天|今晚|后天|后续|将会|能否如期|来得及|会上线|将发生)/;
const isLookahead = (s = "") => LOOKAHEAD_EN.test(s) || LOOKAHEAD_ZH.test(s);

export function definePack(spec) {
  // lint 必须跑在真实 state 上，而且要跑遍所有用例形态：题面是 state 的函数，
  // 只喂空对象或单条用例会让规则静默失效（verify 的 choice 题就藏在第 13 条用例之后）。
  const samples = spec.cases?.length ? spec.cases : [spec.lintCase];
  const seen = new Set();
  const problems = [];
  let built = 0;
  for (const item of samples) {
    let qs;
    try {
      qs = typeof spec.questions === "function" ? spec.questions(spec.stateFor(item), item) : spec.questions;
    } catch { continue; }
    built++;
    for (const [qid, q] of Object.entries(qs ?? {})) {
      if (q.type === "choice") {
        const keys = Object.keys(q.criteria || {});
        if (!keys.some((k) => NOMATCH.test(k)) && !seen.has(`nomatch:${qid}`)) {
          seen.add(`nomatch:${qid}`);
          problems.push(`题 "${qid}" 是 choice 但没有 no-match 出口。实测：缺该出口时模型对无解输入会给出 0.95 的假自信。`);
        }
      }
      if (isLookahead(q.instructions) && !seen.has(`lookahead:${qid}:${q.instructions}`)) {
        seen.add(`lookahead:${qid}:${q.instructions}`);
        problems.push(`题 "${qid}" 的问法涉及未来/推演。实测：Jev 的 risky 题全程 0.41 无预警能力，因为答案不在 state 里。`);
      }
    }
  }
  if (!built) problems.push(`一条 lint state 都构造不出来（用例缺失或 stateFor 抛错），两条规则均未生效。`);
  // lintWaive: { 题id: 理由 } —— 封闭动作集（如俄罗斯方块的合法落点）本就没有 no-match 可言。
  // 豁免必须写明理由并留在 lintWaived 里，否则规则报两次假阳性后就没人信它了。
  const waived = Object.entries(spec.lintWaive ?? {}).map(([qid, why]) => ({ qid, why }));
  const kept = problems.filter((p) => !spec.lintWaive?.[qidOf(p)]);
  return { ...spec, lint: kept, lintWaived: waived };
}

const qidOf = (problem) => problem.match(/题 "([^"]+)"/)?.[1];

const REGISTRY = new Map();

export function register(pack) {
  REGISTRY.set(pack.id, pack);
  return pack;
}

export const getPack = (id) => REGISTRY.get(id);
export const listPacks = () => [...REGISTRY.values()].map((p) => ({ id: p.id, title: p.title, lint: p.lint, waived: p.lintWaived ?? [] }));

/** 一次调用打包多题：state 只摄取一次、题目并行、输出免费 —— 这是唯一的成本杠杆 */
export async function askPack(pack, item, opts = {}) {
  const state = pack.stateFor(item);
  // questions 同时拿 state 和 item：state 是发给 Jev 的那份「干净内容」，
  // 题型/选项这些装配信息不该混进 state —— 实测把文本包成 JSON 对象会让 p 掉 0.2~0.35、极差翻倍。
  const qs = typeof pack.questions === "function" ? pack.questions(state, item) : pack.questions;
  const answers = await askJev(state, qs, opts);
  const { __meta, ...rest } = answers;
  return { v: pack.normalize(rest), meta: __meta, raw: rest };
}

/**
 * k 次采样取中位数 / 多数票。
 * 实测 Jev 同输入不可复现（同牌序存活 34/40/40/44/47/52，±20%），
 * 需要逐条审计的场景必须靠这个压住抖动。
 */
export async function askPackStable(pack, item, { sample = 1, ...opts } = {}) {
  const runs = [];
  for (let i = 0; i < sample; i++) runs.push(await askPack(pack, item, opts));
  if (runs.length === 1) return runs[0];

  const keys = Object.keys(runs[0].v);
  const merged = {};
  for (const k of keys) {
    const vals = runs.map((r) => r.v[k]);
    const primitive = vals.every((x) => x === null || (typeof x !== "object" && typeof x !== "function"));
    const num = primitive && vals.every((x) => typeof x === "number");
    if (!primitive) {
      merged[k] = vals[0]; // 概率分布这类结构不参与投票，取首次采样
    } else if (num) {
      const s = [...vals].sort((a, b) => a - b);
      merged[k] = s[Math.floor(s.length / 2)];
    } else {
      merged[k] = vals.sort((a, b) => vals.filter((x) => x === b).length - vals.filter((x) => x === a).length)[0];
    }
  }
  return {
    v: merged,
    raw: runs[0].raw,
    meta: {
      model: runs[0].meta.model,
      usage: { input_tokens: runs.reduce((s, r) => s + r.meta.usage.input_tokens, 0), output_tokens: runs.reduce((s, r) => s + r.meta.usage.output_tokens, 0) },
      ms: Math.round(runs.reduce((s, r) => s + r.meta.ms, 0) / runs.length),
      cost: runs.reduce((s, r) => s + r.meta.cost, 0),
      sample: runs.length,
      spread: keys.filter((k) => typeof runs[0].v[k] === "number").map((k) => ({ k, range: Math.max(...runs.map((r) => r.v[k])) - Math.min(...runs.map((r) => r.v[k])) })),
    },
  };
}
