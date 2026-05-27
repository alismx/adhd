#!/usr/bin/env node
// Self-hosted star-history chart generator.
//
// Pulls every stargazer's `starred_at` timestamp from the GitHub API,
// bins them, and writes an SVG line chart to docs/star-history.svg.
//
// We do this instead of embedding api.star-history.com because their
// backend caches GitHub data for hours and we cannot bust the cache.
// Self-hosting gives us full control: the workflow runs hourly + on
// every push, so the chart is always as fresh as the last workflow run.
//
// Usage:
//   GITHUB_REPOSITORY=UditAkhourii/adhd node scripts/build-star-chart.mjs
//   (or just) node scripts/build-star-chart.mjs   # uses default repo
//
// Auth: uses GITHUB_TOKEN if set (unauth limit is 60 req/h, auth is 5000).

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const REPO = process.env.GITHUB_REPOSITORY || "UditAkhourii/adhd";
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const OUT = "docs/star-history.svg";

const W = 800;
const H = 400;
const PAD = { top: 30, right: 30, bottom: 50, left: 60 };

async function fetchAllStars() {
  const headers = {
    "Accept": "application/vnd.github.star+json",
    "User-Agent": "adhd-star-chart-builder",
  };
  if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;

  const all = [];
  for (let page = 1; ; page++) {
    const url = `https://api.github.com/repos/${REPO}/stargazers?per_page=100&page=${page}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`GitHub API ${res.status} ${res.statusText} on page ${page}`);
    }
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const row of batch) {
      if (row.starred_at) all.push(new Date(row.starred_at));
    }
    if (batch.length < 100) break;
    if (page > 100) throw new Error("pagination safety stop"); // 10k stars cap
  }
  return all.sort((a, b) => a - b);
}

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

function makeSvg(dates) {
  const n = dates.length;
  if (n === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><text x="${W/2}" y="${H/2}" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="18" fill="#888">No stars yet</text></svg>`;
  }

  const t0 = dates[0].getTime();
  const t1 = dates[n - 1].getTime();
  const span = Math.max(1, t1 - t0);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // Cumulative star count line: at the i-th star event the count is i+1.
  // Plot a step-ish line by emitting one point per star.
  // To keep SVG size manageable when n is large, downsample to ~400 points.
  const target = Math.min(n, 400);
  const stride = Math.max(1, Math.floor(n / target));
  const pts = [];
  for (let i = 0; i < n; i += stride) {
    const x = PAD.left + ((dates[i].getTime() - t0) / span) * plotW;
    const y = PAD.top + plotH - ((i + 1) / n) * plotH;
    pts.push([x, y]);
  }
  // Always include the final point.
  const xLast = PAD.left + plotW;
  const yLast = PAD.top + plotH - 1 * plotH;
  pts.push([xLast, yLast]);

  const path = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  // Axis ticks: 5 evenly spaced star counts on Y, 4 evenly spaced dates on X.
  const yTickCount = 5;
  const yTicks = [];
  for (let i = 0; i <= yTickCount; i++) {
    const v = Math.round((i / yTickCount) * n);
    const y = PAD.top + plotH - (i / yTickCount) * plotH;
    yTicks.push({ v, y });
  }

  const xTickCount = 4;
  const xTicks = [];
  for (let i = 0; i <= xTickCount; i++) {
    const x = PAD.left + (i / xTickCount) * plotW;
    const t = new Date(t0 + (i / xTickCount) * span);
    xTicks.push({ x, t });
  }

  const gridLines = yTicks.map(t => `<line x1="${PAD.left}" y1="${t.y}" x2="${PAD.left + plotW}" y2="${t.y}" stroke="#eee" stroke-width="1"/>`).join("");
  const yLabels = yTicks.map(t => `<text x="${PAD.left - 8}" y="${t.y + 4}" text-anchor="end" font-family="ui-sans-serif, system-ui, sans-serif" font-size="11" fill="#555">${t.v}</text>`).join("");
  const xLabels = xTicks.map(t => `<text x="${t.x}" y="${H - PAD.bottom + 18}" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="11" fill="#555">${fmtDate(t.t)}</text>`).join("");

  // Build full SVG
  const generatedAt = new Date().toISOString();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Star history for ${escapeXml(REPO)}">
  <title>Star history — ${escapeXml(REPO)}</title>
  <desc>Generated ${escapeXml(generatedAt)} from GitHub API. ${n} total stars.</desc>
  <rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>
  <g>${gridLines}</g>
  <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + plotH}" stroke="#888" stroke-width="1"/>
  <line x1="${PAD.left}" y1="${PAD.top + plotH}" x2="${PAD.left + plotW}" y2="${PAD.top + plotH}" stroke="#888" stroke-width="1"/>
  <path d="${path}" fill="none" stroke="#e0644b" stroke-width="2.2" stroke-linejoin="round"/>
  <g>${yLabels}</g>
  <g>${xLabels}</g>
  <text x="${PAD.left}" y="${PAD.top - 12}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="13" font-weight="600" fill="#1a1a1a">${escapeXml(REPO)} · ${n} stars</text>
  <text x="${W - PAD.right}" y="${PAD.top - 12}" text-anchor="end" font-family="ui-monospace, Menlo, monospace" font-size="10" fill="#888">updated ${escapeXml(generatedAt.slice(0, 16))}Z</text>
</svg>
`;
}

async function main() {
  console.error(`Fetching stargazers for ${REPO}...`);
  const dates = await fetchAllStars();
  console.error(`Got ${dates.length} stars. Building SVG...`);
  const svg = makeSvg(dates);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, svg);
  console.error(`Wrote ${OUT} (${svg.length} bytes).`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
