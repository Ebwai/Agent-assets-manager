---
paths:
  - "company-preset.mjs"

  - "scripts/launch.mjs"
  - "server.mjs"
  - "skill-visualization.mjs"
  - "public/skill-*.js"
  - "test/skill-*.mjs"
  - "model-*.mjs"
  - "public/model-*.js"
  - "test/model-*.mjs"
---

## Skill画板图文协作

### 模块概览

Architecture：[[docs/Architecture|项目架构与本次扩展]]。PRD：Skill可视化编排、画板结构与规则编辑、画板确定性文档生成、画板提示管理、图文同步保存、Skill智能可视化转换、Skill文字变更同步画板。

实现锚点：`public/skill-graph.js`（语义与生成），`public/skill-canvas.js`（画板交互），`skill-visualization.mjs`（提示词与模型输出解析），`server.mjs`（转换及保存入口），`public/app.js`（Skill 编辑器接入），`test/skill-graph.test.mjs`、`test/skill-visualization.test.mjs`（验证）。

### API 概览

| 契约 | 方向 | 关键行为 | 失败语义 |
| --- | --- | --- | --- |
| 画板生成 | 编辑器／服务 → 共享模块 | 固定模板生成正文，按节点与连线显式表达控制关系 | 仅不合法数据结构拒绝；语义不完整仍生成 |
| AI 转图／同步 | 编辑器 → 本地服务 → 已配置模型 | 自动选取章节；更新时提供旧图、旧正文、编辑后正文及变化 | 模型／解析失败不覆盖草稿、不保存版本 |
| 保存 Skill | 编辑器 → 本地服务 | 存在图的模板正文必须等于共享生成结果 | 不同步拒绝，先 AI 同步或通过画板修改 |

### 数据模型

图保存在每个 variant 的 graph 内，自然跟随 profiles 中 variants 的快照隔离。节点、连线、非可视化章节、提示移除状态是版本事实；视图位置仅影响呈现。正文是图的确定性输出；作者便签及改进建议不进入 Agent 指令。

### 关键流程

1. 画板修改 → 共享生成器 → 同一 variant 正文 → 用户保存 → 现有 Git 提交。
2. 正文编辑 → 显示需同步 → 用户选择模型并点击同步 → 携带原图和变更请求 → 解析整图 → 同一生成器 → 草稿恢复可保存状态。
3. 转图自动选择章节；保留文字按合适章节或文末生成，修改建议只在编辑器展示。第一次空白建图保留既有正文，不丢弃原内容。

### 状态机

无画板 → 新建／AI 转图 → 图文一致；图文一致 → 正文变更 → 待 AI 同步；同步成功 → 图文一致；失败／取消 → 保留待同步状态。正在请求时若用户切换资产／模板或修改内容，返回结果不得应用到新上下文。

### 一致性、并发与幂等

R13：modelMapping 随 selectedModel 进入预览／确认输入，只引用供应商已保存列表。Claude 家族别名、子任务、可选版本映射与完整 picker 由同一映射投影；版本映射逐字段管理，不替换无关映射。Codex 生成独立私有 JSON 目录，slug 保持真实 ID，显式配置 context 和 reasoning，关闭未确认的专有传输／工具能力。目录内容与主配置一起预览、哈希保护、备份与撤销；旧版本应用记录没有目录时可升级。不得改写真实全局配置进行开发验收；用隔离配置启动实际客户端核对模型列表及请求 ID。

实现锚点：public/model-mapping.js 校验本次映射，model-catalog.mjs 生成 Codex 目录，public/model-application.js 管理应用窗口，model-application.mjs 将目录作为 additionalFiles 与主配置一起事务写入。目录位于 private/model-catalogs/<目标配置哈希>.json，首次原文和写入哈希保存于应用记录；目录被改动后允许按新预览覆盖／恢复，预览后内容变化仍使令牌失效。model-application-state 按供应商及目标路径返回本机上次映射，未应用的预览不保存设置。Claude modelOverrides 按源模型键管理，移除映射后恢复该键原值。CLI／桌面端模型目录和实际请求不属于助手模型发现接口的自动同步副作用。

前后端调用同一生成器；服务端独立检查图文一致，不能只依赖保存按钮。布局、颜色、提示移除不改变正文。循环用稳定步骤引用表示，不递归展开；断线和孤立节点仍保留内容。生成器不得因任意连接形成死循环。

### 异常处理

结构或模型响应不可解析时说明原因并允许重试。所有语义缺漏是可移除建议，不阻止生成／保存。已有无图模板不增加同步要求。AI 结果只应用草稿，沿用现有明确保存版本动作。

### 监控与测试

证明分支与并行汇合、规则范围、资源、循环、保留章节不丢失；布局变更不改正文；缺省字段可通过；提示忽略可持久化；服务端拒绝未同步文字；模型失败／迟到响应不会创建版本或覆盖草稿；历史与模型配置隔离仍成立。

## 多协议模型服务与软件 API 配置

AI2Robot 分支初始化：installCompanyPreset 读取本机安装标记，优先匹配已有服务 ID 或同地址服务；仅在未安装、无匹配服务且资产库干净时校验并创建无密钥定义、仅提交该资产文件。预置使用固定 ID 和时间戳以避免跨电脑重复及无意义同步冲突；标记在成功保存或发现已有服务后写入 private，用户后续修改和删除不触发重置。模板不包含 apiKey，初始化不调用模型、不改 Codex/Claude 配置。test/company-preset.test.mjs 覆盖一次性安装、密钥留空、已有服务优先及脏工作区暂缓；test/model-services.test.mjs 核对真实服务启动后预置资产可见且 hasKey=false。

跨平台启动：scripts/launch.mjs 从脚本自身定位项目，检查 Node 版本、Git 和 package.json 所列依赖；缺失时执行 npm install，端口可用后启动 server.mjs。仅在 HTTP 返回助手页面后打开浏览器，失败提供 URL；信号转发到本次子进程。Linux 快捷方式 Exec 参数按桌面文件规则转义，不拼接 shell 命令；目标桌面目录优先通过 xdg-user-dir 获取，系统信任仍由用户确认。macOS／Ubuntu 原生图形环境在本机 Windows 环境无法直接验收，脚本语法及共享启动逻辑需独立验证。

### 模块概览

关联 PRD：模型服务配置、项目配置生效（R11）。实现锚点：`model-protocols.mjs`、`model-application.mjs`、`public/model-protocols.js`、`public/app.js` 及 `server.mjs`；对应验证位于 `test/model-*.test.mjs`。

### API 概览

- 模型调用和连接测试：统一输入系统提示词与用户文字，返回文本；缺省协议兼容旧 Anthropic 配置。非 JSON、空文本、拒绝、截断与远端错误作为显式失败。
- 软件配置预览：读取已保存模型、当前文件及受管记录，返回目标路径、脱敏前后配置和预览令牌；不写任何配置或凭据程序。
- 确认生效／撤销：重建计划并比对预览令牌，文件、模型或密钥发生变化则要求重新预览；确认后写入配置及本机管理记录。

### 数据模型

服务元数据进入原有资产版本，Key 仍只在 private/keys.json。目标配置只引用 private 中的凭据辅助程序。应用记录持有受管字段原值、上次写入值和格式原文；此记录为本机恢复事实，不进入资产同步。

R12：服务的 models 保存可选模型 ID，aiModel 保存资产辅助选择，旧 model 字段保持为 aiModel 的兼容投影；旧服务只读时按其 model 兼容，保存时规范化。不改服务 ID、profileKey 或资产引用。外部应用请求的 selectedModel 独立于 aiModel，需属于保存后的列表；该值进入预览令牌，应用不会保存或改动供应商。

目录发现接口接收草稿及本机 Key，支持常见目录格式、Gemini 分页及 Codex 目录的 output_text JSON 封装；服务明确要求 client_version 时只重试一次并取本机 Codex 版本。目录获取仅返回列表，不自动保存，也不替换已有 AI 辅助选择。

### 关键流程与异常处理

连接测试支持未保存草稿，可复用对应已保存 Key，不创建资产版本。目标软件应用只使用已保存服务中的模型；Claude Code 要求 Messages 兼容地址，Codex 要求 Responses 兼容地址，其他协议需显式填写外部网关端点。Claude Code 写 CLAUDE_CONFIG_DIR/settings.json（默认 ~/.claude/settings.json），Codex 写用户 config.toml，均不需要项目。辅助程序运行时读取最新 Key，因此更新密钥不需要重写目标配置。

旧项目覆盖迁移：服务端从已登记本机项目路径识别旧记录；仅恢复记录对应的受管字段。恢复目标文件、当前内容及管理记录纳入同一预览令牌与回滚计划。受管字段已被修改时仍按预览确认恢复原值；无关字段保留。未被助手管理的项目覆盖不自动改动。

### 一致性、并发与幂等

配置确认须与预览输入一致；预览读取当前文件，确认后覆盖受管字段，不再将与上次写入值的偏差作为冲突。再次应用保留首次原值，撤销恢复受管字段并保留其他字段；相同配置重复应用保持语义幂等。保留原始 TOML 文本用于无外部修改时完整恢复，发生无关字段修改时重新序列化以保留其语义。配置与私有记录采用临时文件替换，失败时恢复写入前内容。

R14 字段所有权：managedLeaves 将生成的对象配置及旧版整表记录投影为叶子字段，数组和需要整体删除的认证项作为原子值；provider 内的额外重试参数、picker 内的额外选项不属于生成字段，不覆盖。受管字段历史原值不被外部编辑重设，撤销仍指向首次应用前。目录文件由助手整体生成，允许重建，异常 JSON 在预览中标明为非 JSON 原始文本；目标恢复路径校验及预览令牌并发保护继续有效。本次变更仅限模型 API，不改变 Hooks／Rules 的外部修改保护。

### 监控与测试

验证四种协议的地址、鉴权、请求与响应；错误、空响应和截断；旧配置与密钥隔离；两种软件的预览零写入、实际文件内容、辅助程序凭据读取、重复应用、撤销、并发变更拒绝及无关配置保护。通过隔离用户目录完成测试，不接触真实用户级配置。

R12 验收：全套 50 项测试通过，新增供应商规范化、模型目录及分页、AI 请求模型选择、外部独立选择与预览令牌、旧项目覆盖迁移和外部修改保护。真实服务经模型发现接口获取 7 个可见模型，资产辅助 gpt-6.1-sol 文本连接成功，软件生成独立用户级配置后以 gpt-6-luna 完成真实 Codex 会话，返回预期验收文本。

R13 验收：55 项测试通过。RUN_NATIVE_MODEL_TESTS=1 显式启用已安装客户端的验收，Windows 通过 CLAUDE_TEST_BINARY 指定原生 exe。原生 Codex model/list 返回配置列表，实际请求及 Claude 家族别名请求由本地模拟接口捕获，验证真实 ID 一致；不把模拟上游记录为 DeepSeek 远端兼容认证。真实既有 Responses 服务另以隔离目录完成 gpt-6-luna 会话。完整 Claude picker 的最低版本依据官方文档，本机旧版只验收别名映射。桌面原生 UI 未直接操作，目录 backend 验收和 UI 版本限制分别记录。

真实服务验收使用独立 CODEX_HOME：生成配置通过 Codex 严格解析，gpt-6.1-sol 会话完整结束并返回预期文本；同服务的 Responses 函数调用及结果回传通过。该服务模型目录带非标准封装，Codex 目录刷新仍会报告解码／超时告警；指定模型实际推理成功。本机 shell 补充测试被 Codex 执行策略拒绝，此环境限制单独记录，不计为文件读取成功。


### 模型通用能力（2026-10-22）

服务资产新增可选 `modelCapabilities: [{ id, contextWindow, reasoning }]`；共享规范化函数校验 ID 唯一且属于列表，窗口 4096–2000000，reasoning 为 none/standard。定义随资产版本同步，密钥仍私有。模型编辑页按 ID 维护、发现合并保留能力、删除 ID 清除对应能力；旧记录优先从本机 Codex 应用历史带回。未保存前仍兼容旧应用行；存在通用字段时，服务端忽略应用输入中的能力，缺失行使用默认值。

Codex 复用目录投影。Claude 按所有 picker、别名及版本映射目标的最小窗口写 `env.CLAUDE_CODE_MAX_CONTEXT_TOKENS`，家族及默认自定义选项写 `_SUPPORTED_CAPABILITIES=effort` 或空值；不关闭压缩、不伪造模型 ID。预览提示识别模型/[1m]/旧客户端与任意 picker ID 的限制。所有新增字段沿用叶子管理、预览哈希、首次原值撤销。实现：public/model-protocols.js、model-config.js、model-mapping.js、model-application.js、model-application.mjs；验证：test/model-mapping.test.mjs。
