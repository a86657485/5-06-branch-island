# Tablet Scenario Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** 华为平板移动减负、温室分散、手动交互与自动前往并存，并用情境剧情承载现有分支目标。

**Architecture:** 保留RPGJS与现有课堂桥接。呈现更新按实际变化去重；同一布局源的各投影保持一致；剧情与巡检手册分离，全部学习证据仍由原运行和验收接口产生。

**Tech Stack:** RPGJS5、Vue3、TypeScript、Node22、现有node:test与SQLite；不增依赖。

## 分工与顺序

- [x] 引擎代理：独占standalone.ts、player.ts、engine/index.html、engine/public/joystick.js及必要小helper；先用真实函数VM重现重复DOM/演员同步，再去重；最近可见48px对象动作只触发一次，面板/浮层/自动行走阻止移动。
- [x] 布局代理：独占生成器greenhouse坐标、layout.json、greenhouse-cast.ts、greenhouse.tmx、public/focus.mjs与click-path.ts；先测源一致、>=104px间距、24×24碰撞和对象间路线，再同步坐标与560,480中转。
- [x] 情境代理：核教材与蓝栏后回交短剧本和G/K/D；内容实施仅改patrol/learn-card/task-guidance与runtime/thermal/routes对白，不动规则与id。
- [x] 集成人：public/app.mjs剧情先行与手册按需、按幕显示1—2句、按钮文案和现有叙事存档；新剧情key避免旧阅读状态遮住新背景；读完/跳过不写达成。实现前测试首次站点剧情而非教材、关闭/重看保留方案、返回继续。
- [x] 集成人统一更新教学设计和协作简记；题库/规则/评分/门禁与基线核对。
- [x] 定向绿测后运行npm test、npm run check:engine、npm run build:engine；不并行重建public/rpgjs，核对摇杆和行走帧未回退。
- [x] 独立TS/JS与教学证据审查；实际浏览器平板尺寸和混合交互验收，记录L1—L6边界，更新PR与交付。

## 可验证接口与命令

引擎测试应连续调用原HUD渲染60次，断言首帧后节点身份保留、相同高亮不反复remove/add、单次布局读取<=1；演员测试五次相同context为0重复setter，换站/输出后更新一次。手动选择须以相同碰撞坐标计算距离，不能按屏幕像素或只按当前焦点隔空操作。

`node --experimental-strip-types --test tests/*tablet*.test.mjs tests/*manual*.test.mjs`（测试文件名由各唯一负责人回报）；`npm test`应0fail；`npm run check:engine`应退出0；`npm run build:engine`应退出0并复制当前TMX/摇杆/精灵。

真实浏览器只使用临时DATA_DIR和非8766端口：首次先看到温室问题→手动移动或自动前往→读输入→配置/预测→实际核验；脚印/焦点随相机移动；任何面板出现后摇杆停止。正式服务状态、数据位置和远端HEAD在交付前重新核查，不能沿用历史验收。
