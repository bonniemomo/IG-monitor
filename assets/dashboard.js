/* IG 繁中竞品监控 · 看板脚本
 * 读取 config.json、accounts.csv、data/daily.csv、data/posts.csv、data/log.csv 并绘图。
 */
(async function () {
  const DAY = 864e5;
  const fmtN = d3.format(',');
  const fmtS = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmtN(Math.abs(Math.round(v)));
  const fmtP = d3.format('.2%');
  const fmtD = d3.timeFormat('%-m/%-d');
  const parseDay = (s) => new Date(s + 'T00:00:00+08:00');
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v);
    }
    for (const k of kids) n.append(k instanceof Node ? k : document.createTextNode(k == null ? '' : String(k)));
    return n;
  };
  const bust = '?v=' + Date.now();
  const load = (p) => d3.csv(p + bust).catch(() => []);

  let cfg, accounts, daily, posts, log;
  try {
    [cfg, accounts, daily, posts, log] = await Promise.all([
      d3.json('config.json' + bust), load('accounts.csv'), load('data/daily.csv'), load('data/posts.csv'), load('data/log.csv'),
    ]);
  } catch (e) {
    document.getElementById('lede').textContent = '读取配置失败：' + e.message;
    return;
  }

  // ---------- 整理数据 ----------
  const labelOf = new Map(accounts.map((a) => [a.username.trim().toLowerCase(), (a.label || a.username).trim()]));
  const order = accounts.map((a) => a.username.trim().toLowerCase());
  const SELF = cfg.self, RIVAL = cfg.rival;
  const colorVars = ['--c0', '--c1', '--c2', '--c3', '--c4', '--c5'];
  const colorOf = (u) => css(colorVars[Math.max(0, order.indexOf(u)) % colorVars.length]);

  daily.forEach((r) => { r.followers = +r.followers; r.t = parseDay(r.date); });
  daily = daily.filter((r) => labelOf.has(r.username) && r.followers > 0);
  posts.forEach((p) => { p.likes = p.likes === '' ? null : +p.likes; p.comments = p.comments === '' ? null : +p.comments; });

  const byAcct = d3.group(daily, (r) => r.username);
  byAcct.forEach((rows) => rows.sort((a, b) => a.t - b.t));
  const series = (u) => byAcct.get(u) || [];
  const latest = (u) => { const s = series(u); return s[s.length - 1]; };
  const lastDate = d3.max(daily, (r) => r.t);

  // 某账号在 n 天窗口内的日均净增（用窗口内最早和最晚两天的差，除以相隔天数）
  const pace = (u, n) => {
    const s = series(u); if (s.length < 2) return null;
    const end = s[s.length - 1];
    const from = s.filter((r) => r.t >= new Date(+end.t - n * DAY))[0];
    const days = (end.t - from.t) / DAY;
    return days >= 1 ? (end.followers - from.followers) / days : null;
  };
  const gainOver = (u, n) => {
    const s = series(u); const end = s[s.length - 1]; if (!end) return null;
    const from = s.find((r) => +r.t === +end.t - n * DAY);
    return from ? end.followers - from.followers : null;
  };

  // ---------- 追赶币安 ----------
  const b = cfg.baseline;
  const baseDate = parseDay(b.date);
  const targetDate = parseDay(cfg.target_date);
  const baseGap = b.rival_followers - b.self_followers;
  const targetGap = Math.round(baseGap * (1 - cfg.gap_reduction_target));
  const sL = latest(SELF), rL = latest(RIVAL);
  const haveLive = sL && rL && +sL.t === +rL.t;
  const nowGap = haveLive ? rL.followers - sL.followers : baseGap;
  const asOf = haveLive ? sL.t : baseDate;
  const daysLeft = Math.max(1, Math.round((targetDate - asOf) / DAY));
  const sPace = pace(SELF, 14), rPace = pace(RIVAL, 14);
  const need = rPace == null ? null : rPace + (nowGap - targetGap) / daysLeft;
  const projGap = sPace == null || rPace == null ? null : nowGap + (rPace - sPace) * daysLeft;
  const elapsed = (asOf - baseDate) / ((targetDate - baseDate) || 1);
  const planGapNow = baseGap - (baseGap - targetGap) * Math.max(0, elapsed);

  const selfName = labelOf.get(SELF) || SELF, rivalName = labelOf.get(RIVAL) || RIVAL;
  document.getElementById('chase-sub').textContent =
    `目标：${cfg.target_date} 前把差距缩小 ${Math.round(cfg.gap_reduction_target * 100)}%，从起点 ${fmtN(baseGap)}（${b.date}）缩到 ${fmtN(targetGap)} 以内。还剩 ${daysLeft} 天。`;

  let statusEl;
  if (projGap == null) statusEl = el('span', { class: 'status warn' }, '数据积累中');
  else if (projGap <= targetGap) statusEl = el('span', { class: 'status good' }, '按当前速度能达标');
  else statusEl = el('span', { class: 'status bad' }, '按当前速度达不到');

  const tile = (lab, val, note, cls) => el('div', { class: 'tile' },
    el('div', { class: 'lab' }, lab), el('div', { class: 'val ' + (cls || '') }, val), el('div', { class: 'note' }, note || ''));
  const t = document.getElementById('chase-tiles');
  t.append(
    tile('当前差距', fmtN(nowGap), haveLive ? `${selfName} ${fmtN(sL.followers)} vs ${rivalName} ${fmtN(rL.followers)}` : '起点手动记录的约数，等待第一次采集'),
    tile('已缩小', fmtS(baseGap - nowGap), `计划此时应缩小 ${fmtN(Math.round(baseGap - planGapNow))}`, baseGap - nowGap >= baseGap - planGapNow ? 'good' : 'bad'),
    tile(`${selfName} 需要的日均净增`, need == null ? '—' : fmtN(Math.ceil(need)), need == null ? '需要至少 2 天数据' : `= ${rivalName} 日增 + 剩余差距 ÷ 剩余天数`),
    tile(`${selfName} 近 14 天日均`, sPace == null ? '—' : fmtS(sPace), `参考：${cfg.reference.label}约 ${cfg.reference.daily_growth}/天`, need != null && sPace != null ? (sPace >= need ? 'good' : 'bad') : ''),
    tile(`${rivalName} 近 14 天日均`, rPace == null ? '—' : fmtS(rPace), ''),
    tile(`按当前速度 ${cfg.target_date.slice(5).replace('-', '/')} 的差距`, projGap == null ? '—' : fmtN(Math.round(projGap)), '', projGap == null ? '' : projGap <= targetGap ? 'good' : 'bad'),
  );
  document.getElementById('chase-status').replaceChildren(statusEl);

  // 顶部一句话
  const lede = document.getElementById('lede');
  if (!daily.length) lede.textContent = '还没有采集到数据。第一次自动采集完成后，这里会显示结论。';
  else if (projGap == null) lede.textContent = `${selfName} 与 ${rivalName} 目前相差 ${fmtN(nowGap)} 粉。再积累几天数据后，就能算出增速和达标预测。`;
  else lede.textContent = `${selfName} 与 ${rivalName} 相差 ${fmtN(nowGap)} 粉；${selfName} 近 14 天日均 ${fmtS(sPace)}，要达标需要每天 ${fmtN(Math.ceil(need))}，` +
    (projGap <= targetGap ? '目前进度够。' : `差 ${fmtN(Math.ceil(need - sPace))}/天。`);
  document.getElementById('meta').textContent = lastDate ? `数据更新到 ${d3.timeFormat('%Y-%m-%d')(lastDate)} · 每天北京时间 9 点左右自动采集` : '';

  // ---------- 通用：折线图 ----------
  function lineChart(host, lines, opts) {
    host.replaceChildren();
    const W = host.clientWidth || 600, H = opts.height || 280;
    const m = { t: 12, r: opts.right || 16, b: 28, l: 56 };
    const all = lines.flatMap((l) => l.pts);
    if (!all.length) { host.append(el('div', { class: 'empty' }, opts.empty || '数据积累中')); return; }
    const svg = d3.select(host).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`);
    const xDom = opts.xDomain || d3.extent(all, (p) => p.t);
    if (+xDom[0] === +xDom[1]) xDom[1] = new Date(+xDom[0] + DAY);
    const x = d3.scaleTime(xDom, [m.l, W - m.r]);
    const yExt = d3.extent(all, (p) => p.v);
    const y = d3.scaleLinear([Math.min(opts.zero ? 0 : yExt[0], yExt[0]), yExt[1]], [H - m.b, m.t]).nice(5);
    const yt = y.ticks(5);
    svg.append('g').selectAll('line').data(yt).join('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y).attr('y2', y).attr('stroke', css('--grid'));
    svg.append('g').selectAll('text').data(yt).join('text').attr('x', m.l - 8).attr('y', y).attr('dy', '0.32em').attr('text-anchor', 'end').text((v) => d3.format('~s')(v));
    const xt = x.ticks(Math.max(2, Math.min(8, Math.floor((W - m.l - m.r) / 80))));
    svg.append('g').selectAll('text').data(xt).join('text').attr('x', x).attr('y', H - 8).attr('text-anchor', 'middle').text(fmtD);
    const line = d3.line().x((p) => x(p.t)).y((p) => y(p.v));
    for (const l of lines) {
      const g = svg.append('path').attr('fill', 'none').attr('stroke', l.color).attr('stroke-width', l.width || 2)
        .attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round').attr('d', line(l.pts));
      if (l.dash) g.attr('stroke-dasharray', l.dash);
      if (l.pts.length === 1) svg.append('circle').attr('cx', x(l.pts[0].t)).attr('cy', y(l.pts[0].v)).attr('r', 3.5).attr('fill', l.color);
    }
    // 悬停提示
    const tip = el('div', { class: 'tip' }); tip.hidden = true; host.append(tip);
    const rule = svg.append('line').attr('y1', m.t).attr('y2', H - m.b).attr('stroke', css('--muted-line')).attr('opacity', 0);
    const dates = [...new Set(lines.filter((l) => !l.noTip).flatMap((l) => l.pts.map((p) => +p.t)))].sort((a, b) => a - b);
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b).attr('fill', 'transparent')
      .on('pointermove', (ev) => {
        if (!dates.length) return;
        const t0 = +x.invert(d3.pointer(ev)[0]);
        const tt = dates[d3.minIndex(dates, (d) => Math.abs(d - t0))];
        rule.attr('x1', x(tt)).attr('x2', x(tt)).attr('opacity', 1);
        const rows = lines.filter((l) => !l.noTip).map((l) => [l, l.pts.find((p) => +p.t === tt)]).filter((r) => r[1]).sort((a, b) => b[1].v - a[1].v);
        tip.replaceChildren(el('div', { class: 'd' }, d3.timeFormat('%Y-%m-%d')(new Date(tt))),
          ...rows.map(([l, p]) => el('div', {}, el('i', { class: 'sw', style: `background:${l.color}` }), `${l.name}  ${opts.fmt(p.v)}`)));
        tip.hidden = false;
        const sx = x(tt) / W * host.clientWidth, tw = tip.offsetWidth;
        tip.style.left = Math.max(0, Math.min(sx + 12 + tw > host.clientWidth ? sx - tw - 12 : sx + 12, host.clientWidth - tw)) + 'px';
        tip.style.top = '6px';
      })
      .on('pointerleave', () => { tip.hidden = true; rule.attr('opacity', 0); });
    return { svg, x, y, m, W, H };
  }

  // ---------- 差距走势 ----------
  function drawGap() {
    const sMap = new Map(series(SELF).map((r) => [+r.t, r.followers]));
    const pts = [{ t: baseDate, v: baseGap }].concat(series(RIVAL).filter((r) => sMap.has(+r.t) && +r.t !== +baseDate).map((r) => ({ t: r.t, v: r.followers - sMap.get(+r.t) })));
    const plan = [{ t: baseDate, v: baseGap }, { t: targetDate, v: targetGap }];
    const c = lineChart(document.getElementById('gap-chart'), [
      { name: '目标路径', pts: plan, color: css('--muted'), dash: '5 5', width: 1.5, noTip: true },
      { name: '实际差距', pts, color: css('--c0'), width: 2.5 },
    ], { height: 260, fmt: fmtN, xDomain: [baseDate, targetDate], right: 70 });
    if (c) c.svg.append('text').attr('x', c.x(targetDate) + 4).attr('y', c.y(targetGap)).attr('dy', '0.32em').text('目标 ' + d3.format('~s')(targetGap));
  }

  // ---------- 竞品对比表 ----------
  const c30 = lastDate ? new Date(+lastDate - 30 * DAY) : null;
  const recent = posts.filter((p) => c30 && p.date && parseDay(p.date) > c30);
  function drawCompare() {
    const tb = document.getElementById('cmp');
    const head = ['账号', '粉丝数', '7 天净增', '30 天净增', '日均净增（14 天）', '30 天发帖', '平均互动率'];
    const cls = ['', '', 'opt', '', '', 'opt', ''];
    tb.replaceChildren(el('thead', {}, el('tr', {}, ...head.map((h, i) => el('th', { class: cls[i] }, h)))));
    const rows = order.filter((u) => latest(u)).map((u) => {
      const L = latest(u);
      const ps = recent.filter((p) => p.username === u && p.likes != null);
      const eng = ps.length ? d3.mean(ps, (p) => (p.likes + (p.comments || 0)) / L.followers) : null;
      return { u, f: L.followers, g7: gainOver(u, 7), g30: gainOver(u, 30), pace: pace(u, 14), n: recent.filter((p) => p.username === u).length, eng };
    }).sort((a, b) => b.f - a.f);
    const body = el('tbody');
    if (!rows.length) body.append(el('tr', {}, el('td', { colspan: 7, class: 'empty' }, '还没有采集到数据')));
    for (const r of rows) {
      const signCls = (v) => (v == null ? '' : v < 0 ? 'bad' : '');
      body.append(el('tr', { class: r.u === SELF ? 'me' : '' },
        el('td', {}, el('i', { class: 'sw', style: `background:${colorOf(r.u)}` }), labelOf.get(r.u)),
        el('td', {}, fmtN(r.f)),
        el('td', { class: 'opt ' + signCls(r.g7) }, r.g7 == null ? '—' : fmtS(r.g7)),
        el('td', { class: signCls(r.g30) }, r.g30 == null ? '—' : fmtS(r.g30)),
        el('td', { class: signCls(r.pace) }, r.pace == null ? '—' : fmtS(r.pace)),
        el('td', { class: 'opt' }, fmtN(r.n)),
        el('td', {}, r.eng == null ? '—' : fmtP(r.eng))));
    }
    tb.append(body);
  }

  // ---------- 每日净增 ----------
  function drawGain() {
    const lines = order.filter((u) => series(u).length > 1).map((u) => {
      const s = series(u); const pts = [];
      for (let i = 1; i < s.length; i++) {
        const days = (s[i].t - s[i - 1].t) / DAY;
        if (days >= 1) pts.push({ t: s[i].t, v: (s[i].followers - s[i - 1].followers) / days });
      }
      return { name: labelOf.get(u), pts: pts.slice(-60), color: colorOf(u), width: u === SELF || u === RIVAL ? 2.5 : 1.5 };
    });
    const lg = document.getElementById('gain-legend');
    lg.replaceChildren(...order.map((u) => el('span', {}, el('i', { class: 'sw', style: `background:${colorOf(u)}` }), labelOf.get(u))));
    lineChart(document.getElementById('gain-chart'), lines, { height: 260, fmt: (v) => fmtS(v) + '/天', empty: '需要至少 2 天数据' });
  }

  // ---------- 内容类型 ----------
  function drawMix() {
    const host = document.getElementById('mix-chart'); host.replaceChildren();
    const types = [['Reels', '--c2'], ['轮播', '--c1'], ['图文', '--muted-line']];
    const by = d3.rollup(recent, (v) => v.length, (p) => p.username, (p) => p.type);
    const us = order.filter((u) => by.has(u)).sort((a, b) => d3.sum(by.get(b).values()) - d3.sum(by.get(a).values()));
    if (!us.length) { host.append(el('div', { class: 'empty' }, '数据积累中')); return; }
    const W = host.clientWidth || 400, bh = 22, gap = 14, H = us.length * (bh + gap) + 6;
    const svg = d3.select(host).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`);
    const lw = d3.max(us, (u) => { const tt = svg.append('text').text(labelOf.get(u)); const w = tt.node().getComputedTextLength(); tt.remove(); return w; });
    const x = d3.scaleLinear([0, d3.max(us, (u) => d3.sum(by.get(u).values()))], [lw + 12, W - 34]);
    us.forEach((u, i) => {
      const yy = i * (bh + gap) + 3; let acc = 0;
      svg.append('text').attr('x', lw + 4).attr('y', yy + bh / 2).attr('dy', '0.32em').attr('text-anchor', 'end')
        .style('fill', css('--fg')).style('font-weight', u === SELF ? 600 : 400).text(labelOf.get(u));
      for (const [tname, cv] of types) {
        const n = by.get(u).get(tname) || 0; if (!n) continue;
        svg.append('rect').attr('x', x(acc)).attr('y', yy).attr('width', Math.max(0, x(acc + n) - x(acc) - 1)).attr('height', bh).attr('rx', 3)
          .attr('fill', css(cv)).append('title').text(`${labelOf.get(u)} · ${tname}：${n} 条`);
        acc += n;
      }
      svg.append('text').attr('x', x(acc) + 6).attr('y', yy + bh / 2).attr('dy', '0.32em').text(acc);
    });
  }

  // ---------- 爆款帖 ----------
  function drawTop() {
    const tb = document.getElementById('top');
    const fol = new Map(order.filter((u) => latest(u)).map((u) => [u, latest(u).followers]));
    const rows = recent.filter((p) => p.likes != null && fol.get(p.username))
      .map((p) => ({ ...p, eng: (p.likes + (p.comments || 0)) / fol.get(p.username) }))
      .sort((a, b) => b.eng - a.eng).slice(0, 15);
    tb.replaceChildren(el('thead', {}, el('tr', {},
      el('th', {}, '账号'), el('th', { class: 'l' }, '日期'), el('th', { class: 'l' }, '类型'), el('th', { class: 'l opt' }, '文案'),
      el('th', { class: 'opt' }, '点赞'), el('th', { class: 'opt' }, '评论'), el('th', {}, '互动率'), el('th', {}, ''))));
    const body = el('tbody');
    if (!rows.length) body.append(el('tr', {}, el('td', { colspan: 8, class: 'empty' }, '数据积累中')));
    for (const p of rows) {
      const a = el('a', { href: p.url, target: '_blank', rel: 'noopener' }, '原帖');
      body.append(el('tr', { class: p.username === SELF ? 'me' : '' },
        el('td', {}, labelOf.get(p.username)), el('td', { class: 'l' }, p.date), el('td', { class: 'l' }, p.type),
        el('td', { class: 'l opt cap', title: p.caption }, p.caption),
        el('td', { class: 'opt' }, fmtN(p.likes)), el('td', { class: 'opt' }, p.comments == null ? '—' : fmtN(p.comments)),
        el('td', {}, fmtP(p.eng)), el('td', {}, a)));
    }
    tb.append(body);
  }

  // ---------- 日志 ----------
  function drawLog() {
    const tb = document.getElementById('log');
    tb.replaceChildren(el('thead', {}, el('tr', {}, el('th', {}, '时间'), el('th', { class: 'l' }, '状态'), el('th', { class: 'l' }, '说明'))));
    const body = el('tbody');
    const rows = log.slice(-7).reverse();
    if (!rows.length) body.append(el('tr', {}, el('td', { colspan: 3, class: 'empty' }, '还没有运行记录')));
    for (const r of rows) {
      body.append(el('tr', {}, el('td', {}, r.time),
        el('td', { class: 'l ' + (r.status === '成功' ? 'good' : r.status === '失败' ? 'bad' : 'warn') }, r.status),
        el('td', { class: 'l' }, r.message)));
    }
    tb.append(body);
  }

  const drawCharts = () => { drawGap(); drawGain(); drawMix(); };
  drawCompare(); drawTop(); drawLog(); drawCharts();
  let w = window.innerWidth;
  window.addEventListener('resize', () => { if (Math.abs(window.innerWidth - w) > 20) { w = window.innerWidth; drawCharts(); } });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { drawCompare(); drawCharts(); });
})();
