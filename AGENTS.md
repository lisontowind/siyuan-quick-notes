# 项目协作与发布

## GitHub 登录凭据

- 本项目多次出现隔离环境凭据读取异常：普通执行环境中的 `gh auth status` 可能显示 token invalid / 401，但系统环境中的同一 GitHub 账号仍可正常登录。2026-10-20 已再次验证这一情况。
- 发布开始时，优先以 `sandbox_permissions: "require_escalated"` 执行 `gh auth status`，使用系统现有的 keyring 凭据。若普通环境报告认证失败，先按此方式复核，再判断凭据是否过期。
- 系统环境验证正常后，`gh` 的版本查询、Release 创建/上传、Actions 查询，以及需要认证的 `git push` 均使用系统环境执行。不要仅凭隔离环境报错就要求用户重新登录、替换 token、清空凭据或改用浏览器发布。
- 系统环境的实际工作目录可能重置为 `D:\Code`，即使工具传入了 `workdir`。Git 命令显式使用 `git -C D:/Tools/sy-stickynote ...`；`gh` 命令显式传入 `--repo lisontowind/siyuan-quick-notes`，安装包和更新说明使用绝对路径。
- 只有系统环境也确认认证失败时，才向用户说明真实的登录问题。不要输出、复制到项目文件或提交任何 token、密码及原始凭据内容。
- 以上是环境诊断经验，不替代工具审批。系统执行仍使用工具提供的正常审批机制；若审批被拒绝，遵循其限制并报告原因。

## 版本发布流程

1. 检查当前分支、工作区改动、远端最新版本；保留用户已有修改，说明本次发布范围。
2. 同步更新 `plugin.json`、`package.json` 和 `package-lock.json` 的版本，补充中英文 README 与 `docs/releases/<version>.md`。
3. 执行 `npm run check`，并按变更运行 `scripts/verify-ui.mjs`。界面验证使用隔离页面和模拟宿主，不连接用户真实工作空间。
4. 提交发布内容，推送分支并检查 GitHub Actions；通过后创建对应 `v<version>` 标签及 GitHub Release，附带本次构建的 `package.zip`。禁止覆盖既有版本或强推。
5. 确认公开版本号、目标提交及安装包已存在，再向用户提供 Release 链接。公开发布需已有用户明确授权。
