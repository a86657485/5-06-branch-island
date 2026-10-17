# 第6课的 RPGJS 引擎模块

基于 [rpgjs/starter](https://github.com/rpgjs/starter) 的模块与 standalone 启动方式。当前核心包固定为兼容的5.0.0；上游来源、许可、资源边界见 [引擎与素材说明](../docs/RPGJS引擎与素材.md)。

从仓库根目录执行 `npm --prefix engine ci` 安装开发依赖，再用 `npm run check:engine` 与 `npm run build:engine` 检查及构建。输出直接进入 `public/rpgjs/`，由课堂服务同源提供。正式课堂启动不需要安装引擎开发依赖。

不要直接打开该子页面：须从学生主入口进入，父页面提供当前身份隔离的任务与证据桥接。每个浏览器运行独立世界，课堂服务负责学生记录汇总。

角色、背景来自本课已生成素材，设备图形与桥面为程序绘制。所有starter示例图片和地图已移除。不要在此目录添加真实名单、密钥或课堂数据库。
