import { definePack, register } from "../pack.mjs";
import { quizItems, gradeItem } from "../../quiz.mjs";

/**
 * 核验/判断题包：官方 5 大主打用例里的 Universal Verification 的最小可用形态。
 * 与分诊的区别 —— 它不路由，它只产出一个带概率的判断，供代码或上游模型消费。
 */
export const verifyPack = register(definePack({
  id: "verify",
  title: "文本语义核验（存在性 / 证据关系 / 句子定位）",
  questions(_state, item) {
    return item.kind === "noul"
      ? { answer: { type: "noul", instructions: item.question } }
      : { answer: { type: "choice", instructions: item.question, criteria: Object.fromEntries(item.options.map((o) => [o, null])) } };
  },
  // state 只放被审的文本：题型、选项这些装配信息走 questions，塞进 state 实测会把判断拖偏
  stateFor: (item) => item.state,
  // Jev 返回的是带 type 的答案对象，不是裸数字
  normalize: (a) => (a.answer.type === "noul"
    ? { p: a.answer.noul, pred: undefined, probs: null }
    // probs 必须留着：多类 Brier 要用真实分布，用 confidence 反推会把「自信地答错」算成满分
    : { p: a.answer.confidence, pred: String(a.answer.choice), probs: a.answer.probabilities }),
  thresholds: {},

  decide(v) {
    return { action: v.pred ?? (v.p >= 0.5 ? "yes" : "no"), why: `p=${v.p.toFixed(2)}`, trace: [] };
  },
  fallback: { action: "abstain", why: "Jev 不可用，弃答" },

  cases: quizItems(),
  lintWaive: { answer: "选项由题面封闭枚举（存在性二选一 / 证据三态 / 四句定位），不存在第四种合法答案" },
  scoreItem(item, decision, v) {
    const g = gradeItem(item, v.p, decision.action === "abstain" ? undefined : decision.action, v.probs);
    return { ok: g.ok, kind: item.kind, brier: g.brier };
  },
}));
