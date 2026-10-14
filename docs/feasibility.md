# API 可行性报告

验证基线：本机 `C:/Program Files/SiYuan/resources/app/package.json` 为 3.8.6，Electron 主进程源码及宿主前端构建资源可直接读取。官方源码固定到 `v3.8.6`，SDK 为 `siyuan` 1.2.7。

| 能力 | 源码检查结论 | 实现路线 |
| --- | --- | --- |
| 全局快捷键 | `addCommand` 注册带 `globalCallback` 的命令后调用宿主快捷键刷新；主进程将系统事件派发到主工作空间 | `onLayoutReady` 中单实例注册，使用宿主 keymap，不自行调用 globalShortcut |
| 注册失败 | 主进程 `siyuan-hotkey` 返回 `failed` 列表 | 兼容层监听冲突提示；禁用时移除监听，宿主负责命令绑定清理 |
| 官方独立窗口 | `openWindow` 接受 doc 或 tab、尺寸、位置和置顶；不能直接传入自定义 URL | 不用于轻量窗口主路线 |
| 尺寸限制 | 官方窗口 `minWidth:493`、`minHeight:376` | 使用插件原生窗口 420×320，最小 300×220 |
| 多窗口与原生置顶 | 宿主启用 `@electron/remote`，已有 `BrowserWindow` 与 `setAlwaysOnTop` | 所有访问隔离在 ElectronAdapter，只操作自己持有的窗口对象 |
| 子窗口初始化 | 官方独立窗口会运行自己的前端插件生命周期 | 自定义轻量页面不加载插件入口，避免重复注册 |
| Protyle | 构造器依赖 `App`、`window.siyuan`、宿主模块和全局 DOM；SDK 提供类型而非独立编辑器运行时 | 按已约定的降级条件使用 CodeMirror；未复制内部模块或伪造宿主环境 |
| 内容写入 | 官方 `createDocWithMd`、`appendBlock`、`updateBlock`、`getBlockKramdown`、SQL 查询与路径查询 | 独立标记容器，文档路径串行队列、内容基线检查、确定性容器 ID |
| 闪念配置 | `getShorthandSavePath` 在内核解析 ShorthandSaveBox/Path 模板 | 不直接读写 conf.json，不自行解释模板 |
| 思源原有托盘 | `resetTrayMenu` 为主进程封闭菜单，未发现公开插件扩展入口 | 不修改现有菜单 |
| 独立速记托盘 | 用户已接受额外图标；Electron 提供 Tray、Menu 与原生弹出菜单 | 通过宿主 remote 创建自己持有的图标，动态菜单、设置开关、卸载清理；真实兼容性待实测 |
| 退出与卸载 | 不可只依赖生命周期钩子保护内容；进程关闭不保证执行钩子，拆除总预算有限 | 每次输入落本机恢复草稿，卸载有限时间刷新并销毁自己的窗口 |

## 安全边界

0.1.13 使用宿主已有的 `remote.require` 加载插件目录中的 `tray-lifetime.cjs`，仅在主进程绑定所属 WebContents 的结束事件并销毁插件自有托盘。需要主进程本地回调，因为直接销毁工作空间窗口可能跳过 DOM 退出事件，渲染器回调在销毁后也无法执行。不修改宿主主进程文件，不调用 `remoteMain.enable`，不写入安装目录，不改工作空间文档文件。轻量窗口启用 `nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`、`webSecurity:true`；无 preload。网络/原生操作都由主插件接管。子页面 CSP 禁止网络连接与外部脚本，内容仅进入 CodeMirror，不作为 HTML 执行。

非公开依赖仅为宿主 `@electron/remote` 访问、`siyuan-hotkey` 冲突通知和主工作空间身份字段；升级需重新实测。原生能力不足时不能宣称通过轻量窗口和原生置顶验收。

## 原始来源

- https://github.com/siyuan-note/plugin-sample
- https://github.com/siyuan-note/petal/blob/master/siyuan.d.ts
- https://github.com/siyuan-note/siyuan/blob/v3.8.6/app/src/plugin/index.ts
- https://github.com/siyuan-note/siyuan/blob/v3.8.6/app/src/plugin/API.ts
- https://github.com/siyuan-note/siyuan/blob/v3.8.6/app/src/protyle/index.ts
- https://github.com/siyuan-note/siyuan/blob/v3.8.6/app/electron/main.js
- https://github.com/siyuan-note/siyuan/blob/v3.8.6/kernel/api/filetree.go
- https://github.com/siyuan-note/siyuan/blob/v3.8.6/docs/API.md
- https://www.electronjs.org/docs/latest/api/tray

运行测试结果单独列在 testing.md。本报告的源码结论不等于实机验收通过。

## 功能实现清单

| 功能 | 交付状态 |
| --- | --- |
| 全局快捷键、自定义绑定、节流、最近窗口行为 | 代码已实现；真实系统注册与卸载注销待实测 |
| 420×320 独立窗口、移动、缩放、最小化、自动聚焦 | 代码已实现；原生窗口兼容性待实测 |
| 多窗口隔离、重复打开唤醒、上限与窗口状态 | 已实现；模拟五窗口测试通过 |
| 每窗口独立原生置顶 | 代码已实现；跨应用置顶待实测，不以模拟测试作为验收 |
| Markdown、中文文本、撤销重做、自动保存 | 已实现；中文 IME 组合及真实编辑体验待实测 |
| 跟随闪念配置 / 插件独立保存配置 | 已实现；真实内核模板与容器写入待实测 |
| 保存失败提示、冲突阻止、恢复草稿 | 已实现；故障模拟与真实本机文件测试通过 |
| 最近列表、重开、启动恢复入口、设置持久化 | 已实现；思源重启和插件重新加载待实测 |
| Protyle | 未采用；轻量页面缺少可直接使用的运行时，按计划降级 CodeMirror |
| 独立速记托盘 | 已实现；模拟点击、动态窗口菜单、销毁和重新创建测试通过，Windows 实机待验证 |
| 思源原有托盘菜单扩展 | 未实现；没有公开安全扩展入口 |
| 截图粘贴、选择图片、图片拖入 | 已实现；宿主通过公开资源上传 API 写入 assets，子窗口插入 Markdown 链接；实机待验证 |
| 悬浮窗口图片预览 | 已实现；CodeMirror 块组件展示本地资源图片，支持加载失败提示与选中源码 |
| 其他附件、完整 Markdown 预览和标签 | 留待后续扩展 |

## 0.1.2 保存调度改进

保留原生 `getShorthandSavePath` 与文档/块写入接口，不采用移动端的本机速记导入流程。输入、心跳及关闭内容确认不排在内核保存后面；草稿写入合并为一个活动任务和最新快照，正式写入意图中的目标路径与文档 ID 仍须确认落盘。

普通关闭、卸载通过带唯一请求标识的窗口内容收集与草稿确认保护最新输入，取消固定延时猜测。卸载不等待内核提交；收集/落盘无法确认时保留窗口并明确提示，停止编辑以便复制。宿主强制关闭或进程退出不保证保留窗口，因此不能承诺强制退出无损。

写入后检查容器标识及正文，使用宿主已有 Lute 做 Markdown 等价比较，并单独保留超级块布局结构。核对失败或不一致保留草稿并阻止自动覆盖；缺少解析器时保守比较文本。模拟及只读解析器测试通过，不等于真实内核事务通过，不提供跨客户端 CAS 保证。
