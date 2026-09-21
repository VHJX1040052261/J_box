#!/usr/bin/env node
/**
 * Jev 能力盒 —— MCP server。
 *
 * 为什么是 MCP 而不是一个 SDK：Jev 不生成文本、不选下一步动作，它只吐带概率的判断。
 * 所以大模型没法「和它聊天」，只能「调它当反射」。MCP 就是把这层反射插进任何支持它的模型。
 *
 * 用法（客户端配置里加）：
 *   { "mcpServers": { "jev-box": { "command": "node",
 *       "args": ["<绝对路径>/jevbox/server.mjs"],
 *       "env": { "TYPESAFE_API_KEY": "..." } } } }
 *
 * 缺 key 时工具不会消失、也不会编数：它返回明确的「不可用」，让调用方走自己的保守分支。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runPreset, screen } from "./box.mjs";
import { PRESETS } from "./presets.mjs";
import { auditStats } from "./audit.mjs";

const asResult = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });

const server = new McpServer({ name: "jev-box", version: "0.1.0" });

// 工具清单从注册动作里收集，不手写第二份：之前 jev_health 里硬编码了一个数组，
// 加 jev_stats 时忘了同步，它就漏报了 jev_health 自己（agent 用 jev_verify 审 README 时抓出来的）。
const TOOL_NAMES = [];
const tool = (name, meta, handler) => {
  TOOL_NAMES.push(name);
  server.registerTool(name, meta, handler);
};

tool("jev_health", {
  description: "查盒子是否可用（有没有配 TYPESAFE_API_KEY）、当前模型、以及各工具累计花费。调用其它工具前先来一次这个。",
  inputSchema: {},
}, async () => asResult({
  keyConfigured: Boolean(process.env.TYPESAFE_API_KEY),
  model: "jev-latest",
  tools: TOOL_NAMES,
  priceNote: "$0.042/百万 input token，输出免费；一次调用可打包多题，state 只摄取一次。",
  stats: auditStats(),
}));

tool("jev_stats", {
  description: "读审计日志汇总：每个工具调了多少次、动作分布、p50 延迟、累计花费、人工推翻率。",
  inputSchema: {},
}, async () => asResult(auditStats()));

tool("jev_verify", {
  description: "Universal Verification：拿证据核验一段主张/抽取结果/引用是否成立。返回 supports|contradicts|not_mentioned|undecidable 的概率，以及「有细节但证据没覆盖」的编造风险。适合用来核验另一个模型的输出，比再叫一次大模型便宜两个数量级。",
  inputSchema: {
    claim: z.string().describe("要核验的那句话/那段结论"),
    evidence: z.string().describe("作为依据的原文、检索片段或工具返回"),
    sample: z.number().int().min(1).max(9).optional().describe("重复采样次数取中位数，压抖动。默认 1"),
  },
}, async ({ claim, evidence, sample }) => asResult(await runPreset("verify", { claim, evidence }, { sample, source: "mcp" })));

tool("jev_guardrail", {
  description: "LLM Guardrails：对一段即将进入或刚离开模型的文本做四路语义检查 —— 越狱/指令改写、超出范围、明文泄露凭据、必须人工。返回四个概率和一个 pass|block|human 结论。放在每次模型调用或工具调用的前后。注意 off_topic 这一路的判据完全跟着 scope 的措辞走：scope 要把它允许的具体动作列出来，写成一句抽象目标时会对范围内的请求误报（实测同一段范围内的文本 0.73 vs 列举后 0.10）。",
  inputSchema: {
    text: z.string().describe("待检查文本（用户输入、模型输出或工具参数都行）"),
    scope: z.string().optional().describe("本任务允许的范围，要把它允许的具体动作列出来（删文件、改 import、跑测试、推送……），别只写一句抽象目标"),
  },
}, async ({ text, scope }) => asResult(await runPreset("guardrail", { text, scope }, { source: "mcp" })));

tool("jev_route", {
  description: "Model Routing：判断一条请求该交给 none(确定性代码)|small|large|human 哪一档，以及选错档是否不可逆。用来在真正调用大模型之前决定要不要升级或降级。",
  inputSchema: { prompt: z.string().describe("用户请求原文") },
}, async ({ prompt }) => asResult(await runPreset("route", { prompt }, { source: "mcp" })));

tool("jev_trace_scan", {
  description: "Harness Engineering：给 agent 轨迹的当前一步做体检，返回 progress|redundant|contradiction|tool_misuse|done 的概率加一个「是否卡在 A→B→A」的循环风险。适合每 N 步插入，代替人工看日志。",
  inputSchema: {
    goal: z.string().describe("这个 agent 的任务目标"),
    trace: z.string().describe("到目前为止的轨迹文本，越近的步骤越靠后"),
  },
}, async ({ goal, trace }) => asResult(await runPreset("trace_scan", { goal, trace }, { source: "mcp" })));

tool("jev_judge", {
  description: "实时判断原语：自带题面，盒子只负责补 no-match 出口、量成本、落审计。questions 形如 { 字段: {type:'noul'|'choice'|'score', instructions, criteria} }。150ms 量级，可直接嵌进 UI 做实时分流。注意：只问答案已经写在 state 里的性质，问未来的题盒子会照实返回但不可信。",
  inputSchema: {
    state: z.string().describe("被判断的内容"),
    questions: z.record(z.object({
      type: z.enum(["noul", "choice", "score"]),
      instructions: z.string(),
      criteria: z.any().optional(),
    })).describe("一次调用可以打包多题，它们共用同一次 state 摄取"),
    sample: z.number().int().min(1).max(9).optional(),
  },
}, async ({ state, questions, sample }) => asResult(await runPreset("judge", { state, questions }, { sample, source: "mcp" })));

tool("jev_screen", {
  description: "AI Map-Reduce 粗筛：对一批记录跑同一个 noul 条件，只把命中的交回给你，并报告扫了多少、留下多少、花了多少钱。官方主打的「100x 便宜所以能过全量」就是这类用法。大语料别交给大模型，先交给这个。",
  inputSchema: {
    items: z.array(z.string()).describe("待筛记录，每条一个字符串"),
    what: z.string().describe("筛选条件，写成一条可判真伪的陈述"),
    threshold: z.number().min(0).max(1).optional().describe("命中阈值，默认 0.5"),
  },
}, async ({ items, what, threshold }) => asResult(await screen(items, what, { threshold, source: "mcp" })));

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`jev-box MCP 已启动（stdio）。key: ${process.env.TYPESAFE_API_KEY ? "已配置" : "未配置 —— 工具会返回明确的不可用而不是编数"}`);
