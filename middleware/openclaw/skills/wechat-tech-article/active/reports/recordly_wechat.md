# 完全免费、无订阅！这款开源录屏工具让你录完即精品

> 跨平台、零剪辑、自动缩放——Recordly 把专业演示视频的门槛打到地板上

---

录屏这件事，其实有两道坎。

第一道：把画面录下来。第二道：让它看起来像样。

第二道坎才是大多数人耗时最多的地方——先用 OBS 录，再扔进剪映/PR 加缩放、调光标、贴背景、对齐时间线……一段两分钟的产品演示，剪辑时间轻松翻三倍。

有没有一个工具能跳过这个循环？

有。它叫 **Recordly**，完全免费、完全开源。

---

## 🏆 核心数据一眼看

| 项目 | 数据 |
|---|---|
| 当前版本 | v1.3.1 |
| 累计提交 | 1460+ commits |
| 支持平台 | macOS / Windows / Linux |
| 价格 | **$0，无付费墙** |
| 许可证 | AGPL 3.0（可商用） |
| 导出格式 | MP4 + GIF |
| 扩展系统 | 社区市场（官方维护） |

**核心定位：录制 + 编辑 + 导出一体，录完即可直出精品视频。**

---

![Recordly 主界面](https://github.com/user-attachments/assets/e6d68606-5fc0-4f70-99cd-7521982dc13b)

---

## 🤔 它到底做了什么？

Recordly 的逻辑很简单：**把专业演示视频后期的那些固定动作，全部内置到录制流程里。**

- 自动识别你的光标活动区域，建议/执行缩放
- 光标平滑、运动模糊、点击弹跳效果，一键开启
- 内置壁纸、渐变、毛玻璃等背景样式，自动套框
- 摄像头气泡跟随缩放智能缩放，不会遮住关键内容
- 导出同一套渲染逻辑，预览即所得

录完停下来，打开编辑器，调几个参数，直接导出。就这样。

---

## 🏗️ 技术底座

| 模块 | 技术 |
|---|---|
| 应用框架 | Electron |
| 画面渲染 / 导出 | **PixiJS** |
| 前端 UI | React + TypeScript |
| 音视频处理 | ffmpeg-static |
| 系统捕获（macOS） | ScreenCaptureKit（原生） |
| 系统捕获（Windows） | Windows Graphics Capture（原生 WGC） |
| 音频捕获（Windows） | 原生 WASAPI |

渲染这块用 PixiJS 统一处理是个关键决策——预览和导出走同一套场景逻辑，做到所见即所得，不会出现"预览挺好看导出糊了"的情况。

---

## 🧪 实战演练

### 安装

到官方 Releases 页下载对应平台安装包：

```
https://github.com/webadderallorg/Recordly/releases
```

- **macOS**：下载 `.dmg`，macOS 14 (Sonoma) 及以上
- **Windows**：下载 `.exe`，Win10 Build 19041+
- **Linux (Arch)**：`yay -S recordly-bin`

本地构建也就三步：

```bash
git clone https://github.com/webadderallorg/Recordly.git
cd Recordly && npm install
npm run dev
```

---

### 录制界面

启动后选择要录制的屏幕或窗口，配置麦克风 + 系统音频，点开始。

![录制界面](https://raw.githubusercontent.com/webadderallorg/Recordly/main/docs/media/feature1.gif)

操作很轻，整个 HUD 浮在屏幕上不打扰录制内容。停止后自动跳入编辑器。

---

### 编辑器：精修的主场

进编辑器之后，你面对的是一条时间线——可以拖拽加缩放区域、变速片段、裁剪、加注释文字/图片/图形。

![编辑器界面](https://i.postimg.cc/pLSMfrTM/Screenshot-2026-04-30-at-5-11-45-pm.png)

背景这块很实用：内置了一批壁纸（含 macOS Sonoma、Ventura 系列），也可以上传自定义背景，支持纯色/渐变/模糊，留白和圆角都能调。

---

### 时间线编辑

Recordly 的时间线专门为演示视频设计：缩放关键帧、变速区域、额外音轨，拖拽操作，不需要学习曲线。

![时间线](https://github.com/user-attachments/assets/3692bd8f-7b8d-4a93-b696-d17c828487ea)

编辑状态可以保存为 `.recordly` 项目文件，随时回来继续改，不丢失任何设置。

---

### 导出

MP4 走高质量输出，GIF 模式支持控制帧率、尺寸、循环方式。光标循环模式可以让 GIF 的首尾光标位置对齐，不会出现跳帧感。

| 格式 | 适合场景 |
|---|---|
| MP4 | 产品演示、课程录制、正式分享 |
| GIF | 文档嵌入、社交媒体、技术说明 |

---

## 🧩 扩展市场：一个被低估的亮点

Recordly 有一套社区扩展系统，任何人都可以发布扩展来为它增加能力：

- 光标点击音效
- 设备边框（手机/笔记本模拟外壳）
- 浏览器模拟外壳
- 自定义壁纸包
- 渲染钩子

扩展市场地址：`marketplace.recordly.dev/extensions`

这个思路很聪明——核心保持干净，定制能力交给社区。

---

## 🎯 谁该用？

| 场景 | 推荐理由 |
|---|---|
| 产品 / 开发者做 Demo 视频 | 自动缩放 + 背景样式，零剪辑出品 |
| 技术教程创作者 | 内置时间线，比 PR 轻太多 |
| 用 Loom / Kap 的用户 | 功能更全，永久免费，可商用 |
| 开源项目贡献者 | AGPL，直接参与开发 |

---

## 总结

Recordly 解决的是一个真实但被低估的效率问题：**录制本身快，后期才是瓶颈。**

把缩放、光标美化、背景样式这些事内置进录制流程，然后给它一条顺手的时间线——这就是 Recordly 的全部逻辑，没有多余的东西，也没有任何付费墙。

对于日常需要做演示视频的人来说，这个工具值得认真试一次。

---

**项目地址**：https://github.com/webadderallorg/Recordly  
**官网**：https://recordly.dev  
**许可证**：AGPL 3.0

---

*觉得有用？点赞转发让更多人看到 💪*
