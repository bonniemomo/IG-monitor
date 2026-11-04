# IG 繁中竞品监控

每天自动采集 OKX 中文和竞品 Instagram 账号的公开数据，生成一个不用登录就能打开的网页看板，重点追踪"追赶币安"的进度。

- **采集**：GitHub Actions 每天北京/台北时间 9 点左右，调用 Apify 抓取 `accounts.csv` 里的账号
- **存储**：数据累积在 `data/` 文件夹的 CSV 里，每天自动提交
- **看板**：GitHub Pages 把 `index.html` 发布成网页，任何人有链接就能看，手机电脑都可以

---

## 一次性设置（约 20 分钟）

### 1. 准备 Apify token
1. 到 https://apify.com 注册（建议用公司邮箱）
2. 登录后进入 **Settings → API & Integrations**，复制 **Personal API token**
3. token 相当于密码，不要发到群里或聊天里

### 2. 建 GitHub 仓库并上传文件
1. 登录 GitHub，右上角 **+ → New repository**，名字比如 `ig-monitor`
2. 选 **Public** 还是 **Private**，见下面的"看板谁能看到"
3. 建好后点 **uploading an existing file**，把解压后的**全部文件和文件夹**拖进去，点 **Commit changes**
   - 注意 `.github` 是隐藏文件夹。Mac 上在 Finder 里按 `Cmd + Shift + .` 才能看到，一定要一起上传，否则不会自动采集
   - 如果上传后仓库里没有 `.github` 文件夹：点 **Add file → Create new file**，文件名输入 `.github/workflows/collect.yml`，把本地这个文件的内容整段粘贴进去，点 **Commit changes**

### 3. 填入 token
仓库页面 → **Settings → Secrets and variables → Actions → New repository secret**
- Name：`APIFY_TOKEN`
- Secret：粘贴第 1 步复制的 token

### 4. 打开网页看板
仓库页面 → **Settings → Pages**
- Source 选 **Deploy from a branch**
- Branch 选 **main**，文件夹选 **/ (root)**，点 **Save**
- 1–2 分钟后页面顶部会显示网址，类似 `https://你的用户名.github.io/ig-monitor/`

### 5. 手动跑第一次
仓库页面 → **Actions** → 左侧 **每日采集 Instagram 数据** → 右侧 **Run workflow**
- 1–3 分钟后变成绿色勾，说明成功；刷新看板就能看到第一批数据
- 之后每天会自动运行，不用再管

---

## 日常维护（任何电脑，打开浏览器即可）

| 想做什么 | 怎么做 |
|---|---|
| 增删竞品 | 在 GitHub 上打开 `accounts.csv`，点铅笔图标编辑，一行一个：`用户名,显示名称`（也可以直接粘贴 IG 主页链接），保存 |
| 改追赶目标 | 编辑 `config.json`：`gap_reduction_target` 是差距要缩小的比例（0.30 = 30%），`target_date` 是截止日期 |
| 校准起点 | 第一次采集成功后，把 `config.json` 里 `baseline` 的两个粉丝数改成当天的精确数字 |
| 采集失败了 | GitHub 会发邮件通知。看板底部"采集日志"会写原因，常见是 Apify 余额不足或账号名写错。修好后在 Actions 里点 **Run workflow** 补采 |
| 补采今天 | Actions → Run workflow。同一天重复采集会覆盖，不会重复 |
| 查费用 | 登录 Apify 后台看用量。5 个账号每天一次，通常每月只要几美元，免费额度基本够用 |
| 改看板样式或加分析 | 回来找 Claude |

---

## 看板谁能看到

GitHub Pages 发布的网页，**任何拿到链接的人都能打开**，不需要登录。
- **免费账号**：仓库必须设为 **Public** 才能用 Pages。这意味着仓库里的数据和目标设置（比如追赶币安的 KPI）别人也能看到。数据本身都是 IG 公开信息，但 KPI 属于内部策略，请自己判断。
- **想把仓库设为 Private**：需要 GitHub Pro（个人约 4 美元/月）或公司的 GitHub Team/Enterprise 账号。仓库私有后，网页链接依然可以免登录打开。

---

## 文件说明

```
accounts.csv                     监控的账号名单
config.json                      追赶目标、起点数据
index.html / assets/             看板网页（d3 图表库已内置，不依赖外部网站）
scripts/collect.py               采集脚本（只用 Python 标准库）
.github/workflows/collect.yml    每日定时任务
data/daily.csv                   每日粉丝快照（自动生成）
data/posts.csv                   帖子明细，按帖子 ID 去重（自动生成）
data/log.csv                     采集日志（自动生成）
```

## 说明与限制

- 数据来自 Apify 抓取的 Instagram 公开页面，不是 Meta 官方接口；偶尔会有某个账号抓取失败，第二天通常会恢复。
- 每次能拿到每个账号**最近 12 条帖子**的数据，每天累积下来就是完整的发帖记录。
- 如果对方隐藏了点赞数，表格里会留空，不计入互动率。
- 涨粉曲线只能从开始采集那天算起，所以越早启动越好。
