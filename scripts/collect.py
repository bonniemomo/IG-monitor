#!/usr/bin/env python3
"""
每日采集：调用 Apify 的 Instagram Profile Scraper，把结果累积进 data/ 下的 CSV。

  data/daily.csv  每个账号每天一行（同一天重跑会覆盖，不会重复）
  data/posts.csv  每条帖子一行（按帖子 ID 去重，每次刷新最新的点赞/评论/播放）
  data/log.csv    每次运行的结果

环境变量：
  APIFY_TOKEN   必填，Apify 的 API token（放在 GitHub Secrets 里）
  MOCK_FILE     可选，测试用：从本地 JSON 读取，代替调用 Apify
"""
import csv
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
ACTOR = "apify~instagram-profile-scraper"
TZ = timezone(timedelta(hours=8))  # 北京/台北时间

DAILY_COLS = ["date", "username", "label", "followers", "following", "posts_total"]
POST_COLS = ["post_id", "username", "label", "posted_at", "date", "type",
             "likes", "comments", "views", "url", "caption", "updated_at"]
LOG_COLS = ["time", "status", "accounts_ok", "message"]


def clean_username(raw):
    u = (raw or "").strip()
    u = re.sub(r"^https?://(www\.)?instagram\.com/", "", u, flags=re.I)
    u = re.split(r"[/?#]", u)[0]
    return u.lstrip("@").lower()


def read_accounts():
    with open(os.path.join(ROOT, "accounts.csv"), encoding="utf-8-sig") as f:
        out = []
        for row in csv.DictReader(f):
            u = clean_username(row.get("username"))
            if u:
                out.append((u, (row.get("label") or "").strip() or u))
        return out


def call_apify(token, usernames):
    mock = os.environ.get("MOCK_FILE")
    if mock:
        with open(mock, encoding="utf-8") as f:
            return json.load(f)
    url = (f"https://api.apify.com/v2/acts/{ACTOR}/run-sync-get-dataset-items"
           f"?timeout=280&token={urllib.parse.quote(token)}")
    body = json.dumps({"usernames": usernames}).encode()
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, data=body, method="POST",
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=320) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            last = f"Apify 返回 {e.code}: {e.read().decode(errors='ignore')[:300]}"
        except Exception as e:  # 网络超时等
            last = f"调用 Apify 失败: {e}"
        time.sleep(20)
    raise RuntimeError(last)


def num(v):
    if v is None or v == "":
        return ""  # 对方隐藏点赞数等情况留空，不记成 0
    try:
        n = int(float(v))
        return n if n >= 0 else ""
    except (TypeError, ValueError):
        return ""


def post_type(p):
    if p.get("productType") == "clips" or p.get("type") == "Video":
        return "Reels"
    if p.get("type") == "Sidecar":
        return "轮播"
    return "图文"


def to_local(ts):
    if not ts:
        return None
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).astimezone(TZ)
    except ValueError:
        return None


def read_csv(name, cols):
    path = os.path.join(DATA, name)
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return [{c: r.get(c, "") for c in cols} for r in csv.DictReader(f)]


def write_csv(name, cols, rows):
    os.makedirs(DATA, exist_ok=True)
    path = os.path.join(DATA, name)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    os.replace(tmp, path)


def append_log(status, ok, msg):
    rows = read_csv("log.csv", LOG_COLS)
    rows.append({"time": datetime.now(TZ).strftime("%Y-%m-%d %H:%M"),
                 "status": status, "accounts_ok": ok, "message": msg})
    write_csv("log.csv", LOG_COLS, rows[-500:])


def main():
    token = os.environ.get("APIFY_TOKEN", "")
    if not token and not os.environ.get("MOCK_FILE"):
        raise SystemExit("没有设置 APIFY_TOKEN（GitHub 仓库 → Settings → Secrets and variables → Actions）")

    accounts = read_accounts()
    labels = dict(accounts)
    items = call_apify(token, [u for u, _ in accounts])

    now = datetime.now(TZ)
    today, now_s = now.strftime("%Y-%m-%d"), now.strftime("%Y-%m-%d %H:%M")

    daily = {(r["date"], r["username"]): r for r in read_csv("daily.csv", DAILY_COLS)}
    posts = {r["post_id"]: r for r in read_csv("posts.csv", POST_COLS)}

    ok, n_posts = [], 0
    for it in items or []:
        u = clean_username(it.get("username"))
        if u not in labels or it.get("followersCount") is None:
            continue
        ok.append(u)
        daily[(today, u)] = {"date": today, "username": u, "label": labels[u],
                             "followers": num(it.get("followersCount")),
                             "following": num(it.get("followsCount")),
                             "posts_total": num(it.get("postsCount"))}
        for p in it.get("latestPosts") or []:
            pid = p.get("shortCode") or p.get("id")
            if not pid:
                continue
            t = to_local(p.get("timestamp"))
            sc = p.get("shortCode")
            posts[str(pid)] = {
                "post_id": str(pid), "username": u, "label": labels[u],
                "posted_at": t.strftime("%Y-%m-%d %H:%M") if t else "",
                "date": t.strftime("%Y-%m-%d") if t else "",
                "type": post_type(p),
                "likes": num(p.get("likesCount")), "comments": num(p.get("commentsCount")),
                "views": num(p.get("videoViewCount", p.get("videoPlayCount"))),
                "url": p.get("url") or (f"https://www.instagram.com/p/{sc}/" if sc else ""),
                "caption": re.sub(r"\s+", " ", str(p.get("caption") or ""))[:300],
                "updated_at": now_s,
            }
            n_posts += 1

    write_csv("daily.csv", DAILY_COLS, sorted(daily.values(), key=lambda r: (r["date"], r["username"])))
    write_csv("posts.csv", POST_COLS, sorted(posts.values(), key=lambda r: (r["date"], r["post_id"]), reverse=True))

    missing = [u for u, _ in accounts if u not in ok]
    msg = f"成功 {len(ok)} 个账号，帖子 {n_posts} 条" + (f"；没抓到：{', '.join(missing)}" if missing else "")
    append_log("失败" if not ok else "部分成功" if missing else "成功", len(ok), msg)
    print(msg)
    if not ok:
        raise SystemExit("一个账号都没抓到，请检查 Apify 余额或账号名")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        append_log("失败", 0, str(e)[:300])
        print(f"失败：{e}", file=sys.stderr)
        sys.exit(1)
