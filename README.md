# 炸弹人 · FC 经典版

<https://bomberman.shangganmieya.com>

运行完整 FC / NES 初代游戏，保留原版像素画面、角色、音乐、关卡、道具和密码系统。游戏图像由公开的 [emu-russia/bomberman-nes](https://github.com/emu-russia/bomberman-nes) 反汇编源码重建；网页内核使用 [JSNES 2.1.0](https://github.com/bfirsh/jsnes)。原游戏完整 50 关及奖励关没有通过手工补写关卡模拟。

- 手机、平板、电脑、横竖屏及支持分区 API 的折叠屏布局。
- 定制像素界面、像素字体、阶梯按钮边框、方向图标和按压反馈。字体使用 OFL-1.1 的 Fusion Pixel Font 简体中文子集，只有约 11 KiB，资源同源托管。
- 独立首页使用原版标题和精灵图形；操作区与游戏画面各自排版，存档提示不会覆盖原版菜单。正文与操作提示优先保证易读性，像素字体用于标题、按钮和按键。
- 多点触控十字键，滑动转向，极短点击也不会漏采样；键盘与标准手柄输入。
- 每次屏幕刷新绘制，游戏保持原版 60Hz 逻辑；支持 90 / 120 / 144Hz 屏幕而不改变游戏速度。NES 原版动作本身仍为 60Hz。
- 自动保存完整运行状态，地图、位置、敌人、道具、生命、声音状态和炸弹剩余计时一并恢复。每两秒、暂停及离开页面时保存；支持手动保存。采用带校验的压缩存档与 IndexedDB 原子事务，每台设备只保留一份当前游戏存档，没有备份副本。
- 微信准备页至少显示 3 秒，且原版资源加载、校验与内核准备完成后才进入游戏。图片、内核和游戏文件全部同源，不依赖 CDN。
- 全屏按钮常驻，进入后改为退出全屏；不支持原生全屏时使用可退出的沉浸布局。暂停菜单有继续、保存、设置、全屏及返回菜单。
- 音量、触控按钮大小、震动反馈、高刷显示开关；后台或失焦自动暂停。触控区禁用缩放，并阻止双击和手势缩放。

## 操作

| 操作 | 键盘 | 触屏 / 标准手柄 |
| --- | --- | --- |
| 移动 | 方向键 / WASD | 十字键 / 左摇杆 |
| 放炸弹 | Z / 空格 | A |
| 遥控引爆 | X | B，需要遥控道具 |
| 暂停 | P / Esc | 顶部暂停 / 手柄 Start |
| 确认原版菜单 | Enter | START |
| 切换原版菜单 | Shift | SELECT |

## 开发

Node.js 20+，运行和构建无需安装生产依赖。

```sh
npm run dev
npm test
npm run build
node scripts/contrast.mjs
```

开发地址 `http://127.0.0.1:50827`，可以通过 `BOMBERMAN_PORT` 改端口。`npm run test:browser` 使用 Playwright 验收；可安装测试依赖 `playwright`，或通过 `BOMBERMAN_PLAYWRIGHT_PATH` 指向已有的包目录。验证截图及报告位于被 Git 忽略的 `verification/`。

`node tests/visual.cjs` 会检查桌面、宽屏、手机、窄屏手机、横屏手机和平板的新游戏及存档首页，验证标题、卡片和主按钮不被裁切。`scripts/contrast.mjs` 验证关键文字至少达到 4.5:1 对比度。`scripts/generate-art.mjs` 从原版像素数据导出标题与精灵 SVG；`scripts/subset_font.py` 可重建像素字体子集。

`npm run build:rom` 使用 Python 3 从仓库内的反汇编源码重建游戏，强制检查原版 PRG CRC32 `A913A222`、CHR CRC32 `1DB14E97` 和完整图像 SHA-256 `4e57f08754a2ff7ec788245629fb70f99d4e003f66f86742566bca99c810a244`。JSNES 发布包与 npm 官方 SHA-512 完整性值一致。

JSNES 使用 Apache-2.0 许可证，见 `vendor/jsnes/LICENSE`；原版游戏及其素材版权属于原权利人。第三方内核和游戏源码的来源、校验信息见 `vendor/SOURCES.json`。页面不使用原重绘项目的代码、素材或署名。

## 部署

只使用 Cloudflare Pages 的静态资源托管，无 Pages Functions、Cloudflare Worker、Service Worker 或浏览器 Worker。`dist/` 为公开文件白名单；不包含 Git、测试、源游戏汇编、工具或验证截图。

```sh
npm run build
wrangler pages deploy dist --project-name bomberman --branch main
```

`build-meta.json` 用于核对线上版本与公开文件哈希。生产域名只绑定 `bomberman.shangganmieya.com`。

浏览器模拟测试覆盖布局、交互和微信 UA，但不能替代所有手机型号的微信真机测试。原生全屏与震动取决于浏览器支持。存档仅在当前浏览器；清除网站数据、使用另一个浏览器或设备后不会同步存档。浏览器在关闭前直接终止进程时，会恢复最后一次成功保存的状态。
