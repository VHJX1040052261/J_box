export const EXPECT_RUNG = { auto: "code", specialist: "llm", human: "human" };
export const RUNG_LABEL = { code: "自动办结", llm: "专家处理", human: "转人工" };

// 由 sweep.mjs 在标注用例上扫阈值得出，选取依据是边界余量而非排序首行。
export const DEFAULTS = { intentMinConfidence: 0.9, stakeThreshold: 0.6, discretionToHuman: 1.7, effortToSpecialist: 1.2 };

export const THRESHOLD_META = [
  { key: "intentMinConfidence", label: "归属置信度下限", hint: "intent.confidence 低于此值直接转人工", min: 0, max: 1, step: 0.01 },
  { key: "stakeThreshold", label: "高危门", hint: "flag_high_stakes 高于此值转人工", min: 0, max: 1, step: 0.01 },
  { key: "discretionToHuman", label: "政策裁量门", hint: "discretion 高于此值说明超出标准流程，转人工", min: 0, max: 2, step: 0.01 },
  { key: "effortToSpecialist", label: "排查难度门", hint: "effort 高于此值交给专家档，否则确定性自动办结", min: 0, max: 2, step: 0.01 },
];

// 归一化：把 Jev 的类型化答案压成纯数值向量，策略层只认这个
export function normalize(a) {
  return {
    unknown: a.intent.choice === "unknown",
    choice: a.intent.choice,
    conf: a.intent.confidence,
    probabilities: a.intent.probabilities,
    effort: a.effort.score,
    effortProbabilities: a.effort.probabilities,
    discretion: a.discretion.score,
    discretionProbabilities: a.discretion.probabilities,
    high_stakes: a.flag_high_stakes.noul,
    urgent: a.urgent.noul,
  };
}

// 判定顺序即优先级：先排除无归属，再排除不可信，再排除高危，最后才分自动/专家
export function decide(v, th = DEFAULTS) {
  const trace = [];
  const step = (pass, text) => { trace.push({ pass, text }); return pass; };

  if (step(!v.unknown, `intent 不是 unknown`)) {
    if (step(v.conf >= th.intentMinConfidence, `conf ${v.conf.toFixed(2)} ≥ ${th.intentMinConfidence}`)) {
      if (step(v.high_stakes <= th.stakeThreshold, `高危 ${v.high_stakes.toFixed(2)} ≤ ${th.stakeThreshold}`)) {
        if (step(v.discretion <= th.discretionToHuman, `裁量 ${v.discretion.toFixed(2)} ≤ ${th.discretionToHuman}`)) {
          if (step(v.effort > th.effortToSpecialist, `难度 ${v.effort.toFixed(2)} > ${th.effortToSpecialist}`)) {
            return { rung: "llm", why: `需跨系统排查（effort ${v.effort.toFixed(2)}）`, trace };
          }
          return { rung: "code", why: `标准流程可办结（effort ${v.effort.toFixed(2)}, 裁量 ${v.discretion.toFixed(2)}）`, trace };
        }
        return { rung: "human", why: `超出标准政策，需人工裁量（discretion ${v.discretion.toFixed(2)}）`, trace };
      }
      return { rung: "human", why: `高危操作需人工确认（high_stakes ${v.high_stakes.toFixed(2)}）`, trace };
    }
    return { rung: "human", why: `归属不够确定（confidence ${v.conf.toFixed(2)}）`, trace };
  }
  return { rung: "human", why: "无明确归属团队（intent=unknown）", trace };
}
