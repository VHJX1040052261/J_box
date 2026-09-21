import { definePack, register } from "../pack.mjs";
import { questions } from "../../prompt.mjs";
import { normalize, decide, EXPECT_RUNG } from "../../policy.mjs";
import { cases } from "../../cases.mjs";

/** 客服分诊：一次调用问 5 题，代码侧三重门控后分流。这是「控制面」形态。 */
export const triagePack = register(definePack({
  id: "triage",
  title: "客服工单分诊",
  questions: () => questions,
  stateFor: (item) => (typeof item === "string" ? item : item.msg),
  normalize,
  thresholds: { intentMinConfidence: 0.9, stakeThreshold: 0.6, discretionToHuman: 1.7, effortToSpecialist: 1.2 },

  decide(v, th) {
    const d = decide(v, th);
    return { action: d.rung, why: d.why, trace: d.trace };
  },

  /** 降级路径：Jev 不可用时的兜底动作，不能让上游一挂全线停摆 */
  fallback: { action: "human", why: "Jev 不可用，保守转人工" },

  cases,
  scoreItem(item, decision) {
    const want = EXPECT_RUNG[item.expect];
    return { ok: decision.action === want, kind: "choice", brier: decision.action === want ? 0 : 1 };
  },
}));
