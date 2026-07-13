# Web 复刻核对表

此表以原项目的 Unity 脚本、场景和 `Assets/Resources` 为依据，记录网页端对应实现与验证方式。

| 原项目范围 | 网页端实现 | 验证证据 |
| --- | --- | --- |
| 六边形地图、可连通障碍物、出生点 | `BanyanGame.reset`、`placeWalls`、`homes` | `tests/engine.test.ts`、最大地图 631 格断言 |
| 枝干连接、禁止成环、占领、玩家冲突、根被攻占 | `BanyanGame.move`、`capture`、`eliminate` | 规则回归测试 |
| 创造力、坚固性、断根衰减、强制回城、加固 | `tick`、`forceHome`、`reinforce` | 规则回归测试 |
| 果实、害虫、寿命/闪烁、害虫覆盖果实 | `spawnEntities`、`resolveTile`、Canvas 绘制 | 规则回归测试 |
| 简单/困难机器人 | `runBots`、`botDirections` | 最大地图模拟 |
| 开始、自定义、设置、暂停、帮助、结束界面 | `src/main.ts` | 浏览器交互检查、生产构建 |
| 虚拟摇杆、独立六方向键、触控拖拽 | `bindGameInputs`、设置页 | 构建检查 |
| 四关新手教程 | `src/tutorial.ts` | 第四关端到端测试 |
| 原始地图、角色、果实、害虫、字体、音效 | `public/assets`、Canvas 绘制 | 浏览器截图检查 |

## 性能边界

规则引擎以固定 30Hz 更新；单位、地图和效果绘制在单一 Canvas 中，避免为每个格子创建 DOM 节点。`npm test` 会执行 631 格地图、10 秒模拟的性能基准。

## 视觉核对边界

原仓库未提供 Release、WebGL 构建或官方截图，且工作区没有 Unity 编辑器可执行文件。因此网页端的视觉对齐以原场景中的文案、Prefab 布局、字体和原始贴图为依据；已完成浏览器截图检查，但无法对不存在的官方运行截图做像素级差分。
