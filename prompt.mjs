import { createHash } from "node:crypto";

export { normalize } from "./policy.mjs";

export const questions = {
  intent: {
    type: "choice",
    instructions: "Which team should handle this customer message?",
    criteria: {
      billing: "Money movement itself: charges, invoices, refunds, credits, plan or billing-cycle changes",
      technical: "Software not behaving as documented: bugs, outages, login failures, API, webhook, SDK or integration errors",
      fulfillment: "Orders and physical or account delivery: order status, tracking, shipping address, delivery delays",
      sales: "Pricing, plan features, upgrades, pre-sales questions about buying",
      unknown: "Nothing above fits: the message has no concrete actionable problem, is chit-chat, or is too vague to assign",
    },
  },
  effort: {
    type: "score",
    instructions: "How many systems or steps must be touched to resolve this request",
    criteria: [
      "One lookup or one obvious setting change resolves it immediately",
      "Reproduction or investigation across more than one system is needed, but the cause is probably findable",
      "Root cause is unknown, or the fix needs engineering work, data reconstruction, or coordination between teams",
    ],
  },
  discretion: {
    type: "score",
    instructions: "How much policy judgment is needed beyond the standard documented procedure",
    criteria: [
      "An existing standard procedure covers this case exactly; whoever handles it would just follow it",
      "A choice must be made among options the current policy already allows",
      "The request falls outside standard policy, needs an exception, or creates an obligation the company must decide on",
    ],
  },
  urgent: {
    type: "noul",
    instructions: "The message conveys time-sensitivity or active revenue loss",
  },
  flag_high_stakes: {
    type: "noul",
    instructions: "A wrong team assignment here would cause material harm, so a human should confirm the routing",
    criteria: {
      true: "Involves moving or refunding money, terminating an account, legal or compliance exposure, or irreversible data loss",
      false: "A misroute costs time but is recoverable by re-forwarding the message",
    },
  },
};

// 题面一改，缓存下来的判断就是另一套语义。签名由 prompt 自己算并导出，
// 这样写缓存的 sweep 和读缓存的 studio/server 不可能各自维护一份对不上的判定。
export const QUESTIONS_SIGNATURE = createHash("sha256").update("v3" + JSON.stringify(questions)).digest("hex").slice(0, 16);
