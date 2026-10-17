# RPGJS 引擎与素材来源

本课把学生的角色移动、地图碰撞、近距离事件和对话放入真实 RPGJS 世界。课堂身份、学习记录、去重积分和教师大屏由原课堂服务管理。引擎运行在同源 `/rpgjs/` 入口，不需要学生另开账号。

## 上游与固定版本

参考项目为 [rpgjs/starter](https://github.com/rpgjs/starter)，取样提交固定为 `bc5be54ecba24d0ebca1b7dae423d8b6dad286b8`。参考目标是项目结构和引擎接入方式。

为避免 starter 当前混用版本的依赖冲突，本实现把 `@rpgjs/client`、`@rpgjs/common`、`@rpgjs/server`、`@rpgjs/tiledmap`、`@rpgjs/ui-css`、`@rpgjs/vite` 和 `@rpgjs/vue` 全部固定为 **5.0.0**。其余依赖精确版本保存在 `engine/package.json` 和 `engine/package-lock.json`。这是版本固定的本课实现，不代表上游最新版本。

RPGJS 的 MIT 原文保存在 [engine/LICENSE-RPGJS](../engine/LICENSE-RPGJS)。该文件标明上游版权和许可，不能据此推断教材、班级名单或项目其他内容也获得了相同许可。

## 本课实际使用的素材

- `public/assets/park-map.png` 与 `park-map.webp`：此前为本课实际生成的公园场景。三个园区设备任务复用这张场景，并通过不同的 NPC、设备和地图出生点组织活动。
- `public/assets/crossing-map.png` 与 `crossing-map.webp`：此前为本课实际生成的园区道路场景。
- `public/assets/characters.png` 与 `characters.webp`：此前为本课实际生成的人物图集。RPGJS 使用其中四个朝向的学生调试员，以及服务人员、维修员、安全员、园艺员和机器人。
- `engine/src/tiled/images/overpass.png`：本实现用矢量图形构建的教学设施对象，叠加于有天桥的地图。
- 风扇、温度传感器、控制终端、验收屏、电池和下一站入口：本实现的矢量设备图形，打包到 `engine/public/spritesheets/`。

地图、人物和设施均用于教学仿真；温度、电量及设施状态采用任务设定，不是某个真实深圳场所的实时数据。AI 场景原画没有包含可供执行的规则，实际分支和学习证据由程序任务与课堂服务产生。

**没有保留或公开 starter 的 Pipoya 地图图块、默认 `hero.png`、`female.png` 或示例地图。** 上游资源的许可不能自动扩展到本课公开仓库；这里仅使用本课已有的生成图和程序绘制对象。

## 人物图集与打包约定

`engine/public/spritesheets/` 中每张图为 **216×416 像素**，即 3 列×4 行、每帧 72×104。注册文件为 `engine/src/modules/lesson/sprites.ts`，采用 RPGJS `Presets.RMSpritesheet(3, 4)`：四行依次为下、左、右、上，中间列为站立帧。

调试员使用四个独立朝向图。向下行走还使用原图中的迈步姿态和镜像迈步帧；其他朝向保留原姿态并用轻微上下位移表达移动节奏。NPC 使用已有正面姿态，不声称每位 NPC 都拥有新生成的完整四向行走动画。

原始图集 `characters.png` 的裁切矩形，以左上角为原点，单位为像素：

| 角色／姿态 | x | y | 宽 | 高 |
| --- | ---: | ---: | ---: | ---: |
| 调试员向下 | 115 | 10 | 160 | 328 |
| 调试员向左 | 466 | 10 | 173 | 329 |
| 调试员向右 | 815 | 10 | 172 | 328 |
| 调试员向上 | 1184 | 11 | 159 | 328 |
| 调试员向下迈步 | 1892 | 356 | 190 | 355 |
| 服务人员 | 126 | 343 | 136 | 369 |
| 维修员 | 450 | 349 | 211 | 369 |
| 安全员 | 807 | 343 | 225 | 372 |
| 园艺员 | 1161 | 347 | 207 | 366 |
| 机器人 | 1506 | 444 | 228 | 257 |

注册图形 ID 为 `engineer`、`staff`、`mechanic`、`warden`、`gardener`、`robot`、`fan-on`、`fan-off`、`sensor`、`control`、`monitor`、`battery-a`、`battery-b`、`portal`。

重新打包可运行 `scripts/build-rpg-assets.cjs`，需要 Node.js 与可用的 `sharp` 包。普通教师启动课堂服务不需要重新打包；打包后的素材已经放在引擎资源目录中。脚本仅删除明确列出的新引入 starter 示例资源，不清理教师原始图片或其他目录。

## 五张地图、事件与物理

地图均为 **1536×1024 像素、48×32 格、每格 32×32 像素**：

| 地图 ID | 课堂任务 | 场景与通行情况 |
| --- | --- | --- |
| `greenhouse` | 温室通风 | 园区西侧设备区 |
| `workshop` | 设备维修 | 园区维修工坊附近 |
| `crossing` | 安全通行 | 无天桥，封闭天桥所在通道 |
| `crossing-east` | 安全通行 | 有天桥，开放天桥所在通道 |
| `energy` | 节能配电 | 园区能源设备区 |

`engine/src/tiled/layout.json` 是 NPC、设备、出生点和下一站入口的位置来源，任务事件直接引用这些坐标，避免出现画面一套位置、事件另一套位置。`start` 是 Tiled 出生点；`Lesson events` objectgroup 提供引擎的事件显示层。NPC 与设备的动作处理来自课内事件模块，必须由角色走到附近并交互触发。

背景使用普通 Tiled tilelayer：整张 own 场景图按 32 像素网格作为图集读取，原画内容保持连续。此做法还避开已实际观察到的 CanvasEngine 2.4.0 imagelayer 渲染问题：其 Sprite 参数中的图片字符串会被同一图层的 image 对象覆盖，导致 Pixi 报 `[object Object]`。

透明的 `collision.tsx` 图块使用 `collision=true`；地图 `Solid scenery` 层据此产生 RPGJS 物理障碍。图片中可见的树丛、主要建筑、中心花坛和道路禁行区由碰撞层限制，图片本身没有碰撞能力。道路地图只在两条走廊保留通道：天桥对应约 y=288…416，斑马线对应约 y=608…768；任务判断还使用各路线的安全范围。无桥地图确实封闭上方通道，不能把不存在的桥当作成功通行。

## 本次资源验证边界

已检查人物、设备的打包图；五张地图的全部命名站点经过格网连通检查；实际 Tiled parser 能读取地图和 tileset；引擎构建成功。实际 Chrome 首屏已显示公园底图和学生角色，原 imagelayer 黑底错误已经消失。NPC 触发、规则结果和学习记录仍须以主应用的完整浏览器验收为准，素材和构建存在本身不等于教学任务已经验证完成。
