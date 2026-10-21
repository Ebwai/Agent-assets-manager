# Agent 资产管理助手 PRD

基线日期：2026-10-18 · 项目版本：0.1.0 · 代码基点：eecfd54 + 当前工作区修改

## 文档口径与使用方式

本 PRD 按 docs-generator 的 PRD 模板，从当前已有实现反推产品能力。按照用户“直接由代码补齐”的要求，本次直接整理完整层级；未把反推的目标描述为逐层访谈确认结果。现有行为基线不等同于逐条验收已通过。

最上层以完整骨架及所有节点的 bottom-up 实现顺序为主体。每个概念、机制均有独立文档，按骨架层级存放在 `docs/prd/`；具体规则、交互和异常见节点文档。骨架使用 双中括号文档引用 指向仓库根目录下的唯一文件，下面的导航表提供普通 Markdown 链接。

需求目标由当前产品能力归纳；新增目标或改变行为时，应先确认产品语义，再增量调整相应节点。代码入口仅用于追溯，不在 PRD 定义接口、类、函数或模块依赖。

## 需求与功能包导航

| 需求 | 从当前产品归纳的用户目标 | 功能包 |
| --- | --- | --- |
| R1 | 集中维护与复用能力资产 | [资产创作与组合](prd/资产管理工作台/资产创作与组合.md) |
| R2 | 将事件自动化脚本标准化管理 | [事件自动化管理](prd/资产管理工作台/事件自动化管理.md) |
| R3 | 承接已有项目与核查实际配置 | [项目资产接入](prd/资产管理工作台/项目资产接入.md) |
| R4 | 把正确版本的资产用于目标软件 | [项目配置生效](prd/资产管理工作台/项目配置生效.md) |
| R5 | 追溯修改并跟踪未解决问题 | [资产版本与问题跟踪](prd/资产管理工作台/资产版本与问题跟踪.md) |
| R6 | 跨电脑共享资产与完整历史 | [资产库远程同步](prd/资产管理工作台/资产库远程同步.md) |
| R7 | 维护完整用途包及上游/自用修改 | [Plugins包管理](prd/资产管理工作台/Plugins包管理.md) |
| R8 | 借助模型审查与迭代 Skill | [模型辅助迭代](prd/资产管理工作台/模型辅助迭代.md) |
| R9 | 按框架模型匹配并隔离本机信息 | [公共支撑能力](prd/资产管理工作台/公共支撑能力.md) |
| R10 | 统一画板编排 Skill，程序化生成正文，AI 自动转图及同步文字修改 | [Skill可视化编排](prd/资产管理工作台/资产创作与组合/Skill可视化编排.md) |
| R11 | 配置多种协议的模型 API，并支持应用为 Claude Code 和 Codex 的自定义 API | [模型服务配置](prd/资产管理工作台/模型辅助迭代/模型服务配置.md)、[项目配置生效](prd/资产管理工作台/项目配置生效.md) |
| R12 | 用户级应用供应商 API，维护多模型列表并独立指定资产 AI 辅助模型 | [模型服务配置](prd/资产管理工作台/模型辅助迭代/模型服务配置.md)、[模型API配置生效](prd/资产管理工作台/项目配置生效/模型API配置生效.md) |
| R13 | 应用时配置别名映射与目标模型列表，确保实际请求使用供应商模型 ID | [模型API配置生效](prd/资产管理工作台/项目配置生效/模型API配置生效.md) |
| R14 | 确认后覆盖模型 API 受管字段，保留所有非受管字段 | [模型API配置生效](prd/资产管理工作台/项目配置生效/模型API配置生效.md) |

R10 来源：2026-10-19 用户确认既有讨论及六项批注，授权需求拆解后直接实现。语义检查仅提醒；AI 自动选择章节；正文修改先 AI 同步再保存；原文逐段定位暂缓，不增加推断确认流程。

主路径：登记项目与配置模型 → 创作或导入资产 → 保存版本 → 选择目标与组合 → 预览确认生效 → 查看当前配置 → 问题记录和迭代。全库同步及 Plugin 维护按需进行。

## PRD完整骨架(需求→ 概念/机制映射)

以下按模板示例以正文树形排版。需求箭头指向对应能力分支；树枝只表示直接下一层；⇢ 引用其他位置已定义的能力，不重复展开其子树。

{统一管理 Agent 资产} ──→ [[docs/prd/资产管理工作台|资产管理工作台]] [C]\
                             ├── [[docs/prd/资产管理工作台/资产创作与组合|资产创作与组合]] [C] ←── {R1 集中维护与复用能力资产}\
                             │   ├── [[docs/prd/资产管理工作台/资产创作与组合/Skill内容与资源编辑|Skill内容与资源编辑]] [C] ●\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/资产版本与问题跟踪/资产版本保存|资产版本保存]]\
                             │   │   └── ⇢ [[docs/prd/资产管理工作台/公共支撑能力/框架模型配置匹配|框架模型配置匹配]]\
                             │   ├── [[docs/prd/资产管理工作台/资产创作与组合/Skill本地导入|Skill本地导入]] [C] ●\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/资产创作与组合/Skill内容与资源编辑|Skill内容与资源编辑]]\
                             │   │   └── ⇢ [[docs/prd/资产管理工作台/资产版本与问题跟踪/资产版本保存|资产版本保存]]\
                             │   ├── [[docs/prd/资产管理工作台/资产创作与组合/Skills套件组合|Skills套件组合]] [C] ●\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/资产创作与组合/Skill内容与资源编辑|Skill内容与资源编辑]]\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/公共支撑能力/框架模型配置匹配|框架模型配置匹配]]\
                             │   │   └── ⇢ [[docs/prd/资产管理工作台/资产版本与问题跟踪/资产版本保存|资产版本保存]]\
                             │   ├── [[docs/prd/资产管理工作台/资产创作与组合/分层提示词管理|分层提示词管理]] [C] ●\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/公共支撑能力/框架模型配置匹配|框架模型配置匹配]]\
                             │   │   └── ⇢ [[docs/prd/资产管理工作台/资产版本与问题跟踪/资产版本保存|资产版本保存]]\
                             │   ├── [[docs/prd/资产管理工作台/资产创作与组合/Agent配置组合|Agent配置组合]] [C] ●\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/公共支撑能力/框架模型配置匹配|框架模型配置匹配]]\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/资产创作与组合/Skills套件组合|Skills套件组合]]\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/资产创作与组合/分层提示词管理|分层提示词管理]]\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/事件自动化管理/Hooks分组组合|Hooks分组组合]]\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/资产创作与组合/Claude规则编辑|Claude规则编辑]]\
                             │   │   └── ⇢ [[docs/prd/资产管理工作台/公共支撑能力/本机私有信息隔离|本机私有信息隔离]]\
                             │   ├── [[docs/prd/资产管理工作台/资产创作与组合/Claude规则编辑|Claude规则编辑]] [C] ●\
                             │   │   └── ⇢ [[docs/prd/资产管理工作台/资产版本与问题跟踪/资产版本保存|资产版本保存]]\
                             │   └── [[docs/prd/资产管理工作台/资产创作与组合/Claude规则导入|Claude规则导入]] [C] ●\
                             │       ├── ⇢ [[docs/prd/资产管理工作台/资产创作与组合/Claude规则编辑|Claude规则编辑]]\
                             │       └── ⇢ [[docs/prd/资产管理工作台/资产版本与问题跟踪/资产版本保存|资产版本保存]]\
                             ├── [[docs/prd/资产管理工作台/事件自动化管理|事件自动化管理]] [C] ←── {R2 将事件自动化脚本标准化管理}\
                             │   ├── [[docs/prd/资产管理工作台/事件自动化管理/命令Hook编辑|命令Hook编辑]] [C] ●\
                             │   │   └── ⇢ [[docs/prd/资产管理工作台/资产版本与问题跟踪/资产版本保存|资产版本保存]]\
                             │   ├── [[docs/prd/资产管理工作台/事件自动化管理/Hook模拟测试|Hook模拟测试]] [C] ●\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/事件自动化管理/命令Hook编辑|命令Hook编辑]]\
                             │   │   └── ⇢ [[docs/prd/资产管理工作台/项目资产接入/项目登记与本机路径|项目登记与本机路径]]\
                             │   ├── [[docs/prd/资产管理工作台/事件自动化管理/Hooks分组组合|Hooks分组组合]] [C] ●\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/事件自动化管理/命令Hook编辑|命令Hook编辑]]\
                             │   │   └── ⇢ [[docs/prd/资产管理工作台/资产版本与问题跟踪/资产版本保存|资产版本保存]]\
                             │   └── [[docs/prd/资产管理工作台/事件自动化管理/原生Hook配置导入|原生Hook配置导入]] [C] ●\
                             │       ├── ⇢ [[docs/prd/资产管理工作台/事件自动化管理/命令Hook编辑|命令Hook编辑]]\
                             │       └── ⇢ [[docs/prd/资产管理工作台/资产版本与问题跟踪/资产版本保存|资产版本保存]]\
                             ├── [[docs/prd/资产管理工作台/项目资产接入|项目资产接入]] [C] ←── {R3 承接已有项目与核查实际配置}\
                             │   ├── [[docs/prd/资产管理工作台/项目资产接入/项目登记与本机路径|项目登记与本机路径]] [C] ●\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/资产版本与问题跟踪/资产版本保存|资产版本保存]]\
                             │   │   └── ⇢ [[docs/prd/资产管理工作台/公共支撑能力/本机私有信息隔离|本机私有信息隔离]]\
                             │   ├── [[docs/prd/资产管理工作台/项目资产接入/项目原生资产识别导入|项目原生资产识别导入]] [C] ●\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/项目资产接入/项目登记与本机路径|项目登记与本机路径]]\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/资产创作与组合/Skill本地导入|Skill本地导入]]\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/资产创作与组合/Claude规则编辑|Claude规则编辑]]\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/事件自动化管理/命令Hook编辑|命令Hook编辑]]\
                             │   │   └── ⇢ [[docs/prd/资产管理工作台/资产版本与问题跟踪/资产版本保存|资产版本保存]]\
                             │   └── [[docs/prd/资产管理工作台/项目资产接入/项目当前配置查看|项目当前配置查看]] [C] ●\
                             │       ├── ⇢ [[docs/prd/资产管理工作台/项目资产接入/项目登记与本机路径|项目登记与本机路径]]\
                             │       └── ⇢ [[docs/prd/资产管理工作台/项目配置生效/配置预览与确认写入|配置预览与确认写入]]\
                             ├── [[docs/prd/资产管理工作台/项目配置生效|项目配置生效]] [C] ←── {R4 把正确版本的资产用于目标软件}\
                             │   ├── [[docs/prd/资产管理工作台/项目配置生效/生效资产选择与展开|生效资产选择与展开]] [C] ●\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/公共支撑能力/框架模型配置匹配|框架模型配置匹配]]\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/资产创作与组合/Agent配置组合|Agent配置组合]]\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/资产创作与组合/Skills套件组合|Skills套件组合]]\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/事件自动化管理/Hooks分组组合|Hooks分组组合]]\
                             │   │   └── ⇢ [[docs/prd/资产管理工作台/资产创作与组合/分层提示词管理|分层提示词管理]]\
                             │   ├── [[docs/prd/资产管理工作台/项目配置生效/配置预览与确认写入|配置预览与确认写入]] [C] ●\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/项目配置生效/生效资产选择与展开|生效资产选择与展开]]\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/项目配置生效/已管配置更新与保护|已管配置更新与保护]]\
                             │   │   └── ⇢ [[docs/prd/资产管理工作台/资产创作与组合/分层提示词管理|分层提示词管理]]\
                             │   ├── [[docs/prd/资产管理工作台/项目配置生效/模型API配置生效|模型API配置生效]] [C] ●
                             │   └── [[docs/prd/资产管理工作台/项目配置生效/已管配置更新与保护|已管配置更新与保护]] [M] ●\
                             │       └── ⇢ [[docs/prd/资产管理工作台/项目资产接入/项目登记与本机路径|项目登记与本机路径]]\
                             ├── [[docs/prd/资产管理工作台/资产版本与问题跟踪|资产版本与问题跟踪]] [C] ←── {R5 追溯修改并跟踪未解决问题}\
                             │   ├── [[docs/prd/资产管理工作台/资产版本与问题跟踪/资产版本保存|资产版本保存]] [C] ●\
                             │   │   └── ⇢ [[docs/prd/资产管理工作台/资产版本与问题跟踪/问题记录与版本关联|问题记录与版本关联]]\
                             │   ├── [[docs/prd/资产管理工作台/资产版本与问题跟踪/资产历史选用与差异|资产历史选用与差异]] [C] ●\
                             │   │   └── ⇢ [[docs/prd/资产管理工作台/公共支撑能力/本机私有信息隔离|本机私有信息隔离]]\
                             │   ├── [[docs/prd/资产管理工作台/资产版本与问题跟踪/资产删除与恢复|资产删除与恢复]] [C] ●\
                             │   │   └── ⇢ [[docs/prd/资产管理工作台/资产版本与问题跟踪/资产版本保存|资产版本保存]]\
                             │   └── [[docs/prd/资产管理工作台/资产版本与问题跟踪/问题记录与版本关联|问题记录与版本关联]] [C] ●\
                             │       └── ⇢ [[docs/prd/资产管理工作台/公共支撑能力/本机私有信息隔离|本机私有信息隔离]]\
                             ├── [[docs/prd/资产管理工作台/资产库远程同步|资产库远程同步]] [C] ←── {R6 跨电脑共享资产与完整历史}\
                             │   ├── [[docs/prd/资产管理工作台/资产库远程同步/GitHub资产库连接|GitHub资产库连接]] [C] ●\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/公共支撑能力/本机私有信息隔离|本机私有信息隔离]]\
                             │   │   └── ⇢ [[docs/prd/资产管理工作台/公共支撑能力/同步前私有历史检查|同步前私有历史检查]]\
                             │   ├── [[docs/prd/资产管理工作台/资产库远程同步/资产库一键同步|资产库一键同步]] [C] ●\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/资产库远程同步/GitHub资产库连接|GitHub资产库连接]]\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/公共支撑能力/同步前私有历史检查|同步前私有历史检查]]\
                             │   │   └── ⇢ [[docs/prd/资产管理工作台/资产库远程同步/同步冲突逐项选择|同步冲突逐项选择]]\
                             │   └── [[docs/prd/资产管理工作台/资产库远程同步/同步冲突逐项选择|同步冲突逐项选择]] [C] ●\
                             ├── [[docs/prd/资产管理工作台/Plugins包管理|Plugins包管理]] [C] ←── {R7 维护完整用途包及上游/自用修改}\
                             │   ├── [[docs/prd/资产管理工作台/Plugins包管理/Plugin来源接入与资料|Plugin来源接入与资料]] [C] ●\
                             │   ├── [[docs/prd/资产管理工作台/Plugins包管理/Plugin文件与资产快照|Plugin文件与资产快照]] [C] ●\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/Plugins包管理/Plugin来源接入与资料|Plugin来源接入与资料]]\
                             │   │   └── ⇢ [[docs/prd/资产管理工作台/Plugins包管理/Plugin分支与推送|Plugin分支与推送]]\
                             │   ├── [[docs/prd/资产管理工作台/Plugins包管理/Plugin版本与上游更新|Plugin版本与上游更新]] [C] ●\
                             │   │   └── ⇢ [[docs/prd/资产管理工作台/Plugins包管理/Plugin分支与推送|Plugin分支与推送]]\
                             │   ├── [[docs/prd/资产管理工作台/Plugins包管理/Plugin分支与推送|Plugin分支与推送]] [C] ●\
                             │   │   └── ⇢ [[docs/prd/资产管理工作台/Plugins包管理/Plugin来源接入与资料|Plugin来源接入与资料]]\
                             │   └── [[docs/prd/资产管理工作台/Plugins包管理/Plugin自用分支融合与冲突|Plugin自用分支融合与冲突]] [C] ●\
                             │       └── ⇢ [[docs/prd/资产管理工作台/Plugins包管理/Plugin版本与上游更新|Plugin版本与上游更新]]\
                             ├── [[docs/prd/资产管理工作台/模型辅助迭代|模型辅助迭代]] [C] ←── {R8 借助模型审查与迭代 Skill}\
                             │   ├── [[docs/prd/资产管理工作台/模型辅助迭代/模型服务配置|模型服务配置]] [C] ●\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/资产版本与问题跟踪/资产版本保存|资产版本保存]]\
                             │   │   └── ⇢ [[docs/prd/资产管理工作台/公共支撑能力/本机私有信息隔离|本机私有信息隔离]]\
                             │   ├── [[docs/prd/资产管理工作台/模型辅助迭代/Skill模型审查|Skill模型审查]] [C] ●\
                             │   │   ├── ⇢ [[docs/prd/资产管理工作台/模型辅助迭代/模型服务配置|模型服务配置]]\
                             │   │   └── ⇢ [[docs/prd/资产管理工作台/资产创作与组合/Skill内容与资源编辑|Skill内容与资源编辑]]\
                             │   └── [[docs/prd/资产管理工作台/模型辅助迭代/Skill问题驱动改进|Skill问题驱动改进]] [C] ●\
                             │       ├── ⇢ [[docs/prd/资产管理工作台/模型辅助迭代/模型服务配置|模型服务配置]]\
                             │       ├── ⇢ [[docs/prd/资产管理工作台/资产创作与组合/Skill内容与资源编辑|Skill内容与资源编辑]]\
                             │       └── ⇢ [[docs/prd/资产管理工作台/资产版本与问题跟踪/资产版本保存|资产版本保存]]\
                             └── 公共能力区：[[docs/prd/资产管理工作台/公共支撑能力|公共支撑能力]] [M] ←── {R9 按框架模型匹配并隔离本机信息}\
                                 ├── [[docs/prd/资产管理工作台/公共支撑能力/框架模型配置匹配|框架模型配置匹配]] [M] ●\
                                 ├── [[docs/prd/资产管理工作台/公共支撑能力/本机私有信息隔离|本机私有信息隔离]] [M] ●\
                                 └── [[docs/prd/资产管理工作台/公共支撑能力/同步前私有历史检查|同步前私有历史检查]] [M] ●\

图例：`[C]` 概念；`[M]` 机制；`●` 原子节点；`⇢` 引用；`公共能力区`表示被多个分支复用的机制。节点名称唯一，每个 双中括号文档引用 都对应一份节点文档。

复用节点时，同时遵循其子能力和必要引用的规则；按具体操作选择适用的依赖，不将可选能力误当作所有操作的强制前提。图中没有省略待展开节点。

## 完整骨架图节点的实现顺序推荐

项目已实现；此处是重新构建或理解产品依赖时的推荐顺序，不是待开发清单。采用 bottom-up：优先公共与高复用能力，被引用节点先于使用者；全部子能力完成后回归父功能包，最后完成工作台整体。父节点和原子节点均参与排列，共 45 个节点。

1. [[docs/prd/资产管理工作台/公共支撑能力/本机私有信息隔离|本机私有信息隔离]] [M] ●
2. [[docs/prd/资产管理工作台/公共支撑能力/框架模型配置匹配|框架模型配置匹配]] [M] ●
3. [[docs/prd/资产管理工作台/公共支撑能力/同步前私有历史检查|同步前私有历史检查]] [M] ●
4. [[docs/prd/资产管理工作台/公共支撑能力|公共支撑能力]] [M]
5. [[docs/prd/资产管理工作台/Plugins包管理/Plugin来源接入与资料|Plugin来源接入与资料]] [C] ●
6. [[docs/prd/资产管理工作台/Plugins包管理/Plugin分支与推送|Plugin分支与推送]] [C] ●
7. [[docs/prd/资产管理工作台/资产版本与问题跟踪/问题记录与版本关联|问题记录与版本关联]] [C] ●
8. [[docs/prd/资产管理工作台/资产版本与问题跟踪/资产版本保存|资产版本保存]] [C] ●
9. [[docs/prd/资产管理工作台/资产创作与组合/Skill内容与资源编辑|Skill内容与资源编辑]] [C] ●
10. [[docs/prd/资产管理工作台/事件自动化管理/命令Hook编辑|命令Hook编辑]] [C] ●
11. [[docs/prd/资产管理工作台/项目资产接入/项目登记与本机路径|项目登记与本机路径]] [C] ●
12. [[docs/prd/资产管理工作台/资产创作与组合/分层提示词管理|分层提示词管理]] [C] ●
13. [[docs/prd/资产管理工作台/资产创作与组合/Claude规则编辑|Claude规则编辑]] [C] ●
14. [[docs/prd/资产管理工作台/资产创作与组合/Skills套件组合|Skills套件组合]] [C] ●
15. [[docs/prd/资产管理工作台/事件自动化管理/Hooks分组组合|Hooks分组组合]] [C] ●
16. [[docs/prd/资产管理工作台/模型辅助迭代/模型服务配置|模型服务配置]] [C] ●
17. [[docs/prd/资产管理工作台/资产创作与组合/Skill本地导入|Skill本地导入]] [C] ●
18. [[docs/prd/资产管理工作台/资产创作与组合/Agent配置组合|Agent配置组合]] [C] ●
19. [[docs/prd/资产管理工作台/项目配置生效/生效资产选择与展开|生效资产选择与展开]] [C] ●
20. [[docs/prd/资产管理工作台/项目配置生效/已管配置更新与保护|已管配置更新与保护]] [M] ●
21. [[docs/prd/资产管理工作台/项目配置生效/配置预览与确认写入|配置预览与确认写入]] [C] ●
22. [[docs/prd/资产管理工作台/资产库远程同步/GitHub资产库连接|GitHub资产库连接]] [C] ●
23. [[docs/prd/资产管理工作台/资产库远程同步/同步冲突逐项选择|同步冲突逐项选择]] [C] ●
24. [[docs/prd/资产管理工作台/Plugins包管理/Plugin版本与上游更新|Plugin版本与上游更新]] [C] ●
25. [[docs/prd/资产管理工作台/资产创作与组合/Claude规则导入|Claude规则导入]] [C] ●
26. [[docs/prd/资产管理工作台/资产创作与组合|资产创作与组合]] [C]
27. [[docs/prd/资产管理工作台/事件自动化管理/Hook模拟测试|Hook模拟测试]] [C] ●
28. [[docs/prd/资产管理工作台/事件自动化管理/原生Hook配置导入|原生Hook配置导入]] [C] ●
29. [[docs/prd/资产管理工作台/事件自动化管理|事件自动化管理]] [C]
30. [[docs/prd/资产管理工作台/项目资产接入/项目原生资产识别导入|项目原生资产识别导入]] [C] ●
31. [[docs/prd/资产管理工作台/项目资产接入/项目当前配置查看|项目当前配置查看]] [C] ●
32. [[docs/prd/资产管理工作台/项目资产接入|项目资产接入]] [C]
33. [[docs/prd/资产管理工作台/项目配置生效|项目配置生效]] [C]
34. [[docs/prd/资产管理工作台/资产版本与问题跟踪/资产历史选用与差异|资产历史选用与差异]] [C] ●
35. [[docs/prd/资产管理工作台/资产版本与问题跟踪/资产删除与恢复|资产删除与恢复]] [C] ●
36. [[docs/prd/资产管理工作台/资产版本与问题跟踪|资产版本与问题跟踪]] [C]
37. [[docs/prd/资产管理工作台/资产库远程同步/资产库一键同步|资产库一键同步]] [C] ●
38. [[docs/prd/资产管理工作台/资产库远程同步|资产库远程同步]] [C]
39. [[docs/prd/资产管理工作台/Plugins包管理/Plugin文件与资产快照|Plugin文件与资产快照]] [C] ●
40. [[docs/prd/资产管理工作台/Plugins包管理/Plugin自用分支融合与冲突|Plugin自用分支融合与冲突]] [C] ●
41. [[docs/prd/资产管理工作台/Plugins包管理|Plugins包管理]] [C]
42. [[docs/prd/资产管理工作台/模型辅助迭代/Skill模型审查|Skill模型审查]] [C] ●
43. [[docs/prd/资产管理工作台/模型辅助迭代/Skill问题驱动改进|Skill问题驱动改进]] [C] ●
44. [[docs/prd/资产管理工作台/模型辅助迭代|模型辅助迭代]] [C]
45. [[docs/prd/资产管理工作台|资产管理工作台]] [C]

## R10 增量骨架与实现顺序

{画板创作 Skill} → [[docs/prd/资产管理工作台/资产创作与组合/Skill可视化编排|Skill可视化编排]] [C]
- [[docs/prd/资产管理工作台/资产创作与组合/Skill可视化编排/画板结构与规则编辑|画板结构与规则编辑]] [C] ●
- [[docs/prd/资产管理工作台/资产创作与组合/Skill可视化编排/画板确定性文档生成|画板确定性文档生成]] [M] ●
- [[docs/prd/资产管理工作台/资产创作与组合/Skill可视化编排/画板提示管理|画板提示管理]] [C] ●
- [[docs/prd/资产管理工作台/资产创作与组合/Skill可视化编排/图文同步保存|图文同步保存]] [M] ●
- [[docs/prd/资产管理工作台/模型辅助迭代/Skill智能可视化转换|Skill智能可视化转换]] [C] ●
- [[docs/prd/资产管理工作台/模型辅助迭代/Skill文字变更同步画板|Skill文字变更同步画板]] [C] ●

其中前四项为 Skill可视化编排的直接子能力；后两项属于模型辅助迭代，由 Skill可视化编排引用。复用 Skill内容与资源编辑、资产版本保存、框架模型配置匹配和模型服务配置。

Bottom-up 顺序：画板确定性文档生成 → 画板提示管理 → 画板结构与规则编辑 → Skill智能可视化转换 → Skill文字变更同步画板 → 图文同步保存 → Skill可视化编排 → 资产创作与组合／模型辅助迭代 → 资产管理工作台。

## R11 多协议模型服务与目标软件自定义 API（已实现并完成连接验收）

来源：2026-10-20 用户要求模型配置支持任意协议 API，并补充同时支持 Claude Code 和 Codex 自定义 API，随后确认开始实现。设计参考 New API 的协议适配方式。

复用既有模型服务配置与项目配置生效，新增独立的模型 API 生效能力：

{配置多协议 API，并应用到 Claude Code / Codex}
- → [[docs/prd/资产管理工作台/模型辅助迭代/模型服务配置|模型服务配置]] [C]：扩展模型服务接入范围，供助手内的模型辅助功能复用。
- → [[docs/prd/资产管理工作台/项目配置生效|项目配置生效]] [C]：支持将模型连接配置应用为 Claude Code 或 Codex 的自定义 API，包含目标软件实际使用的服务地址、模型与认证配置。
  - [[docs/prd/资产管理工作台/项目配置生效/模型API配置生效|模型API配置生效]] [C] ●

所选模型服务用于资产内容匹配，与目标软件实际使用该模型 API 是两个独立操作；API 配置从模型服务编辑页的「应用 / 撤销用户级 API」入口生效。

首期支持 Anthropic Messages、OpenAI Chat Completions、OpenAI Responses、Gemini generateContent 四种文本协议。兼容服务复用对应协议；特殊协议可通过外部网关接入，不内置完整协议转换网关。Claude Code 使用 Messages 兼容端点，Codex 使用 Responses 兼容端点，两者均采用本机用户级配置。两个目标可分别指定网关地址并从供应商列表选择模型；复用同一 Key，凭据不同时另建服务。目标配置通过本机辅助程序获取密钥，不嵌入 Key。

Bottom-up 顺序：模型服务配置 → 模型API配置生效 → 项目配置生效／模型辅助迭代 → 资产管理工作台。

验收：全套 42 项本地自动化测试通过，包含协议映射、HTTP 文本调用、密钥隔离与目标配置的预览／应用／撤销；浏览器操作及本机 Codex 严格配置加载已验证。经用户授权选择可用模型后，gpt-6.1-sol 在用户提供的 Responses 服务上完成助手文本测试、使用生成配置的真实 Codex 会话，以及模拟函数工具调用和结果回传。验收使用独立的 Codex 配置目录，凭据及脱敏日志仅保存在本机私有目录。补充的本机 shell 文件读取被 Codex 执行策略拒绝，不将该项记录为工具执行成功；服务的非标准模型目录会产生刷新告警，但不影响已验证的指定模型会话。其他模型与软件能力仍取决于所配置服务的兼容程度。

调研来源：[New API](https://github.com/QuantumNous/new-api)、[Codex 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)、[Claude Code 网关配置](https://code.claude.com/docs/en/llm-gateway)。

## R12 用户级 API 与供应商多模型（已实现）

2026-10-20 用户确认：Claude Code 与 Codex 的自定义 API 均只在本机用户级应用，不提供新建项目级配置。一个供应商维护共享地址、协议、密钥和模型 ID 列表；列表支持获取与手工编辑。供应商另指定资产 AI 辅助模型，供审查、改进、画板等内部功能使用。应用到外部软件时从该供应商列表选择模型，不改变 AI 辅助模型。

复用 [[docs/prd/资产管理工作台/模型辅助迭代/模型服务配置|模型服务配置]] 和 [[docs/prd/资产管理工作台/项目配置生效/模型API配置生效|模型API配置生效]]，不新增重复供应商身份。旧单模型服务按单元素列表兼容，保留服务 ID 和资产组合引用；不把外部软件本次所选模型替换为资产组合标识。旧版由助手管理的项目 API 覆盖，在用户级应用预览中列出恢复计划并经确认清理，已改动的受管字段按 R14 规则恢复。

交付顺序：供应商模型列表与 AI 辅助选择 → 用户级应用及旧覆盖恢复 → 界面与全链路验证。

验收：全套 50 项自动化测试通过，并已核对浏览器中的模型列表、AI 选择及无项目选择的用户级应用界面。使用用户提供的供应商实际获取 7 个可见模型；资产 AI 辅助选择 gpt-6.1-sol，外部 Codex 独立选择 gpt-6-luna，文本测试和真实 Codex 会话均成功。验收使用独立用户配置目录，未覆盖日常使用的用户配置。

## 当前实现边界

### R13 应用时配置模型映射与选择目录（已实现，2026-10-21）

复用「模型API配置生效」：用户点击应用时配置目标软件模型列表、显示名称和默认模型。Claude Code 可为 Sonnet、Opus、Haiku、Fable 与子任务分别选择供应商模型，并可填写特定 Claude 版本的映射；支持的版本写入完整选择列表。Codex 使用真实供应商 ID 建立模型目录，用户确认上下文和推理能力，不隐式把 GPT 名称改成其他模型。应用前展示模型对应关系、全部文件变化及新会话／客户端版本限制；预览零写入，确认后连同目录事务写入，撤销恢复原值，保护无关配置与外部修改。桌面端旧聊天的已选模型不由配置写入自动改动。

验收：55 项测试全部通过（含显式启用原生客户端验收）。Codex 原生目录解析和 app-server model/list 返回 DeepSeek 两个真实 ID；本地模拟端点捕获 Codex 默认请求及 Claude Sonnet／Opus／Haiku 请求，均为配置的供应商 ID。真实 AI2RobCoWork 服务在新目录下以 gpt-6-luna 完成会话并返回 MAPPING_LIVE_OK。浏览器核对了两端应用表单及映射预览。Claude Code 本机为 2.1.197，已验证别名映射；完整自定义 picker 需 2.1.242+，未声称已在旧版或桌面原生界面验证完整列表。

| 范围 | 当前行为 |
| --- | --- |
| 面向用户 | 本地网页应用，可从局域网访问；没有账号、角色权限和多租户隔离 |
| 软件支持 | Claude Code、Codex；Rules 仅 Claude，Hook 事件受已支持清单限制 |
| 模型调用 | 四种已支持协议的文本模型；服务商特殊协议通过外部兼容网关接入 |
| 软件模型配置 | Claude Code、Codex 均为用户级；从供应商列表独立选模型，预览确认，可撤销 |
| 保存与生效 | 保存记录版本；生效是另一次预览确认操作；指令写入会覆盖全文 |
| 历史使用 | 在本机使用旧版本不提交、不自动重新部署；Plugin 恢复历史会创建提交 |
| 数据共享 | 全库资产与历史可同步，本机信息不同步；Plugin 独立仓库另行更新推送 |
| 命令脚本 | 普通保存/导入不执行，Hook 模拟测试真实执行；自动事件由目标软件调度 |
| 一致性限制 | 当前未提供跨项目配置文件写入失败时的整体回滚保证；失败后检查实际文件状态 |

## 代码证据索引

<details>
<summary>展开反推证据与既有测试入口</summary>

以下仅保留反推的导航依据，不定义技术设计。产品能力及其依赖以完整骨架和节点文档为准；既有测试入口不代表本次已重新运行全部功能测试。

| 能力节点 | 实现核对入口 |
| --- | --- |
| [Skill内容与资源编辑](prd/资产管理工作台/资产创作与组合/Skill内容与资源编辑.md) | server.mjs: validateSkill/renderSkill/validateAsset；public/app.js: renderSkillForm/bindResources |
| [Skill本地导入](prd/资产管理工作台/资产创作与组合/Skill本地导入.md) | server.mjs: parseImportedSkill；public/app.js: importLocalSkillDirectory/importExistingSkill |
| [Skills套件组合](prd/资产管理工作台/资产创作与组合/Skills套件组合.md) | server.mjs: validateAsset/suiteMembers/makeDeployment；public/app.js: renderWorkflowForm |
| [分层提示词管理](prd/资产管理工作台/资产创作与组合/分层提示词管理.md) | server.mjs: composedPrompt/validateAsset；public/app.js: renderPromptForm |
| [Agent配置组合](prd/资产管理工作台/资产创作与组合/Agent配置组合.md) | server.mjs: validateAsset/makeDeployment；public/app.js: renderAgentForm |
| [Claude规则编辑](prd/资产管理工作台/资产创作与组合/Claude规则编辑.md) | rules.mjs: validateRule/renderRule；public/app.js: renderRuleForm |
| [Claude规则导入](prd/资产管理工作台/资产创作与组合/Claude规则导入.md) | rules.mjs: parseRule；public/app.js: importRules |
| [命令Hook编辑](prd/资产管理工作台/事件自动化管理/命令Hook编辑.md) | hooks.mjs: validateHook；public/app.js: renderHookForm/bindHook |
| [Hook模拟测试](prd/资产管理工作台/事件自动化管理/Hook模拟测试.md) | hooks.mjs: testHook |
| [Hooks分组组合](prd/资产管理工作台/事件自动化管理/Hooks分组组合.md) | server.mjs: validateAsset/makeDeployment；public/app.js: renderHookGroupForm |
| [原生Hook配置导入](prd/资产管理工作台/事件自动化管理/原生Hook配置导入.md) | hook-import.mjs: parseHookConfiguration；public/app.js: importHookFiles/reviewProjectAssets |
| [项目登记与本机路径](prd/资产管理工作台/项目资产接入/项目登记与本机路径.md) | server.mjs: validateAsset/setProjectPath/assertProject；public/app.js: renderProjectForm/bindProject |
| [项目原生资产识别导入](prd/资产管理工作台/项目资产接入/项目原生资产识别导入.md) | project-import.mjs: scanProjectAssets；server.mjs: discoverProject/handleApi；public/app.js: reviewProjectAssets |
| [项目当前配置查看](prd/资产管理工作台/项目资产接入/项目当前配置查看.md) | server.mjs: projectConfiguration；public/app.js: loadProjectConfiguration |
| [生效资产选择与展开](prd/资产管理工作台/项目配置生效/生效资产选择与展开.md) | server.mjs: makeDeployment；public/app.js: renderDeploy/updateDeployAvailability |
| [配置预览与确认写入](prd/资产管理工作台/项目配置生效/配置预览与确认写入.md) | server.mjs: makeDeployment/handleApi；public/app.js: previewDeploy |
| [已管配置更新与保护](prd/资产管理工作台/项目配置生效/已管配置更新与保护.md) | server.mjs: makeDeployment；hooks.mjs: mergeHookGroups/assertHookDestination |
| [资产版本保存](prd/资产管理工作台/资产版本与问题跟踪/资产版本保存.md) | server.mjs: save/requireMessage/validateAsset；public/app.js: saveCurrent/askVersionMessage |
| [资产历史选用与差异](prd/资产管理工作台/资产版本与问题跟踪/资产历史选用与差异.md) | server.mjs: history/diff/selectVersion；public/app.js: showHistory；version-diff.mjs: assetFiles/compareFiles |
| [资产删除与恢复](prd/资产管理工作台/资产版本与问题跟踪/资产删除与恢复.md) | server.mjs: remove/trash/restore；public/app.js: deleteCurrent/showTrash |
| [问题记录与版本关联](prd/资产管理工作台/资产版本与问题跟踪/问题记录与版本关联.md) | server.mjs: assetIssues/updateAssetIssue/selectedCompletedIssues/save；public/app.js: bindAssetIssues/askVersionMessage |
| [GitHub资产库连接](prd/资产管理工作台/资产库远程同步/GitHub资产库连接.md) | server.mjs: validateRemoteUrl/connectRemote/syncStatus |
| [资产库一键同步](prd/资产管理工作台/资产库远程同步/资产库一键同步.md) | server.mjs: syncRemote/finishMerge |
| [同步冲突逐项选择](prd/资产管理工作台/资产库远程同步/同步冲突逐项选择.md) | server.mjs: conflictItems/resolveConflicts/assertNoMerge；public/app.js: renderSync |
| [Plugin来源接入与资料](prd/资产管理工作台/Plugins包管理/Plugin来源接入与资料.md) | plugins.mjs: createPluginStore/create/metadata；public/plugins.js: pluginUI |
| [Plugin文件与资产快照](prd/资产管理工作台/Plugins包管理/Plugin文件与资产快照.md) | plugins.mjs: writeFiles/action；server.mjs: handleApi/plugins assets/add-asset |
| [Plugin版本与上游更新](prd/资产管理工作台/Plugins包管理/Plugin版本与上游更新.md) | plugins.mjs: check/status/action(update/diff/restore)；version-diff.mjs: repositoryComparison |
| [Plugin分支与推送](prd/资产管理工作台/Plugins包管理/Plugin分支与推送.md) | plugins.mjs: writable/clean/action(branch/remote/push)；test/plugins.test.mjs |
| [Plugin自用分支融合与冲突](prd/资产管理工作台/Plugins包管理/Plugin自用分支融合与冲突.md) | plugins.mjs: action(rebase/resolve/continue/abort)；test/plugins.test.mjs |
| [模型服务配置](prd/资产管理工作台/模型辅助迭代/模型服务配置.md) | server.mjs: validateAsset/save/callModel；public/app.js: renderModelForm |
| [Skill模型审查](prd/资产管理工作台/模型辅助迭代/Skill模型审查.md) | server.mjs: handleApi/ai review/callModel；public/app.js: aiDialog/renderSettings |
| [Skill问题驱动改进](prd/资产管理工作台/模型辅助迭代/Skill问题驱动改进.md) | server.mjs: handleApi/ai improve；public/app.js: aiDialog |
| [框架模型配置匹配](prd/资产管理工作台/公共支撑能力/框架模型配置匹配.md) | server.mjs: profiledTypes/profileSnapshot/forProfile/save；test/profiles.test.mjs |
| [本机私有信息隔离](prd/资产管理工作台/公共支撑能力/本机私有信息隔离.md) | server.mjs: ensureData/migrateLocalSettings/localize/save/selectVersion；README.md |
| [同步前私有历史检查](prd/资产管理工作台/公共支撑能力/同步前私有历史检查.md) | server.mjs: auditPrivateHistory/connectRemote/syncRemote |

测试覆盖参考：[资产主流程](../test/smoke.test.mjs)、[框架模型组合](../test/profiles.test.mjs)、[Rules](../test/rules.test.mjs)、[Hooks](../test/hooks.test.mjs)、[Hooks组](../test/hook-groups.test.mjs)、[Hooks导入](../test/hook-import.test.mjs)、[项目导入](../test/project-import.test.mjs)、[问题记录](../test/issues.test.mjs)、[全库同步](../test/sync.test.mjs)、[Plugins](../test/plugins.test.mjs)、[版本差异](../test/version-diff.test.mjs)。

</details>

## R14 模型 API 受管字段覆盖（2026-10-21，已实现）

用户明确要求：模型 API 应用确认后以助手本次设置覆盖受管字段，不因这些字段曾被手动或客户端修改而阻止；其他字段保留，包括同一个供应商、模型选择器对象中的额外设置。撤销覆盖这些受管字段，恢复首次应用前的原值。旧版整表管理记录兼容为字段管理。生成模型目录可按预览重建；仅预览之后发生的变更要求重新预览，以避免确认内容过期。本规则只影响模型 API，不改变 Hooks／Rules 等资产的保护策略。

验收：57 项测试通过，含已安装客户端验收；新增同表非受管字段保留、旧管理记录兼容，覆盖受管字段外部编辑、撤销原值及预览后变更拒绝均通过。

## 维护规则

- 修改产品行为时，先更新受影响节点的规则、流程、边界与验收条件，再同步总骨架及引用。
- 新增节点先检查现有能力能否直接满足、组合满足或扩展；新增后保持名称唯一及文件层级一致。
- 技术接口、数据结构与模块职责留给 Architecture/TDD；本次仅补齐 PRD，不反向虚构其他层文档。
