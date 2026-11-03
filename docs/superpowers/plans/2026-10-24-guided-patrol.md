# Guided Patrol Implementation Plan

> **For agentic workers:** Use subagent-driven-development to implement assigned tasks and review shared interfaces before integration.

**Goal:** 四站短剧情、仅单击/拖拽的单线交互、撤回与全课5次答案法宝，保留原分支判断证据。

**Architecture:** 复用现有场景、桥接、draft与事件记录。共用任务引导函数供面板和服务端计算法宝；support作为兼容JSON扩展，额度服务端确认。各代理只改负责文件，主线程整合导航与桥接。

**Tech Stack:** RPGJS 5 / Vue / Node 22 SQLite / Node test runner.

## 1. 任务与法宝内容（内容代理）
- [x] 先新增tests/task-guidance.test.mjs，验证四站委托有目的与标准、返修未诊断先看故障、提示解释当前学生程序而非只给目标答案。
- [x] public/task-guidance.mjs 导出 stationBrief(levelId)、toolHint(levelId,draft,step)，后者返回{key,action,why}；step字段为phase/slot/temperature，来自当前可见步骤。
- [x] 改public/patrol.mjs四站短剧情，保留路线/解锁函数；通过上述测试。

## 2. 法宝持久化（后端代理）
- [x] tests/support.test.cjs先失败：5次跨站累计、重复hintKey去重、重启不恢复、不同学生/课次隔离。
- [x] server.cjs添加tool_hint事件，使用task-guidance计算答案，保存support.hints、level.hinted、兼容conceptHints；不改判分与开考函数。
- [x] public/sync.mjs合并支持记录；public/teacher.mjs已展开明细显示5次额度与当前站提示列表；通过行为测试。

## 3. 单步控制柜（界面代理）
- [x] tests/guided-panel.test.mjs先失败：一次选卡填当前槽、撤回仅最近选择、句子随配置生成、预测仍在运行前。
- [x] engine/src/gui/flow-model.ts增加选择/快照小函数；FlowPanel.vue改条件→是→否→同步句子→预测→现场运行；SentencePanel.vue保持可重看，点选和拖拽无需精确瞄准。
- [x] 右上固定法宝+撤回，使用request('toolHint',{step})，展示action/why；等待时禁用防双击；所有新界面可立即关闭。

## 4. 引导与集成（主线程）
- [x] tests/click-navigation.test.mjs先失败：储能读A后指B、接电池后才核验、路口预测/执行分步。
- [x] public/focus.mjs修当前一步；public/app.mjs、public/rpg-scene.mjs、engine/src/classroom-bridge.ts接toolHint/getSupport。
- [x] engine/src/standalone.ts、modules/lesson/player.ts复用现有运动路径处理一次点击导航与交互；路口连续触发原路线证据。
- [x] runtime.ts/thermal.ts/routes.ts改短委托、去并行菜单；普通选择可撤回，历史记录不删。

## 5. 验证交付
- [x] npm test；npm run build:engine；检查红线及素材地图diff为空。
- [x] 临时隔离服务用虚构名单走四站点击流，错误撤销及五次法宝耗尽，截图保留。
- [x] TypeScript专门审查与学习证据复核；修复后提交原分支、推PR #2。
- [x] 备份正式数据，更新本地服务；记录新提交及可访问入口，区分技术验证与真实课堂效果。
