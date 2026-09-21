/**
 * 判断力题库。三类题都站在 Jev 擅长的领域（窄语义判断），但加了对抗性干扰项，
 * 因为上一版全对、Brier=0，没有区分度。
 *
 * 关键约束：每题的 oracle 必须能机械推导，不掺主观。
 *   A 组：定义写成「是否出现 货币符号/货币名 + 数字」的组合 → 正则可判
 *   B 组：前提与假设都是我自己构造的，关系由构造决定 → 直接写死
 *   C 组：只有目标句含时限表达，用断言校验唯一性
 */
/**
 * 货币标记词表是唯一的真相来源：题面文字和 oracle 正则都从它生成，
 * 避免出现「题面说 euros 算、正则忘了写 euros」这种同时坑掉两个选手的漏洞。
 */
export const CURRENCY_TOKENS = ["$", "¥", "€", "元", "美元", "欧元", "英镑", "日元", "dollar", "dollars", "euro", "euros", "pound", "pounds", "sterling", "yen", "USD", "RMB", "EUR", "GBP"];

const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MONEY_PRECISE = new RegExp(
  `(?:[${esc("$¥€")}])\\s*\\d` +
  `|\\d+(?:\\.\\d+)?\\s*(?:${[...CURRENCY_TOKENS.filter((t) => !/^[¥€$]$/.test(t))].map(esc).join("|")})` +
  `|(?:${["USD", "RMB", "EUR", "GBP", "dollar", "dollars", "euro", "euros"].map(esc).join("|")})\\s*\\d`,
  "i",
);

export const A_QUESTION = `这条消息里是否出现了「货币标记 + 数字」的组合？货币标记仅限以下这些：${CURRENCY_TOKENS.join("、")}。只要该标记与一个数字相邻（标记在前或数字在前都算）就判「是」；只有数字没有标记、或只有标记没有数字，都判「否」。`;

export const A_ITEMS = [
  { s: "The $5 off coupon never got applied at checkout.", want: 1 },
  { s: "It cost me an arm and a leg to ship that thing.", want: 0 },
  { s: "I was charged 12.50 euros for a single delivery.", want: 1 },
  { s: "Refund shows as USD 74.20 pending since Monday.", want: 1 },
  { s: "Do you have any discounts for students running right now?", want: 0 },
  { s: "My bank says a 20 dollar fee came out of the account.", want: 1 },
  { s: "Order number is 58291 and it still says pending.", want: 0 },
  { s: "The invoice lists ¥3200 for the annual licence.", want: 1 },
  { s: "There were 7 items in the box but I ordered 9.", want: 0 },
  { s: "You can call me any weekday after 3pm if that helps.", want: 0 },
  { s: "Pricing starts at 49 pounds for the basic tier.", want: 1 },
  { s: "I still have 3 EUR left as store credit.", want: 1 },
];

export const B_QUESTION = "根据这段证据，它与该主张的关系是？「支持」= 证据明确成立该主张；「矛盾」= 证据明确否定该主张；「未提及」= 证据既不支持也不否定。";

export const B_ITEMS = [
  { claim: "订阅可以被取消。", ev: "订阅按月自动续费，用户可在下次续费前取消。", want: "支持" },
  { claim: "订阅可以被取消。", ev: "一旦付款，订阅即锁定整个 12 个月周期，无任何例外。", want: "矛盾" },
  { claim: "订阅可以被取消。", ev: "我们的办公室在公共假期不办公。", want: "未提及" },
  { claim: "满 50 的订单免运费。", ev: "满 50 的订单可享标准配送免运费。", want: "支持" },
  { claim: "满 50 的订单免运费。", ev: "无论金额大小，每单固定收取 6.99 运费。", want: "矛盾" },
  { claim: "满 50 的订单免运费。", ev: "我们在条件允许时全部使用可回收纸箱包装。", want: "未提及" },
  { claim: "首次回复在一个工作日内。", ev: "上季度工作日首次回复的中位耗时为 19 小时。", want: "支持" },
  { claim: "首次回复在一个工作日内。", ev: "目前首次回复需要 4 到 6 个工作日。", want: "矛盾" },
  { claim: "首次回复在一个工作日内。", ev: "我们的客服团队分布在三个时区。", want: "未提及" },
  { claim: "这台电钻享有保修。", ev: "所有电动工具自购买日起享有两年有限保修。", want: "支持" },
  { claim: "这台电钻享有保修。", ev: "该商品按现状出售，不含任何形式的保修。", want: "矛盾" },
  { claim: "这台电钻享有保修。", ev: "这台电钻从我们的雷诺仓库发出。", want: "未提及" },
];

/**
 * target 是作者意图里真正给出期限的那一句。校验器断言「只有 target 匹配」，
 * 否则丢掉该题 —— 光检查「恰好匹配一句」会放行像 "declined by the issuer"
 * 这种把介词 by 误当成期限的假阳性。
 */
const C_TEMPLATES = [
  { t: 1, s: ["Thanks for reaching out about your recent purchase.", "Orders placed today ship by Friday.", "We appreciate your business.", "Let us know if anything else comes up."] },
  { t: 2, s: ["The warehouse is located in Reno, Nevada.", "We have received your message.", "Your items will leave our facility within 2 business days.", "Have a great rest of your week."] },
  { t: 1, s: ["We ship to most countries worldwide.", "Your order will be dispatched no later than the 14th.", "A confirmation email will be generated automatically.", "Our office hours are listed on the site."] },
  { t: 3, s: ["Our courier partners include two national carriers.", "Packaging is recyclable where facilities exist.", "The item is currently in stock.", "Dispatch happens before 4pm on weekdays."] },
  { t: 2, s: ["We noticed the address you gave is incomplete.", "Could you confirm the street number?", "Once confirmed, it ships within 3 days.", "Sorry for the inconvenience."] },
  { t: 2, s: ["Unfortunately that model is discontinued now.", "A replacement would cost more than the repair.", "Repairs are booked for the 9th of next month.", "We opened a case for you already."] },
  { t: 0, s: ["Returns are accepted within 30 days of delivery.", "Please print the prepaid label attached.", "The refund will appear on your next statement.", "We hope to see you again soon."] },
  { t: 2, s: ["Your payment method was declined by the issuer.", "Please try a different card and resubmit.", "Once that clears, your order ships same day.", "Nothing else is needed from you right now."] },
];
const DEADLINE = /\b(by|before|within|no later than)\b|\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(\d{1,2})(st|nd|rd|th)\b|\d+\s*(business days?|days?)|\bsame day\b/i;

export const C_QUESTION = "下面四句话中，哪一句给出了明确的日期或时间期限？只选那一句。";

export function cItems() {
  const out = [];
  C_TEMPLATES.forEach((it, i) => {
    const hits = it.s.map((x) => (DEADLINE.test(x) ? 1 : 0));
    const matched = hits.map((h, j) => (h ? j : -1)).filter((j) => j >= 0);
    if (matched.length !== 1 || matched[0] !== it.t) return;
    out.push({ id: `C${i}`, s: it.s, oracle: it.t });
  });
  return out;
}

export function cDropped() {
  return C_TEMPLATES.map((it, i) => {
    const matched = it.s.map((x, j) => (DEADLINE.test(x) ? j : -1)).filter((j) => j >= 0);
    return matched.length === 1 && matched[0] === it.t ? null : `C${i}：匹配到 [${matched.join(",")}]，意图是 [${it.t}]`;
  }).filter(Boolean);
}

export const B_OPTIONS = ["支持", "矛盾", "未提及"];

export function validate() {
  const problems = [];
  A_ITEMS.forEach((it, i) => {
    const derived = MONEY_PRECISE.test(it.s) ? 1 : 0;
    if (derived !== it.want) problems.push(`A${i} oracle 不自洽：正则=${derived} 标注=${it.want} 「${it.s}」`);
  });
  const c = cItems();
  if (c.length !== C_TEMPLATES.length) problems.push(`C 组有 ${C_TEMPLATES.length - c.length} 题因时限句不唯一被丢弃`);
  return problems;
}

export function score(kind, p, pred, oracle) {
  const ok = kind === "noul" ? (p >= 0.5 ? 1 : 0) === oracle : pred === oracle;
  return { ok, brier: 0 };
}

/**
 * 正确的判分。
 *  noul：二元 Brier = (p − 真值)²
 *  choice：多类 Brier = Σ_选项 (p_选项 − onehot)²，用完整分布，不用 confidence。
 *  早先用 confidence 套二元公式会把「自信地答错」算成满分，是错的。
 */
export function gradeItem(it, p, pred, probs) {
  if (it.kind === "noul") {
    const truth = Number(it.oracle);
    return { ok: (p >= 0.5 ? 1 : 0) === truth, brier: (p - truth) ** 2 };
  }
  const truth = String(it.oracle);
  const opts = it.options.map(String);
  // 没有完整分布时（比如人类/agent 只报一个把握度），按「所选选项拿 p，其余均分 1−p」展开，
  // 这样两边都能算多类 Brier，不会因为一方只给点估计就免测校准
  const dist = probs && Object.keys(probs).length
    ? probs
    : Object.fromEntries(opts.map((o) => [o, String(pred) === o ? p : (1 - p) / Math.max(opts.length - 1, 1)]));
  let brier = 0;
  for (const o of opts) {
    const pv = Number(dist[o] ?? 0);
    brier += (pv - (o === truth ? 1 : 0)) ** 2;
  }
  return { ok: String(pred) === truth, brier };
}

/** 归一化成答题接口用的结构：oracle 单独留着判分，绝不下发给选手 */
export function quizItems() {
  return [
    ...A_ITEMS.map((it, i) => ({ id: `A${i}`, kind: "noul", block: "A", question: A_QUESTION, state: it.s, options: null, oracle: it.want })),
    ...B_ITEMS.map((it, i) => ({ id: `B${i}`, kind: "choice", block: "B", question: B_QUESTION, state: `主张：${it.claim}\n证据：${it.ev}`, options: B_OPTIONS, oracle: it.want })),
    ...cItems().map((it) => ({ id: it.id, kind: "choice", block: "C", question: C_QUESTION, state: it.s.map((s, j) => `[${j}] ${s}`).join("\n"), options: ["0", "1", "2", "3"], oracle: String(it.oracle) })),
  ];
}
