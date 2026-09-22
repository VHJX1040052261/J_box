/**
 * 从 codex 的 rollout JSONL 里抽出「谁说了什么 / 调了什么工具 / 返回了什么」。
 *
 * 单独成模块是为了能被 test.mjs 零成本测到：上一版只认 {role, content}，
 * 于是没有 role 的 function_call 条目全被丢掉，而「反复跑同一条命令」正好只存在于
 * 那些条目里 —— 结果 trace_scan 判了个 progress，我差点把「Jev 漏判冗余」写进结论。
 * 抽取器坏掉不会报错，只会安静地把材料换成另一回事。
 */

const clip = (s) => (s || "").replace(/\s+/g, " ").trim().slice(0, 200);

export const flatText = (content) => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(flatText).join(" ");
  if (content && typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (typeof content.output === "string") return content.output;
    if (Array.isArray(content.content)) return flatText(content.content);
    if (Array.isArray(content.summary)) return flatText(content.summary);
  }
  return "";
};

function toTurn(item) {
  if (!item || typeof item !== "object") return null;
  switch (item.type ?? item.item_type) {
    case "message":
      return `${item.role ?? "消息"}: ${clip(flatText(item.content))}`;
    case "function_call":
    case "custom_tool_call": {
      const args = typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {});
      return `调用 ${item.name ?? "?"}(${clip(args)})`;
    }
    case "function_call_output":
    case "custom_tool_call_output":
      return `→ ${clip(flatText(item.output))}`;
    case "reasoning":
      return `思考: ${clip(flatText(item.summary ?? item.content))}`;
    default:
      return null;
  }
}

export function extractTurns(node, out = [], depth = 0) {
  if (depth > 4 || out.length > 400 || node == null) return out;
  if (Array.isArray(node)) {
    for (const x of node) extractTurns(x, out, depth + 1);
    return out;
  }
  if (typeof node === "object") {
    const turn = toTurn(node);
    if (turn && !turn.endsWith(": ")) out.push(turn);
    if (node.payload) extractTurns(node.payload, out, depth + 1);
  }
  return out;
}

export function loadTurns(raw) {
  const turns = [];
  for (const line of String(raw ?? "").split("\n")) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue; // 半截行或别的格式：跳过而不是崩
    }
    extractTurns(obj, turns);
  }
  return turns;
}
