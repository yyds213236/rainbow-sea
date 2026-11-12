# 彩虹海

彩虹海是一座可以自由航行的 3D 宇宙图鉴。以地球夜景为起点，穿越太阳系，探访银河和遥远的星系。

[打开彩虹海](https://yyds213236.github.io/rainbow-sea/)

## 漫游

- 拖动旋转视角，滚轮或双指捏合缩放。点击天体标记或底部的目的地即可飞往对应天体。
- 搜索中文名、英文名或编号，可以跨星系查找。方向键选取结果，回车前往。
- 在近地轨道查看昼夜交界线、城市灯光与国际空间站，也可以进入「感知地球」查看天气与地球事件图层。
- 空格暂停与继续，`H` 返回地球，`F` 全屏，`I` 进入或退出屏幕模式，`Esc` 恢复界面。
- 手机上点底部「详情」或「探索与控制」打开相应控件。

天体的尺寸、距离、运动速度与星系结构经过可视化处理。示意与候选天体在详情中标明，观测图层随各数据源更新。

## 本地运行

项目使用 Three.js。安装 Node.js 和 Python 3 后，在仓库目录运行以下命令，然后打开终端显示的本地地址 `http://127.0.0.1:8767/`。

```sh
npm ci
npm start
```

修改 `src/` 后运行 `npm test` 检查回归，再运行 `npm run build` 更新 `index.html`。网站使用相对资源路径，可通过 GitHub Pages 的分支发布提供静态服务。

若需单文件预览，运行 `npm run build -- --offline`，双击打开 `out/彩虹海.html`。三维漫游可离线使用，地球观测数据需要联网。

## 代码与素材

彩虹海衍生自 [ORBIT](https://github.com/ryh842487118-bot/orbit)。修改涉及界面、导航与交互、资源交付和运行性能。ORBIT 的原始代码和文档采用 [Apache 2.0](LICENSE) 许可，原项目署名见 [NOTICE](NOTICE)。

- 行星及地球贴图来自 [Solar System Scope](https://www.solarsystemscope.com/textures/)，按 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 使用，并在渲染时添加光照与着色。完整说明见 [素材署名](assets/CREDITS.md)。
- Three.js 使用 [MIT 许可证](assets/THREE-LICENSE.txt)。
- 地球观测数据与模型出处见 [数据来源](docs/data-sources.md)。
