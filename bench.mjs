import { readFileSync, writeFileSync } from "node:fs";
import { askJev } from "./jev.mjs";

/**
 * 两类题，判分全靠机械 oracle，不掺主观：
 *  A 存在性判断(noul)：这条消息里有没有写明具体金额？  → 正则可判
 *  B 句子选择(choice)：四句里哪一句说明了发货时限？    → 只有我写的那句含时限词，且用断言校验
 */
// 货币词既可能在数字前（USD 3.50）也可能在数字后（3.50 美元），两个方向都要覆盖
const MONEY = /[$¥€]\s*\d|\d+(?:\.\d+)?\s*(?:元|美元|dollar|usd|rmb)|(?:usd|dollar|rmb|美元)\s*\d/i;
const DEADLINE = /\b(by|before|within|within|no later than|截至|之前|以内)\b|\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b|\d+\s*(business days?|days?|个工作日)/i;

const A_ITEMS = [
  "Your order total came to $42.90 and it shipped this morning.",
  "I never received the package you said was delivered last Tuesday.",
  "The refund of 1280 元 should have landed three days ago.",
  "Can you tell me which warehouse ships to my region?",
  "I was charged twice, both for $19.00, on the same day.",
  "Your app crashes whenever I open the settings screen.",
  "Is there a student discount available right now?",
  "The invoice shows 6800 元 but my contract says otherwise.",
  "Do you support two-factor authentication yet?",
  "Tracking says it left the facility but nothing arrived.",
  "I'd like to change the email on my account please.",
  "Payment failed and it says USD 3.50 insufficient balance.",
  "Where can I find my previous invoices from last year?",
  "The item arrived damaged and I want to send it back.",
  "You took 45 dollars off my card without telling me.",
  "Does this plan renew automatically each month?",
];

const B_ITEMS = [
  {
    q: "When will this order ship?",
    s: [
      "Thanks for reaching out about your recent purchase.",
      "Orders placed today ship by Friday.",
      "We appreciate your business.",
      "Let us know if anything else comes up.",
    ],
  },
  {
    q: "When will this order ship?",
    s: [
      "The warehouse is located in Reno, Nevada.",
      "We have received your message.",
      "Your items will leave our facility within 2 business days.",
      "Have a great rest of your week.",
    ],
  },
  {
    q: "When will this order ship?",
    s: [
      "Shipping is free on orders over a certain amount.",
      "All orders are packed by hand in our studio.",
      "You can track the package once it moves.",
      "Please allow until Monday for dispatch.",
    ],
  },
  {
    q: "When will this order ship?",
    s: [
      "We ship to most countries worldwide.",
      "Your order will be dispatched no later than the 14th.",
      "A confirmation email will be generated automatically.",
      "Our office hours are listed on the site.",
    ],
  },
  {
    q: "When will this order ship?",
    s: [
      "We noticed the address you gave is incomplete.",
      "Could you confirm the street number?",
      "Once confirmed, it ships within 3 days.",
      "Sorry for the inconvenience.",
    ],
  },
  {
    q: "When will this order ship?",
    s: [
      "Our courier partners include two national carriers.",
      "Packaging is recyclable where facilities exist.",
      "The item is currently in stock.",
      "Dispatch happens before 4pm on weekdays.",
    ],
  },
];

function buildItems() {
  const a = A_ITEMS.map((state, i) => ({
    id: `A${i}`, kind: "noul", state,
    oracle: MONEY.test(state) ? 1 : 0,
  }));
  const b = [];
  for (let i = 0; i < B_ITEMS.length; i++) {
    const it = B_ITEMS[i];
    const hits = it.s.map((s) => (DEADLINE.test(s) ? 1 : 0));
    // 断言：恰好一句含时限词，否则这题 oracle 不唯一，丢掉
    if (hits.reduce((x, y) => x + y, 0) !== 1) { console.log(`  丢弃 B${i}：时限句不唯一`); continue; }
    b.push({ id: `B${i}`, kind: "choice", state: it.s.map((s, j) => `[${j}] ${s}`).join("\n"), oracle: hits.indexOf(1) });
  }
  return { a, b };
}

const { a, b } = buildItems();

if (process.argv[2] === "dump") {
  writeFileSync("bench_questions.json", JSON.stringify({
    note: "回答这些题。A 类：该消息是否写明了具体金额，给出 yes 概率(0~1)。B 类：哪一句说明了发货时限，给出句子编号(0~3)和你的把握(0~1)。不要运行任何脚本或读取其他文件，自己读题作答。",
    A: a.map((x) => ({ id: x.id, state: x.state })),
    B: b.map((x) => ({ id: x.id, q: x.state })),
  }, null, 2));
  console.log(`已写出 ${a.length} + ${b.length} 题到 bench_questions.json`);
  process.exit(0);
}

if (!process.env.TYPESAFE_API_KEY) { console.log("需要 TYPESAFE_API_KEY"); process.exit(1); }

const rows = [];
console.log(`\nA 类 ${a.length} 题（存在性判断）`);
for (const it of a) {
  const r = await askJev(it.state, { hasAmount: { type: "noul", instructions: "The message states a specific monetary amount" } });
  const p = r.hasAmount.noul;
  const pred = p >= 0.5 ? 1 : 0;
  rows.push({ id: it.id, kind: "noul", p, pred, oracle: it.oracle, ok: pred === it.oracle, cost: r.__meta.cost, ms: r.__meta.ms });
  console.log(`  ${it.id} p=${p.toFixed(2)} 判=${pred ? "有" : "无"} 真=${it.oracle ? "有" : "无"} ${pred === it.oracle ? "✓" : "✗"}`);
}

console.log(`\nB 类 ${b.length} 题（句子选择）`);
for (const it of b) {
  const r = await askJev(it.state, {
    which: { type: "choice", instructions: "Which sentence states when the order will ship?", criteria: { 0: "sentence [0]", 1: "sentence [1]", 2: "sentence [2]", 3: "sentence [3]" } },
  });
  const pred = Number(r.which.choice);
  rows.push({ id: it.id, kind: "choice", p: r.which.confidence, pred, oracle: it.oracle, ok: pred === it.oracle, cost: r.__meta.cost, ms: r.__meta.ms });
  console.log(`  ${it.id} 选=${pred} 真=${it.oracle} conf=${r.which.confidence.toFixed(2)} ${pred === it.oracle ? "✓" : "✗"}`);
}

const noul = rows.filter((x) => x.kind === "noul"), ch = rows.filter((x) => x.kind === "choice");
const brier = rows.reduce((s, x) => s + (x.kind === "noul" ? (x.p - x.oracle) ** 2 : ((x.ok ? x.p : 1 - x.p) - (x.ok ? 1 : 0)) ** 2), 0) / rows.length;
writeFileSync("bench_jev.json", JSON.stringify(rows, null, 2));
console.log(`\nJev：A 类对 ${noul.filter((x) => x.ok).length}/${noul.length}，B 类对 ${ch.filter((x) => x.ok).length}/${ch.length}，总准确率 ${(rows.filter((x) => x.ok).length / rows.length * 100).toFixed(0)}%，Brier ${brier.toFixed(3)}`);
console.log(`耗时/花费：共 $${rows.reduce((s, x) => s + x.cost, 0).toFixed(6)}，平均 ${Math.round(rows.reduce((s, x) => s + x.ms, 0) / rows.length)}ms/题`);
