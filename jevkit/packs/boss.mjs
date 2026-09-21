import { definePack, register } from "../pack.mjs";

/**
 * 「老板来需求了」实时雷达 —— 把聊天截图里那套东西拆成能落地的部分。
 *
 * 三条硬规矩，都是这一轮实测换来的：
 *  1. 只问「答案已经写在文本里」的性质。图里「明天能上线吧 → 演示版 88%」是预测未来，
 *     上一轮实测同类前瞻题（risky）全程 0.41、棋盘积到 36 个洞都不预警，所以这里
 *     故意保留 deliverable_by_tomorrow 一道题，让 pack.mjs 的前瞻 lint 报出来。
 *  2. 「建议回复」不是 Jev 写的，是下面 decide() 的查表模板。Jev 不生成文本。
 *  3. 没有 no-match 出口的 choice 会造出假自信（实测缺出口时模糊输入能拿 0.95）。
 */
export const bossPack = register(definePack({
  id: "boss",
  title: "需求澄清雷达（老板消息实时判断）",

  questions: {
    under_scope: {
      type: "noul",
      instructions: "这条消息用「小/简单/顺便」淡化了工作量，而它实际描述的范围明显大于这些词所暗示的",
      criteria: {
        true: "措辞说小，但句子里出现了成体系的产品或跨模块能力",
        false: "措辞和实际范围一致，确实是小改动",
      },
    },
    simple_means: {
      type: "choice",
      instructions: "对方说的「简单点/差不多就行」，最可能指哪个维度变简单",
      criteria: {
        function: "功能范围要小：少做功能",
        budget: "成本要低：少花钱、用现成的",
        timeline: "工期要短：先上粗版",
        visual: "只要看着像：外观到位即可",
        unclear: "这句话本身不足以判定指哪个维度",
      },
    },
    new_goal: {
      type: "noul",
      instructions: "这条消息新引入了一个和前面并列、可独立交付的目标",
      criteria: {
        true: "出现新的能力项（如再加一个系统、再加一块功能）",
        false: "只是对已有目标的回应、确认或追问",
      },
    },
    time_commit: {
      type: "noul",
      instructions: "这条消息在要求我给出一个明确的时间承诺",
      criteria: {
        true: "直接问「能不能在某天前做完」这类要具体日期的问题",
        false: "没有索要日期，或在等你主动安排",
      },
    },
    blast_radius: {
      type: "score",
      instructions: "按这条消息所描述的需求，如果直接开工，事后发现返工的范围有多大",
      criteria: [
        "改一两处样式或文案，几乎不可能返工",
        "单个功能模块，做错了改一版",
        "跨模块，需要重做一部分已有设计",
        "接近半个系统，方向错了要重来",
        "是一个独立产品级承诺，做多久都可能不够",
      ],
    },
    settled: {
      type: "noul",
      instructions: "到这条消息为止，对方已经接受当前方案并且没有再追加新要求",
      criteria: {
        true: "表态接受、放权给你安排，且没有新条件",
        false: "仍在追加要求、追问进度或留了新条件",
      },
    },

    // ↓ 故意留着：这是对未来的预测，答案不在文本里。前瞻 lint 应该把它拦下来。
    deliverable_by_tomorrow: {
      type: "noul",
      instructions: "按这条消息的要求，明天能够正式上线",
    },
  },

  // state = 整段对话（官方支持结构化聊天记录），不是单条消息 —— 「是否解除」必须看上下文
  stateFor: (item) => ({
    对话: item.thread.map((m) => ({ 角色: m.role, 内容: m.text })),
    本条: item.text,
  }),

  normalize: (a) => ({
    under_scope: a.under_scope.noul,
    simple_means: a.simple_means.choice,
    simple_conf: a.simple_means.confidence,
    new_goal: a.new_goal.noul,
    time_commit: a.time_commit.noul,
    // 5 档加权分折算成 0–10：Jev 只给档位分布，「9/10」这个数字是代码算出来的
    risk10: +((a.blast_radius.score / 4) * 10).toFixed(1),
    settled: a.settled.noul,
    tomorrow: a.deliverable_by_tomorrow?.noul ?? null,
  }),

  thresholds: { scopeGate: 0.6, commitGate: 0.5, settledGate: 0.7 },

  /** 建议回复全部来自这张表 —— 不是 Jev 写的，它不生成文本 */
  decide(v, th = {}) {
    const t = { ...this.thresholds, ...th };
    const trace = [];
    const step = (pass, text) => { trace.push({ pass, text }); return pass; };
    const lines = [];

    if (step(v.under_scope >= t.scopeGate, `措辞与实际范围不符（under_scope ${v.under_scope.toFixed(2)}）`)) {
      lines.push(`先确认范围，别先应「好的」：这条描述的实际范围大于「${v.simple_means === "budget" ? "预算" : "功能"}简单」能覆盖的。`);
    }
    if (step(v.new_goal >= t.scopeGate, `新增独立目标（new_goal ${v.new_goal.toFixed(2)}）`)) {
      lines.push("把新增项单独列成一条，并明确它和已有项谁先谁后。");
    }
    if (step(v.time_commit >= t.commitGate, `被索要时间承诺（time_commit ${v.time_commit.toFixed(2)}）`)) {
      lines.push("把「上线」拆成「可看的演示版」和「正式交付」两个词再回答，只承诺前者。");
    }
    if (step(v.settled >= t.settledGate, `对方已接受且未追加（settled ${v.settled.toFixed(2)}）`)) {
      lines.push("书面复述一遍已达成的口径并存档；从这一刻起停止追加新承诺。");
    }
    if (!lines.length) lines.push("这条不需要澄清动作，正常推进。");

    return {
      action: v.settled >= t.settledGate ? "settled" : v.new_goal >= t.scopeGate || v.under_scope >= t.scopeGate ? "clarify" : "proceed",
      why: lines.join(" "),
      trace,
    };
  },
  fallback: { action: "unknown", why: "Jev 不可用，只回原文，不猜意图", trace: [] },

  cases: [],
  lintWaive: {},
  // 审计日志里 item 是 {text, thread}，直接 stringify 会把整段对话挤进一行预览
  previewOf: (item) => (typeof item === "string" ? item : `老板：${item.text}`),
}));

/** 截图里那段对话，逐条累积成 thread —— 「危机是否解除」只有带上下文才问得出 */
export const bossThread = [
  "在吗？有个小需求。",
  "做个像淘宝一样的，简单点就行。",
  "可以，顺便加个 AI。",
  "都要。明天能上线吧？",
  "行，你看着安排。",
].map((text, i, all) => ({
  text,
  role: "老板",
  thread: all.slice(0, i).map((t) => ({ role: "老板", text: t })).concat([{ role: "我", text: "（上一条的回应）" }]),
}));
