# 🎤 面试演示手册

包含：3 分钟演示脚本 · 关键架构说明 · 10 个高频追问与参考答案。

---

## A. 3 分钟演示脚本

> 演示前准备：启动后端（8000）与前端（5173），**浏览器打开页面、后端终端可见日志**。
> 建议用 **Mock Mode** 演示（右上角显示 `🧪 Mock Mode`），断网也不慌；讲完架构再切真实模式跑一次。

| 时间 | 动作 | 讲解要点（照着说） |
| --- | --- | --- |
| 0:00–0:20 | 打开页面，指一遍三栏布局 | "左侧是会话与示例问题，中间是 Chat，右侧是 Agent 执行轨迹和结果面板。顶部会显示当前是 Mock 还是真实模型。" |
| 0:20–0:50 | 点击 **「分析星海科技有限公司的综合风险」** | "注意看右侧：Agent 不是一次性回答，而是先理解任务，再一步步调用工具。" |
| 0:50–1:40 | 指着右侧 Execution 逐条念 | "第 1 步查工商信息 → 第 2 步检索风险事件 → 第 3 步算财务指标 → 第 4 步检索知识库 → 第 5 步生成报告。每一步都能展开看 Input / Output / 耗时 / 状态，这部分就是 Agent 的可观测性。" |
| 1:40–2:10 | 等报告出来，切到 **Dashboard** Tab | "最终不是纯文本，而是结构化结果：总评分、财务/法律/经营三个分项等级、关键指标、证据链、建议措施。每条证据都带来源，可追溯到是哪个工具给的。" |
| 2:10–2:35 | 点开某一步展开 Output，再切 **Eval** Tab | "这是轻量评测：10 个用例（含 4 个边界用例）跑必选召回、工具精确度、F1、任务成功率、平均步数、平均延迟。Mock 模式下 10/10 全过、召回/精确度/F1 都是 100%、平均 2.4 步。" |
| 2:35–3:00 | 切到后端终端展示结构化日志 | "每个请求都有 request_id / session_id / model / tool_calls / steps / latency，JSON 格式，方便接入 ES 或 Loki。整套东西从零到能跑，代码量控制在 2000 行左右。" |

**收尾一句话**：
> "这个 Demo 的重点不是业务深度，而是把 Agent 的完整工程链路跑通：规划、工具、检索、计算、容错、流式、可视化、评测、可观测。"

**加分动作（如果还有时间）**：

- 问一句 **「企业资产负债率过高意味着什么」** → 只调 1 次知识库，证明 Agent 会按意图裁剪步骤。
- 问 **「分析恒川重工集团有限公司的综合风险」** → Dashboard 全红，对比不同样本的结论差异。
- 故意问 **「查一下不存在的公司」** → 工具返回错误，Agent 不崩溃，把错误呈现出来。

---

## B. 关键架构说明（讲的时候用这三句串起来）

1. **决策在 LLM，执行在代码**
   LLM 只决定"下一步调哪个工具、传什么参数"；所有事实数据来自工具，所有数值计算由 Python 完成。模型不做算术、不编数据。

2. **一条主循环，两个护栏**
   `orchestrator.py` 里的循环就是 Plan → Action → Observation → 再判断 → Final Answer。
   护栏是 `max_steps=8` 与"相同参数重复调用熔断"，再加工具级 timeout，保证 Demo 不会卡死。

3. **SSE 把过程透出来**
   后端用同一个异步生成器同时支持普通调用和 SSE 流式；前端手动解析 SSE 帧，所以能做到"先看到过程，再看到答案"。

4. **关键数据是"注入"的，不是模型"传"的**
   真实模式的工具调用走 OpenAI 原生多轮协议（`assistant.tool_calls` + `tool.tool_call_id` 回填），不会退化成"让模型拼 JSON 字符串"；而 `report_generator_tool` 只收 `company_name`，工商/风险/财务/知识这些前序结果由主循环在调用前注入，模型没法用幻觉覆盖它们。每一轮决策前都会发 `planning_start` 事件，证明 `agent_prompt` 每一轮都真正参与了规划。

**核心代码位置（被追问时直接翻）**

| 想看什么 | 文件 |
| --- | --- |
| Agent 主循环、熔断、超时 | `backend/app/agents/orchestrator.py` |
| 工具抽象与注册 | `backend/app/tools/base.py`、`registry.py` |
| 财务计算（纯 Python） | `backend/app/tools/financial_analysis.py` |
| RAG 检索 | `backend/app/rag/retriever.py`、`embeddings.py` |
| 真实/Mock LLM 同构封装 | `backend/app/llm/client.py` |
| Prompt 集中管理 | `backend/app/prompts/*.md` |
| 结构化日志 | `backend/app/utils/logger.py` |
| SSE 前端解析 | `frontend/src/services/api.ts` |

---

## C. 面试官可能问的 10 个问题（含参考答案）

### Q1：为什么不直接按顺序写死 tool1→tool2→tool3，非要搞 Agent？

**答**：写死顺序在这个固定场景下确实更快，但它失去的是"按问题裁剪路径"的能力。
这个 Demo 里问"资产负债率过高意味着什么"只会调 1 次知识库，问"生成完整报告"才跑满 5 步——这是模型根据意图做的实时规划，不是 if-else。
从工程角度，我保留的是一套可替换的决策器：现在是 LLM，明天可以换成规则、换成小模型、换成带人工审核的半自动模式，Tool 层与业务层都不用动。
当然我也承认，生产里对于 **流程固定、容错率低** 的任务，我会用工作流编排（Dify / 状态机）把主干固化，只在需要灵活判断的节点上让 Agent 决策——**能确定性的地方不要交给概率**。

### Q2：怎么保证 LLM 不编造数据？

**答**：四道防线。
① System Prompt 明确写死"事实必须通过工具获取，禁止编造工具未返回的数据"；
② 工具本身不提供兜底假数据，查不到企业直接抛错（比如 `company_info_tool` 会返回"未找到企业 X，可查询的企业：…"）；
③ 财务数字全部由 Python 计算，模型只拿到算好的指标，没有编的空间；
④ 报告中每条结论都要求挂证据与来源，来源只能是工具或知识库文档，前端会展示出来，编造很容易被肉眼发现。
如果要更严格，还可以加一道"事实校验 Agent"，把最终答案里的数字与工具返回值做一次对齐检查。

### Q3：Agent 死循环 / 无限调用工具怎么办？

**答**：三层防护。
① `max_steps=8`，到达上限强制基于已有结果收尾，不允许再调工具；
② 重复调用熔断：对 `(tool_name, 参数)` 做指纹，相同指纹超过 2 次就中断，并向模型注入"检测到重复调用，请直接给出结论"的系统提示；
③ 每个工具有 `TOOL_TIMEOUT=15s` 超时，用 `asyncio.wait_for` 包住，超时返回结构化错误而不是让协程挂住。
另外工具执行在线程池里（`asyncio.to_thread`），不会阻塞事件循环，一个慢工具不会拖垮整个服务。

### Q4：工具调用失败了怎么处理？

**答**：分三层，不让异常直接冒泡把服务打挂。
① **工具层**：`BaseTool.run()` 统一做参数校验（Pydantic）+ 计时 + try/except，失败返回 `ToolResult(success=False, error=...)` 而不是抛异常；
② **Agent 层**：把错误作为 observation 回灌给模型，Prompt 里允许它"换参数重试一次，仍失败就跳过并在结论中标注数据缺失"，所以工具挂了 Agent 仍能给出一个降级的、诚实的结论；
③ **API 层**：再兜一层 try/except，SSE 场景下发 `error` 事件，前端显示提示而不是白屏。
日志里会记录完整堆栈，但不会把堆栈直接暴露给用户。

### Q5：为什么财务指标要 Python 算，不让 LLM 算？

**答**：三个理由。
① **准确性**：LLM 做多位数除法、同比增速这类算术并不可靠， Growth Rate 算错一个符号，风险等级就完全反了；
② **可审计**：Python 算的每一步都能落到日志和单元测，监管场景下要能解释"72% 这个数怎么来的"；
③ **可复用与确定性**：同一份数据每次算出来必须一样，模型有 temperature，天然不确定。
我的原则是 **模型负责理解与决策，代码负责计算与执行**。这也是 function calling 的核心价值——把模型不擅长的事外包给确定性的程序。

### Q6：RAG 为什么不用向量数据库？检索质量怎么保证？

**答**：这是 Demo 的取舍。知识库只有 3 篇文档、15 个 chunk，内存里做一次余弦相似度的开销可以忽略，引入 FAISS/Chroma 反而增加部署复杂度与启动时间，不符合"能跑起来、好讲清楚"的目标。
代码里我把 embedding 抽成了 `BaseEmbedding` 接口，默认是本地 hashing 向量（中文单字 + bigram + hashing trick，零依赖、断网可用），设置 `EMBEDDING_PROVIDER=openai` 就能切到 text-embedding-3-small，检索代码一行不用改。
如果要提升质量，我会做三件事：换更强的 embedding、按 Markdown 标题做更合理的 chunk（现在已按标题切分并保留 heading）、加上 **混合检索（BM25 + 向量）** 与 rerank。生产环境再上向量库 + 元数据过滤。

### Q7：Streaming 怎么实现的？为什么选 SSE 不用 WebSocket？

**答**：后端用 FastAPI 的 `StreamingResponse` 发 `text/event-stream`，事件有 `start / planning_start / step / tool_start / tool_result / calculation / rag_result / context_injection / token / report / summary / done / error` 十三类，每个事件都带 `request_id / timestamp / t_ms`，方便对齐时序与排查。
选 SSE 的原因是这个场景是**单向推送**（服务端 → 客户端），SSE 基于 HTTP、自动重连、浏览器原生支持、不需要额外协议升级，调试时 `curl` 就能看到流；WebSocket 适合双向实时（协同编辑、游戏），这里用不上，反而增加连接管理成本。
实现上有三个细节值得说：
① 因为要携带 body（用户问题、会话上下文），用的是 **POST + 手动 `fetch` 解析 SSE 帧**，而不是浏览器原生 `EventSource`（它只支持 GET、不能带 body），所以前端自己按 `\n\n` 分帧解析 `event:` / `data:`；
② 普通调用和流式调用共用同一个 `async generator`，非流式接口只是把事件收集起来取最后一个，两条路径不会行为不一致；
③ Demo Studio 的左右双屏由**同一条 SSE 流**驱动，不存在左边播动画、右边真执行的问题。

### Q8：Mock 模式和真实模式的差别？会不会"演示专用"？

**答**：差异只在 **决策器**：真实模式是 OpenAI-compatible 的 function calling（不支持时自动降级为 JSON 模式），Mock 模式是一个规则引擎，模拟"下一步调哪个工具"。
**除了决策，其余全是真的**：工具是真的执行、数据是真的读取、财务是真的 Python 计算、RAG 是真的向量检索、报告是真的按规则汇总、SSE 是真的流式、Eval 是真的跑。
所以 Mock 模式不是"播放录屏"，它只是把模型换成了确定性规则，这样面试现场没网、没 Key、模型抽风都能稳定演示。两者实现同一个 `BaseLLMClient` 接口，业务代码零感知。

### Q9：Eval 怎么做的？怎么衡量一个 Agent 好不好？

**答**：当前是**工具选择 + 调用路径**的轻量评测：10 个用例（6 个常规 + 4 个边界），每个用例用 `required_tools / allowed_tools / forbidden_tools` 标注「必须调用 / 可选调用 / 禁止调用」。跑完后报告五个指标——必选召回（Required Recall）、工具精确度（Precision）、F1、任务成功率、Unexpected/Forbidden 命中次数，再加平均步数与平均延迟。可以在命令行、HTTP、前端 Tab 三种方式运行。

为什么不用单一 Accuracy：如果只算"命中期望工具 / 期望工具数"，Agent 多调了无关工具也会虚高。拆成 Recall / Precision / F1，并把「禁止调用」单列成 Forbidden 命中，才能把"多调、漏调、错调"三类问题分开暴露。边界用例专门验证"不存在的企业不崩、纯知识问答只调 RAG、法律专项不跑财务"这类容易翻车的场景。

它的价值是**回归护栏**：我改 Prompt 或工具描述之后，跑一遍就知道有没有把工具选择带偏。
但依然不够——它不评估答案质量。要继续做我会加三层：
① 答案层：LLM-as-judge 按 rubric 打分（事实性、完整性、可操作性）；
② RAG 层：RAGAS 的 faithfulness / relevance；
③ 线上层：埋点看人工采纳率与修正率，反哺用例集。

### Q10：如果要上生产，你会改哪些地方？

**答**：按优先级说五点。
① **数据与合规**：接真实数据源（企查查/天眼查、Wind），加鉴权、审计留痕与数据脱敏，企业敏感信息不能进境外模型；
② **稳定性**：给 LLM 加重试与多模型 fallback、加缓存（同企业同问题 5 分钟内复用）、把工具调用做成可并行；
③ **质量闭环**：补答案质量评测集 + 线上人工反馈回流，Prompt 版本化管理（现在只是 md 文件，生产要能灰度）；
④ **架构**：会话与轨迹持久化（Postgres + 对象存储）、索引搬到独立的检索服务、Agent 执行改任务队列，支持长任务异步化；
⑤ **成本**：分级用模型（规划用小模型、报告用大模型）、对长 trajectory 做摘要压缩、流式首字时间优化。
最后补一句：**这个 Demo 我刻意控制在 2000 行左右，是为了让每一层都能在面试里讲透；生产化是另一套工程体系。**

---

## D. Bonus：两个常被追问的小问题

**Q：为什么不显示模型的 Chain-of-Thought？**
A：两个原因。一是安全与合规——内部推理可能包含敏感中间判断，不适合直接暴露给终端用户；二是产品体验——用户要的是"正在查工商信息"这种进度感，不是几百字的推理。
所以我只保留 `thought_summary`，它是面向用户的简短行动说明，并且超过 60 字会被截断替换为默认文案。

**Q：多轮对话上下文怎么处理的？**
A：当前 Demo 以单轮为主，会话历史存在内存 `SessionStore` 里，Agent 的上下文是**当前这一轮的 messages**（system + user + 工具往返）。
生产里我会做：历史消息做窗口截断 + 摘要压缩、工具返回的 observation 只保留摘要进上下文（完整数据放 artifact 按需取回），并在多轮里做指代消解（"它的负债率呢" → 星海科技）。

---

## E. Demo Studio 双屏演示（现场推荐用这个）

### E.1 3 分钟「双屏 Demo」台词

**【开场 15s】**
> 这个项目叫 Enterprise Risk Agent，目标不是做复杂生产系统，而是展示一个**小而完整、可运行、可观测**的 LLM Agent。我准备了两个视图：左侧回答"Agent 是怎么工作的"，右侧回答"Agent 最终能做出什么"。

**【进入 /demo 30s】**
> 我打开 Demo Studio，开启 Presentation Mode 和 Presentation 速度。点 **LOAD DEMO** 自动填入示例问题，然后手动 Send——我不想让动画假跑，面试现场每一步都应该是真实的。

**【执行过程 90s】**
> 1. Agent 收到请求后，先进入 **PLAN** 阶段，模型决定调用 `company_info_tool`。左侧出现 Schema Validation ✓、Timeout 15s、Computed by Python——注意，所有确定性计算都走 Python，不是让模型算。
> 2. 然后依次 **Risk Search**、**Financial Analysis**。财务卡片里你会看到真实 Python 计算出的指标：营收增长率 -17.95%、资产负债率 72%、经营性现金流 -9 百万元。
> 3. 接着进入 **RAG Retrieval**：3 篇本地文档、15 个 chunk、Top-K 3，每个片段都带真实的余弦相似度 score，不是伪造的。
> 4. 最后 **Report Generator** 汇总出结构化报告，右侧 Dashboard 同步出现 Overall Risk HIGH、分项等级和证据链。

**【收尾 45s】**
> 完成后左侧显示 **AGENT COMPLETED**：5 steps、5 tool calls、0 errors、~2.2s。Guardrails 面板所有检查项通过。左侧底部的文字说明：我们不暴露 Chain-of-Thought，只展示执行摘要。整个流程在无 API Key 的 Mock Mode 下也能完整跑通，适合面试现场任何网络环境。

### E.2 现场最值得展示的 5 个点

1. **同一条 SSE 驱动双屏**：左/右两侧数据来自同一个 `streamChat` 调用，不存在左右不同步。
2. **Tool Calling 是核心**：左侧把 `tool_start` / `tool_result` 分开显示，可展开 Input / Output / Duration / Schema Validation。
3. **Python 真实计算**：`financial_analysis_tool` 结果页明确标出 COMPUTED BY PYTHON，避免 LLM 编造数字。
4. **RAG 真实检索**：展示 source + heading + score，可直接解释 Document → Chunk → Vectorize → Similarity → Top-K 的流程。
5. **Guardrails 可视化**：Max Steps、重复调用检测、Schema 校验、CoT Protection 全部来自运行时，不伪造状态。
