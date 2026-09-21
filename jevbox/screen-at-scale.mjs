#!/usr/bin/env node
/**
 * jev_screen 的量级验证：官方主打的「便宜到可以过全量」到底成不成立，以及
 * 过全量时判得准不准。
 *
 * 关键设计：选的判定性质必须有**机械 oracle**，否则又变成我自己出题自己判。
 * 这里用「记录里出现了 数字 + 时长量词」——正则能无歧义算出正确答案。
 * 判据本身也照着 noul 的要求写成「记录里已经写明」的性质，不要求推测。
 *
 *   TYPESAFE_API_KEY=... node jevbox/screen-at-scale.mjs [条数]
 */
import { screen } from "./box.mjs";

const N = Number(process.argv[2] ?? 200);

const SUBJECT_CN = ["退款", "发票重开", "账号注销", "物流揽收", "接口联调", "换货寄回", "对账单导出", "工单分派", "数据备份", "密钥轮换"];
const SUBJECT_EN = ["the refund", "the invoice rebuild", "the account deletion", "the parcel pickup", "the API handshake", "the replacement shipment", "the statement export", "the ticket routing", "the nightly backup", "the key rotation"];

const CN = (s) => [
  `${s}已经等了 3 个工作日还没动静。`,
  `${s}这边确认过，最多 48 小时能处理完。`,
  `${s}的排队时间是 7 天，从昨天开始算。`,
  `${s}上周提的，到现在没人接。`,
  `${s}的窗口是 24 小时内闭环。`,
  `${s}需要两个部门的章，还没批下来。`,
  `${s}已经在处理了。`,
  `${s}的具体时限系统里没有同步给我。`,
  `${s}麻烦尽快，客户在催。`,
  `${s}上次是 5 天搞定的，这次不知道。`,
];

const EN = (s) => [
  `${s} is taking longer than 10 business days.`,
  `We closed ${s} in 3 hours last time.`,
  `${s} has a 2 day SLA from intake.`,
  `${s} is still pending review by another team.`,
  `Please expedite ${s}, the customer is waiting.`,
  `${s} needs sign-off from two departments.`,
  `${s} completed without escalation.`,
  `The clock on ${s} starts once finance replies.`,
  `${s} was raised last Tuesday and nothing moved.`,
  `${s} cannot be reissued after 30 days.`,
];

// 交替排布，保证两类数量大致均衡；oracle 是「是否出现 数字+时长量词」，纯正则判定
const ORACLE = /\d+\s*(?:个)?\s*(?:天|工作日|小时|分钟)|\d+\s*(?:business\s+)?(?:day|hour|minute)s?/i;

const items = [];
const truth = [];
for (let i = 0; items.length < N; i++) {
  const cn = i % SUBJECT_CN.length;
  const lines = CN(SUBJECT_CN[cn]).concat(EN(SUBJECT_EN[cn % SUBJECT_EN.length]));
  for (const line of lines) {
    if (items.length >= N) break;
    items.push(line);
    truth.push(ORACLE.test(line));
  }
}

const want = truth.filter(Boolean).length;
console.log(`\n═══ jev_screen 量级验证 ═══`);
console.log(`条数 ${items.length}，正则 oracle 判「命中」${want} 条 / 「不命中」${items.length - want} 条`);

const t0 = Date.now();
// threshold 给 0.5；走的就是 MCP 工具背后同一个 screen()，没有第二份实现
const res = await screen(items, "这条记录里出现了由数字写明的时长（天、工作日、小时或分钟）", { threshold: 0.5, source: "cli-scale-test" });
const wall = Date.now() - t0;

if (!res.ok) {
  console.log("失败：", res.error, res.hint ?? "");
  process.exit(1);
}

const keptIdx = new Set(res.hits.map((h) => h.i));
let tp = 0, fp = 0, fn = 0, tn = 0;
const fpRows = [], fnRows = [];
for (let i = 0; i < items.length; i++) {
  const g = truth[i], p = keptIdx.has(i);
  if (g && p) tp++;
  else if (!g && p) { fp++; fpRows.push([res.hits.find((h) => h.i === i)?.p ?? 0, items[i]]); }
  else if (g && !p) { fn++; fnRows.push([0, items[i]]); }
  else tn++;
}
const precision = tp + fp ? tp / (tp + fp) : 0;
const recall = tp + fn ? tp / (tp + fn) : 0;

console.log(`\n  与正则 oracle 对比（n=${items.length}）`);
console.log(`  TP ${tp}   FP ${fp}   FN ${fn}   TN ${tn}`);
console.log(`  准确率 precision ${(precision * 100).toFixed(1)}%   召回 recall ${(recall * 100).toFixed(1)}%   准确率 accuracy ${(((tp + tn) / items.length) * 100).toFixed(1)}%`);
if (fpRows.length) console.log(`\n  误报样本（判命中，正则说没有数字时长）：\n` + fpRows.slice(0, 5).map(([p, s]) => `    ${p.toFixed(2)}  ${s}`).join("\n"));
if (fnRows.length) console.log(`\n  漏报样本（正则说有数字时长，它没留）：\n` + fnRows.slice(0, 8).map(([, s]) => `    —  ${s}`).join("\n"));

const perItem = res.meta.cost / items.length;
console.log(`\n  耗时 ${Math.round(wall / 1000)}s（串行，单条均 ${Math.round(res.meta.ms)}ms）  token ${res.meta.tokens}  总花费 $${res.meta.cost.toFixed(5)}`);
console.log(`  每条 ${perItem.toFixed(7)} 美元 → 一万条 $${(perItem * 1e4).toFixed(3)} → 十万条 $${(perItem * 1e5).toFixed(2)}`);
console.log(`  注：大模型侧的对照价没有在这台机器上实测，上面的倍率不做结论。`);
