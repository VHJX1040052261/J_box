// expect: auto = 确定性可办结 | specialist = 归属明确但需推理/多步 | human = 必须人工
export const cases = [
  { expect: "auto", msg: "你好，我们公司发票抬头写错了，能不能把上个月那两张发票作废重开成「杭州云栖科技有限公司」？" },
  { expect: "auto", msg: "Where is my order #45120? It was supposed to arrive Tuesday and tracking hasn't moved in four days." },
  { expect: "auto", msg: "你们专业版套餐多少钱？如果用不合适之后可以随时取消吗？" },
  { expect: "auto", msg: "I can't log in. My password reset email never arrives, I've requested it five times over two hours." },
  { expect: "auto", msg: "麻烦帮我把账户的计费周期从月付改成年付，邮箱是 ops@liantong.cn" },

  { expect: "specialist", msg: "我们对接你们的支付回调，第三天开始持续返回 500，重新生成 API key 之后仍然失败，日志见附件。" },
  { expect: "specialist", msg: "Your export API returns `created_at` in epoch seconds but the docs say ISO-8601, and the values disagree with the dashboard filter for the same date range." },
  { expect: "specialist", msg: "导出接口返回的数据字段和文档定义不一致，需要逐字段核对映射关系并确认哪个是权威来源。" },
  { expect: "specialist", msg: "Our nightly sync silently dropped about 3% of rows for three days. No errors in logs. Need to know what was lost and whether we must notify our customers.", dispute: "「是否必须通知客户」本身是合规判断，转人工未必是错 —— 这条标注偏乐观，算分时单列" },

  { expect: "human", msg: "你好，想问问有没有什么办法能把那个东西弄一下，就是关于之前说的那个选项吧。" },
  { expect: "human", msg: "hello there, wondering if maybe there's some way to possibly do the thing with the stuff when it comes to that other option" },
  { expect: "human", msg: "请立刻把我账户里被错误扣掉的 2800 元退回来，并且把多出来的企业版订阅直接注销掉，今天必须到账。" },
  { expect: "human", msg: "你们 API 文档里写的费率和账单上实际收的不一样，这直接影响我们要不要续约，到底按哪个算？" },
  { expect: "human", msg: "我怀疑你们未经授权扣了我的款，我已经在准备向银保监和市场监管部门投诉，并保留诉讼权利。" },
  { expect: "human", msg: "someone please help, it's broken, i have been waiting for a long time now" },
];
