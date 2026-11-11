# MapCanvas 0.1.0 验收记录

2026-11-11，使用既有本地 Aide（localhost:9999）和其当前 Docker 服务完成；未另启 Aide 实例。原 ros-map-editor 0.4.7 保留，本版 mapcanvas 0.1.0 独立安装并启用。

## 安装包身份

- ZIP：mapcanvas-0.1.0.zip，15,326 字节。
- SHA-256：7fe1dc086c1168f7cadb6260f99f747e05b1233b5ce3f475d1acfcbb02fdd779。
- 当前实例通过真实插件 bundle 接口安装了该 ZIP，原生 Aide 插件列表显示栅图 MapCanvas v0.1.0 已启用。

## 已执行与通过

- `npm test`：7 项实际页面/入口回归，含 P2/P5/16 位往返、数值溢出、畸形栅格、YAML/路径、导出 ZIP CRC/内容、工具身份、只读过滤和分块读取摘要。
- 宿主 Map/Document/Workbench/Market 聚焦 Go 回归通过；校验导入版本、只读绑定、越界/隐藏来源、重放和待保存草稿冲突。
- 原生 Aide 中打开工作台，加载来源；导入合成 YAML＋PGM（32×24，0.05 m/px，origin [0,0,0]）；画墙、撤销及重做状态正常。
- 点插件软盘仅准备草稿；磁盘 PGM 摘要仍为 8d10f2f6cd2fe13001f1da69eb63732e76e19f0a114bcd0ca7c4a16b44bae10d。点宿主“保存到原文件”后摘要变为 d0fdf788ff403f17ead4249c378794c7638d770ea796fbf86c417928806d80bb，YAML 与 posegraph 摘要未变。
- 导出 ZIP 经宿主原生保存面板下载并读回：CRC 全部通过，包含 map_edited.yaml、map_edited.pgm，PGM 与保存后的原图摘要一致。
- 临时只读来源真实导入成功，可画墙和生成导出；原图保存明确提示“来源只读，请导出ZIP另存”，没有生成原图写入。测试后移除此临时来源，保留既有来源配置。
- PNG 真实导入、画墙、宿主确认保存通过；读回保持 PNG 格式和32×24尺寸，图片摘要变化，配套 YAML 未变。
- 只使用独立缓存中的合成地图，不修改用户原地图。测试工作台已关闭。

## 未执行

未完成 Windows/Linux 原生主机、全部主题/窄屏组合、外部机器人或硬件验收；平台标签表示安装目标。未声称整个 Aide 发布矩阵或硬件通过。该插件无需连接机器人。

源码推送、插件 Release 和市场校验状态见对应仓库 Release 与 Aide 集中 Issue #841；构建、安装、界面验收和发布为不同步骤。
