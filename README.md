# 榕树之心 · Web Edition

`Core of Banyan` 的浏览器端复刻。采用 TypeScript 与 Canvas 2D：地图和单位只在单个渲染循环中绘制，游戏规则则使用固定 30Hz 更新，因此大地图下也不会因 DOM 节点数量增长而卡顿。

## 本地运行

```bash
npm install
npm run dev
```

构建生产包：

```bash
npm run build
```

## 已复刻内容

- 六边形网格、可连通障碍物、根结点与枝干连接。
- 占领、不能形成回路、创造力、结点坚固性、断根衰减、玩家对抗与胜负。
- 果实、害虫、落叶归根、固若金汤，以及简单/困难人机。
- 开始页、自定义对局、设置、教程入口、说明、暂停与移动端六方向操作。

默认玩家 1 使用 `W/A/S/D/Q/E` 六方向移动、`1` 回城、`2` 加固；玩家 2 使用方向键和 `,` / `.`。

贴图、字体及音效来自原 Unity 项目的 `Assets/Resources`，网页实现位于 `src/engine.ts`（规则）和 `src/main.ts`（Canvas/UI）。
