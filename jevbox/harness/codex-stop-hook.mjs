#!/usr/bin/env node
/**
 * codex 的 Stop 钩子 → jevbox。
 *
 * 为什么是 Stop 而不是别的时机：payload 里的 `last_assistant_message` 和 `transcript_path`
 * 都由 harness 填，**不经过模型的手**。换成 verify 类检查就得让模型自己写 claim 和 evidence，
 * 那等于让它自己出题自己批，强制调用也就只是仪式。
 *
 * 这一版只观测，不拦：任何情况下都以 0 退出，stdout 只给 `{}`（不含 permissionDecision，
 * 所以 should_block 恒为 false）。先攒够数，再决定要不要给它牙齿。
 *
 * 注意钩子有信任闸门：未信任的钩子在 `codex exec` 下会被静默跳过，不报错。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadTurns } from "./transcript.mjs";

/**
 * 密钥来源：codex 拉起钩子时用的是它自己的环境，里面不会有 TYPESAFE_API_KEY。
 * 先看环境变量，再退回仓库根那个已被 gitignore 的 .env。两处都没有也照常往下走 ——
 * 盒子返回 degraded 并如实落进审计，于是「钩子装了但没配 key」在控制台里看得见。
 */
if (!process.env.TYPESAFE_API_KEY) {
  try {
    const envPath = fileURLToPath(new URL("../../.env", import.meta.url));
    const line = readFileSync(envPath, "utf8").split("\n").find((l) => l.startsWith("TYPESAFE_API_KEY="));
    if (line) process.env.TYPESAFE_API_KEY = line.slice("TYPESAFE_API_KEY=".length).trim();
  } catch {
    // 没有 .env 就走 degraded 路径
  }
}

const { runPreset } = await import("../box.mjs");

const MAX_TRANSCRIPT_CHARS = 2400;
const MAX_ENTRIES = 15;

// 不能用 `for await (process.stdin)`：Windows 上 Node 读完 stdin 后退出时会撞
// libuv 的 UV_HANDLE_CLOSING 断言，钩子以 127 退出，codex 会把它当成失败。
const readStdin = () => new Promise((resolve) => {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => { raw += c; });
  process.stdin.on("error", () => resolve(raw));
  process.stdin.on("end", () => resolve(raw));
  process.stdin.resume();
});

const emit = () => process.stdout.write("{}\n");

let payload = {};
try {
  payload = JSON.parse((await readStdin()) || "{}");
} catch {
  emit();
  process.exit(0);
}

let turns = [];
if (payload.transcript_path) {
  try {
    turns = loadTurns(readFileSync(payload.transcript_path, "utf8"));
  } catch {
    turns = []; // 读不到轨迹就只做最后一条消息的检查，不硬凑
  }
}

const last = typeof payload.last_assistant_message === "string" ? payload.last_assistant_message : "";
const goal = turns.find((t) => t.startsWith("user"))?.slice(6) ?? "(轨迹里没有用户目标)";
const trace = turns.slice(-MAX_ENTRIES).join("\n").slice(0, MAX_TRANSCRIPT_CHARS);

const results = [];

if (last.trim()) {
  const g = await runPreset("guardrail", { text: last }, { source: "harness:codex-stop" });
  results.push(`guardrail=${g.verdict ?? g.error ?? "?"}`);
}

if (trace.length > 80) {
  const t = await runPreset("trace_scan", { goal, trace }, { source: "harness:codex-stop" });
  results.push(`trace_scan=${t.verdict ?? t.error ?? "?"}`);
}

// stderr 给人看，不进模型上下文；stdout 才是钩子的返回值
console.error(`[jev-box Stop] turn=${payload.turn_id ?? "?"} turns=${turns.length} ${results.join("  ")}`);
emit();
