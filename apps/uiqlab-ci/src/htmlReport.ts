import type { AssessmentReport, BatchAssessmentReport, FailedPageAssessmentReport, PageAssessmentReport, ReportMetric } from './report.js';
import { ASSESSMENT_PROFILES } from './assessmentProfiles.js';

type GateStatus = 'pass' | 'warning' | 'fail';

interface GenericReport {
  schemaVersion?: unknown;
  status?: unknown;
  source?: unknown;
  branch?: unknown;
  commitHash?: unknown;
  reason?: unknown;
  target?: unknown;
  qualityGate?: unknown;
  pages?: unknown;
}

export interface HtmlReportOptions {
  generatedAt?: Date;
  title?: string;
  imageSources?: ReadonlyMap<string, string>;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function gateStatus(value: unknown): GateStatus {
  const status = text(record(value)?.status);
  return status === 'pass' || status === 'warning' || status === 'fail' ? status : 'fail';
}

function gateLabel(status: GateStatus): string {
  return status === 'pass' ? 'Passed' : status === 'warning' ? 'Warning' : 'Failed';
}

function statusIcon(status: GateStatus): string {
  return status === 'pass' ? '&#10003;' : status === 'warning' ? '!' : '&#215;';
}

function safeLink(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? escapeHtml(url.toString()) : undefined;
  } catch {
    return undefined;
  }
}

function displayTarget(value: string): string {
  try {
    const url = new URL(value);
    return `${url.pathname || '/'}${url.search}${url.hash}`;
  } catch {
    return value;
  }
}

function screenshotDomId(resultId: string, label: string): string {
  return `screenshot-${resultId}-${label}`.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(value);
}

function signedNumber(value: number): string {
  return `${value > 0 ? '+' : ''}${formatNumber(value)}`;
}

function formatRaw(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function imageUrls(value: unknown, found: string[] = [], limit = 4): string[] {
  if (found.length >= limit) return found;
  if (typeof value === 'string') {
    if (safeLink(value)) {
      try {
        const path = new URL(value).pathname.toLowerCase();
        if (/\.(?:png|jpe?g|webp)$/.test(path) && !found.includes(value)) found.push(value);
      } catch {
        // safeLink already rejects malformed URLs.
      }
    }
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) imageUrls(item, found, limit);
    return found;
  }
  const item = record(value);
  if (item) for (const nested of Object.values(item)) imageUrls(nested, found, limit);
  return found;
}

async function fetchImageDataUrl(url: string): Promise<string | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return undefined;
    const declaredSize = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredSize) && declaredSize > 10 * 1024 * 1024) return undefined;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 10 * 1024 * 1024) return undefined;
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    const pathname = new URL(url).pathname.toLowerCase();
    const mimeType = contentType === 'image/png' || contentType === 'image/jpeg' || contentType === 'image/webp'
      ? contentType
      : pathname.endsWith('.png') ? 'image/png'
        : pathname.endsWith('.webp') ? 'image/webp'
          : pathname.endsWith('.jpg') || pathname.endsWith('.jpeg') ? 'image/jpeg'
            : undefined;
    return mimeType ? `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}` : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export async function renderHtmlReportWithEmbeddedImages(
  report: unknown,
  options: Omit<HtmlReportOptions, 'imageSources'> = {},
): Promise<string> {
  const urls = imageUrls(report, [], 32);
  const loaded = await Promise.all(urls.map(async (url) => [url, await fetchImageDataUrl(url)] as const));
  const imageSources = new Map<string, string>();
  for (const [url, source] of loaded) if (source) imageSources.set(url, source);
  return renderHtmlReport(report, { ...options, imageSources });
}

function renderGate(gateValue: unknown, compact = false): string {
  const gate = record(gateValue) ?? {};
  const status = gateStatus(gate);
  const mode = text(gate.mode, 'unknown');
  const reason = text(gate.reason, 'No quality-gate explanation was provided.');
  return `<div class="gate gate-${status}${compact ? ' gate-compact' : ''}">
    <span class="gate-icon" aria-hidden="true">${statusIcon(status)}</span>
    <div><span class="eyebrow">Quality gate · ${escapeHtml(mode)}</span><strong>${gateLabel(status)}</strong><p>${escapeHtml(reason)}</p></div>
  </div>`;
}

function renderMetric(metric: ReportMetric, options: HtmlReportOptions): string {
  const hasCurrent = metric.current !== undefined;
  const hasPrevious = metric.previous !== undefined;
  const hasDelta = metric.delta !== undefined;
  const comparison = hasCurrent && hasPrevious && hasDelta;
  const deltaClass = metric.delta === undefined || metric.delta === 0 ? 'neutral' : metric.delta > 0 ? 'up' : 'down';
  const materiality = metric.meaningfulChange === undefined
    ? ''
    : `<span class="change-badge ${metric.meaningfulChange ? 'material' : 'stable'}">${metric.meaningfulChange ? 'Meaningful change' : 'Within tolerance'}</span>`;
  const relative = metric.relativeDeltaPercent === undefined
    ? ''
    : `<span>${signedNumber(metric.relativeDeltaPercent)}%</span>`;
  const images = imageUrls(metric.raw);
  const visuals = images.length === 0 ? '' : `<div class="metric-visuals">${images.map((url, index) => {
    const source = options.imageSources?.get(url) ?? url;
    return `<figure><img src="${escapeHtml(source)}" alt="${escapeHtml(metric.name)} visual result ${index + 1}" loading="lazy"><figcaption>Visual result ${index + 1}</figcaption></figure>`;
  }).join('')}</div>`;
  const values = comparison
    ? `<div class="metric-values">
        <div><span>Baseline</span><strong>${formatNumber(metric.previous as number)}</strong></div>
        <div class="arrow" aria-hidden="true">&#8594;</div>
        <div><span>Current</span><strong>${formatNumber(metric.current as number)}</strong></div>
        <div class="delta delta-${deltaClass}"><span>Change</span><strong>${signedNumber(metric.delta as number)}</strong>${relative}</div>
      </div>`
    : `<div class="metric-values metric-values-single"><div><span>Current</span><strong>${hasCurrent ? formatNumber(metric.current as number) : 'See raw result'}</strong></div><div class="baseline-note">${hasPrevious ? `Baseline: ${formatNumber(metric.previous as number)}` : 'No compatible baseline'}</div></div>`;
  return `<article class="metric-card">
    <div class="metric-heading"><div><span class="metric-id">${escapeHtml(metric.id)}</span><h3>${escapeHtml(metric.name)}</h3></div>${materiality}</div>
    ${values}
    ${visuals}
    <details><summary>Raw result</summary><pre>${escapeHtml(formatRaw(metric.raw))}</pre></details>
  </article>`;
}

function renderProfiles(report: AssessmentReport): string {
  if (report.profileOutcomes.length === 0) return '';
  const profiles = report.profileOutcomes.map((profile) => {
    const outcome = profile.outcome;
    const metrics = [
      ...profile.alignedMetrics.map((metric) => `<span class="metric-chip aligned">${escapeHtml(metric)} ${profile.direction === 'observe' ? 'observed' : 'aligned'}</span>`),
      ...profile.opposedMetrics.map((metric) => `<span class="metric-chip opposed">${escapeHtml(metric)} opposed</span>`),
    ].join('');
    return `<article class="profile-card outcome-${escapeHtml(outcome)}">
      <div class="profile-heading"><div><span class="eyebrow">Expected direction · ${escapeHtml(profile.direction)}</span><h3>${escapeHtml(ASSESSMENT_PROFILES[profile.id]?.displayName ?? profile.id)}</h3></div><span class="outcome">${escapeHtml(outcome.replace('-', ' '))}</span></div>
      <p>${escapeHtml(profile.reason)}</p>
      ${metrics ? `<div class="metric-chips">${metrics}</div>` : ''}
    </article>`;
  }).join('');
  return `<section><div class="section-heading"><div><span class="eyebrow">Profile assessment</span><h2>Profile outcomes</h2></div><span class="count">${report.profileOutcomes.length}</span></div><div class="profile-grid">${profiles}</div></section>`;
}

function renderScreenshots(report: AssessmentReport, options: HtmlReportOptions): string {
  if (!report.screenshots) return '';
  const screenshots = [
    ...(report.screenshots.baseline ? [{ label: 'Before', url: report.screenshots.baseline }] : []),
    { label: 'After', url: report.screenshots.current },
  ];
  return `<section class="screenshot-section"><div class="section-heading"><div><span class="eyebrow">Visual comparison</span><h2>Page screenshots</h2></div><span class="count">${screenshots.length}</span></div><div class="screenshot-grid ${screenshots.length === 1 ? 'screenshot-grid-single' : ''}">${screenshots.map(({ label, url }) => {
    const source = options.imageSources?.get(url);
    const available = Boolean(source) || options.imageSources === undefined;
    const id = screenshotDomId(report.resultId, label);
    const image = available
      ? `<a class="screenshot-open" href="#${id}" aria-label="View ${label.toLowerCase()} screenshot fullscreen"><img src="${escapeHtml(source ?? url)}" alt="${label} screenshot of ${escapeHtml(displayTarget(report.target))}" loading="lazy"></a>`
      : '<div class="screenshot-unavailable" role="img" aria-label="Screenshot unavailable"><strong>Screenshot unavailable</strong><span>The capture could not be embedded while this report was generated.</span></div>';
    const close = available ? '<a class="screenshot-close" href="#" aria-label="Close fullscreen screenshot">&#215;</a>' : '';
    const instruction = available ? ' · Click to view fullscreen' : '';
    return `<figure class="page-screenshot" id="${id}"><div class="screenshot-label">${label}</div>${close}${image}<figcaption>${label === 'Before' ? 'Latest compatible baseline' : 'Current assessment'}${instruction}</figcaption></figure>`;
  }).join('')}</div></section>`;
}

function renderPage(report: AssessmentReport, options: HtmlReportOptions, index?: number): string {
  const comparison = report.comparison
    ? `Latest compatible run from <strong>${escapeHtml(report.comparison.branch)}</strong>`
    : 'No compatible baseline was available; this run establishes one.';
  return `<section class="page-report">
    <div class="page-heading">
      <div><span class="eyebrow">${index === undefined ? 'Assessed page' : `Page ${index + 1}`}</span><h2>${escapeHtml(displayTarget(report.target))}</h2></div>
      <span class="result-id">Result ${escapeHtml(report.resultId)}</span>
    </div>
    ${renderGate(report.qualityGate)}
    <div class="comparison-note"><span aria-hidden="true">&#8644;</span><span>${comparison}</span></div>
    ${renderScreenshots(report, options)}
    ${renderProfiles(report)}
    <section><div class="section-heading"><div><span class="eyebrow">Measured evidence</span><h2>Metric results</h2></div><span class="count">${report.metrics.length}</span></div><div class="metric-grid">${report.metrics.map((metric) => renderMetric(metric, options)).join('')}</div></section>
  </section>`;
}

function renderFailedPage(report: FailedPageAssessmentReport, index: number): string {
  return `<section class="page-report">
    <div class="page-heading">
      <div><span class="eyebrow">Page ${index + 1}</span><h2>${escapeHtml(displayTarget(report.target))}</h2></div>
      <span class="outcome">Technical failure</span>
    </div>
    ${renderGate(report.qualityGate)}
    <div class="state-card state-failed"><span class="state-icon" aria-hidden="true">&#215;</span><span class="eyebrow">Assessment failed</span><h2>This page could not be completed</h2><p>${escapeHtml(report.reason)}</p></div>
  </section>`;
}

function renderPageResult(report: PageAssessmentReport, options: HtmlReportOptions, index: number): string {
  return report.status === 'completed'
    ? renderPage(report, options, index)
    : renderFailedPage(report, index);
}

function isCompletedPage(value: unknown): value is AssessmentReport {
  const item = record(value);
  return item?.status === 'completed' && typeof item.target === 'string' && Array.isArray(item.metrics) && Array.isArray(item.profileOutcomes);
}

function isCompletedBatch(value: unknown): value is BatchAssessmentReport {
  const item = record(value);
  return item?.schemaVersion === 2
    && (item.status === 'completed' || item.status === 'failed')
    && Array.isArray(item.pages);
}

function renderOverview(report: AssessmentReport | BatchAssessmentReport): string {
  const pages = isCompletedBatch(report) ? report.pages : [report];
  const completedPages = pages.filter((page): page is AssessmentReport => page.status === 'completed');
  const metrics = completedPages.reduce((sum, page) => sum + page.metrics.length, 0);
  const meaningful = completedPages.reduce((sum, page) => sum + page.metrics.filter((metric) => metric.meaningfulChange).length, 0);
  const profiles = completedPages.reduce((sum, page) => sum + page.profileOutcomes.length, 0);
  return `<div class="overview">
    <div><span>Pages</span><strong>${pages.length}</strong></div>
    <div><span>Metrics</span><strong>${metrics}</strong></div>
    <div><span>Profiles</span><strong>${profiles}</strong></div>
    <div><span>Meaningful changes</span><strong>${meaningful}</strong></div>
  </div>`;
}

function renderBody(report: unknown, options: HtmlReportOptions): { status: GateStatus; content: string; meta: GenericReport } {
  const meta = record(report) as GenericReport | undefined ?? {};
  if (isCompletedBatch(report)) {
    return {
      status: gateStatus(report.qualityGate),
      meta,
      content: `${renderOverview(report)}${renderGate(report.qualityGate)}<div class="pages">${report.pages.map((page, index) => renderPageResult(page, options, index)).join('')}</div>`,
    };
  }
  if (isCompletedPage(report)) {
    return { status: gateStatus(report.qualityGate), meta, content: `${renderOverview(report)}${renderPage(report, options)}` };
  }
  const status = text(meta.status, 'failed');
  const skipped = status === 'skipped';
  const reason = text(meta.reason, skipped ? 'This assessment was skipped.' : 'The assessment did not complete.');
  return {
    status: skipped ? 'pass' : 'fail',
    meta,
    content: `<div class="state-card state-${skipped ? 'skipped' : 'failed'}"><span class="state-icon" aria-hidden="true">${skipped ? '&#8212;' : '&#215;'}</span><span class="eyebrow">Assessment ${escapeHtml(status)}</span><h2>${skipped ? 'No assessment was required' : 'Assessment could not be completed'}</h2><p>${escapeHtml(reason)}</p>${meta.qualityGate ? renderGate(meta.qualityGate, true) : ''}</div>`,
  };
}

export function renderHtmlReport(report: unknown, options: HtmlReportOptions = {}): string {
  const generatedAt = options.generatedAt ?? new Date();
  const title = options.title ?? 'UIQLab Web UI Assessment';
  const rendered = renderBody(report, options);
  const branch = text(rendered.meta.branch, 'unknown branch');
  const commit = text(rendered.meta.commitHash);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { --canvas:#f1f4f6; --surface:#fff; --subtle:#eef3f5; --muted-surface:#e4eaee; --ink:#101b24; --soft:#334550; --muted:#52626d; --header:#102f46; --navy:#12364f; --accent:#0b746f; --accent-soft:#d2ebe7; --border:#bcc9d1; --success:#14774f; --success-soft:#def2e8; --warning:#96600f; --warning-soft:#fff2d6; --danger:#aa3434; --danger-soft:#f9e5e5; }
    * { box-sizing:border-box; }
    html { background:var(--canvas); }
    body { margin:0; min-width:320px; color:var(--ink); background:var(--canvas); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
    .shell { max-width:1120px; margin:28px auto; overflow:hidden; border:1px solid var(--border); border-radius:12px; background:var(--surface); box-shadow:0 16px 40px rgba(16,47,70,.16); }
    header { padding:30px 34px 32px; color:#fff; background:var(--header); border-bottom:5px solid var(--accent); }
    .brand { display:flex; align-items:center; justify-content:space-between; gap:24px; }
    .brand-mark { display:grid; place-items:center; width:46px; height:46px; flex:0 0 auto; border-radius:10px; color:#fff; background:var(--accent); font-weight:800; letter-spacing:-.04em; }
    .brand-copy { flex:1; }
    header h1 { margin:2px 0 6px; font-size:30px; line-height:1.12; letter-spacing:-.025em; }
    header p { margin:0; color:#cbd7df; font-size:14px; }
    .header-status { padding:7px 11px; border:1px solid rgba(255,255,255,.25); border-radius:999px; background:rgba(255,255,255,.08); font-size:12px; font-weight:750; white-space:nowrap; }
    .header-status::before { content:""; display:inline-block; width:8px; height:8px; margin-right:7px; border-radius:50%; background:#69c7a2; box-shadow:0 0 0 3px rgba(105,199,162,.14); }
    .header-status.status-warning::before { background:#e7b75d; }.header-status.status-fail::before { background:#ef8f8f; }
    .run-meta { display:flex; flex-wrap:wrap; gap:8px 18px; margin-top:18px; padding:10px 13px; border:1px solid rgba(255,255,255,.22); border-left:4px solid #65c9bd; border-radius:6px; background:rgba(255,255,255,.07); color:#edf5f7; font:12px/1.5 "SFMono-Regular",Consolas,monospace; }
    main { padding:30px 34px 36px; }
    .overview { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:22px; }
    .overview>div { padding:15px 16px; border:1px solid var(--border); border-radius:8px; background:var(--subtle); }
    .overview span,.metric-values span { display:block; color:var(--muted); font-size:11px; font-weight:750; letter-spacing:.04em; text-transform:uppercase; }
    .overview strong { display:block; margin-top:5px; color:var(--navy); font-size:25px; }
    .gate { display:grid; grid-template-columns:auto 1fr; gap:13px; align-items:start; margin:0 0 24px; padding:16px; border:1px solid; border-radius:8px; }
    .gate-pass { color:var(--success); border-color:#a9d6c2; background:var(--success-soft); }.gate-warning { color:var(--warning); border-color:#e7ca8c; background:var(--warning-soft); }.gate-fail { color:var(--danger); border-color:#e0aaaa; background:var(--danger-soft); }
    .gate-icon { display:grid; place-items:center; width:31px; height:31px; border-radius:50%; color:#fff; font-weight:850; }.gate-pass .gate-icon { background:var(--success); }.gate-warning .gate-icon { background:var(--warning); }.gate-fail .gate-icon { background:var(--danger); }
    .gate .eyebrow { color:currentColor; }.gate strong { display:block; margin:2px 0 3px; color:var(--ink); font-size:17px; }.gate p { margin:0; color:var(--soft); font-size:13px; line-height:1.45; }
    .gate-compact { margin:18px 0 0; text-align:left; }
    .pages { display:grid; gap:34px; }.page-report+.page-report { padding-top:32px; border-top:2px solid var(--muted-surface); }
    .page-heading,.section-heading,.profile-heading,.metric-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; }
    .page-heading { margin-bottom:15px; }.page-heading h2 { max-width:850px; margin:4px 0 0; color:var(--navy); font-size:22px; line-height:1.3; overflow-wrap:anywhere; }
    .eyebrow { display:block; color:var(--accent); font-size:10px; font-weight:800; letter-spacing:.09em; text-transform:uppercase; }
    .result-id,.count,.change-badge,.outcome { padding:5px 9px; border-radius:999px; background:var(--muted-surface); color:var(--soft); font-size:11px; font-weight:750; white-space:nowrap; }
    .result-id { max-width:220px; overflow:hidden; text-overflow:ellipsis; font-family:"SFMono-Regular",Consolas,monospace; }
    .comparison-note { display:flex; gap:9px; margin:-10px 0 26px; padding:10px 12px; border-radius:6px; color:var(--soft); background:var(--subtle); font-size:13px; }
    .screenshot-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }.screenshot-grid-single { grid-template-columns:minmax(0,720px); }.page-screenshot { position:relative; min-width:0; margin:0; overflow:hidden; border:1px solid var(--border); border-radius:8px; background:var(--subtle); }.screenshot-open { position:relative; display:block; color:inherit; cursor:zoom-in; }.screenshot-open::after { content:"View fullscreen"; position:absolute; right:10px; bottom:10px; padding:6px 9px; border-radius:5px; color:#fff; background:rgba(16,47,70,.88); font-size:10px; font-weight:750; opacity:0; transform:translateY(3px); transition:opacity .18s ease,transform .18s ease; }.screenshot-open:hover::after,.screenshot-open:focus-visible::after { opacity:1; transform:translateY(0); }.page-screenshot img,.screenshot-unavailable { display:block; width:100%; aspect-ratio:16/9; object-fit:contain; background:#fff; }.screenshot-unavailable { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; padding:34px; color:var(--muted); text-align:center; }.screenshot-unavailable strong { color:var(--soft); font-size:14px; }.screenshot-unavailable span { max-width:330px; font-size:12px; line-height:1.45; }.page-screenshot figcaption { padding:8px 10px; color:var(--muted); font-size:11px; text-align:center; }.screenshot-label { position:absolute; z-index:2; top:9px; left:9px; padding:5px 9px; border-radius:999px; color:#fff; background:rgba(16,47,70,.9); font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; }.screenshot-close { display:none; }.page-screenshot:target { position:fixed; z-index:1000; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; margin:0; padding:48px; overflow:auto; border:0; border-radius:0; background:rgba(5,15,23,.96); }.page-screenshot:target .screenshot-open { display:flex; width:100%; min-height:0; flex:1; align-items:center; justify-content:center; cursor:default; }.page-screenshot:target .screenshot-open::after { display:none; }.page-screenshot:target img { width:auto; max-width:100%; height:auto; max-height:calc(100vh - 120px); aspect-ratio:auto; background:transparent; }.page-screenshot:target figcaption { color:#dbe6eb; }.page-screenshot:target .screenshot-label { top:18px; left:20px; }.page-screenshot:target .screenshot-close { position:fixed; z-index:3; top:14px; right:18px; display:grid; place-items:center; width:38px; height:38px; border:1px solid rgba(255,255,255,.45); border-radius:50%; color:#fff; background:rgba(16,47,70,.92); font-size:25px; line-height:1; text-decoration:none; }
    section section { margin-top:26px; }.section-heading { align-items:center; margin-bottom:12px; }.section-heading h2 { margin:3px 0 0; color:var(--navy); font-size:19px; }.count { min-width:28px; text-align:center; }
    .profile-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:11px; }
    .profile-card { padding:15px; border:1px solid var(--border); border-top:4px solid var(--accent); border-radius:8px; background:var(--surface); }.profile-card.outcome-aligned { border-top-color:var(--success); }.profile-card.outcome-opposed { border-top-color:var(--danger); }.profile-card.outcome-mixed { border-top-color:var(--warning); }
    .profile-card h3 { margin:4px 0 0; color:var(--navy); font-size:16px; text-transform:capitalize; }.profile-card p { margin:12px 0 0; color:var(--soft); font-size:13px; line-height:1.45; }.outcome { color:var(--accent); background:var(--accent-soft); text-transform:capitalize; }.outcome-aligned .outcome { color:var(--success); background:var(--success-soft); }.outcome-opposed .outcome { color:var(--danger); background:var(--danger-soft); }.outcome-mixed .outcome { color:var(--warning); background:var(--warning-soft); }
    .metric-chips { display:flex; flex-wrap:wrap; gap:5px; margin-top:12px; }.metric-chip { padding:4px 7px; border-radius:4px; background:var(--muted-surface); color:var(--soft); font:700 10px "SFMono-Regular",Consolas,monospace; }.metric-chip.aligned { color:var(--success); background:var(--success-soft); }.metric-chip.opposed { color:var(--danger); background:var(--danger-soft); }
    .metric-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:12px; }.metric-card { min-width:0; padding:16px; border:1px solid var(--border); border-radius:8px; background:var(--surface); }.metric-id { color:var(--accent); font:750 10px "SFMono-Regular",Consolas,monospace; text-transform:uppercase; }.metric-card h3 { margin:3px 0 0; color:var(--navy); font-size:16px; }.change-badge.material { color:var(--warning); background:var(--warning-soft); }.change-badge.stable { color:var(--success); background:var(--success-soft); }
    .metric-values { display:grid; grid-template-columns:1fr auto 1fr 1.2fr; gap:9px; align-items:center; margin-top:15px; }.metric-values>div:not(.arrow) { min-width:0; padding:10px; border-radius:6px; background:var(--subtle); }.metric-values strong { display:block; margin-top:4px; color:var(--navy); font-size:18px; overflow-wrap:anywhere; }.metric-values .arrow { color:var(--muted); }.metric-values .delta { border-left:3px solid var(--muted); }.metric-values .delta-up { border-color:var(--accent); }.metric-values .delta-down { border-color:var(--navy); }.metric-values .delta span:last-child { margin-top:3px; color:var(--muted); font-size:11px; }.metric-values-single { grid-template-columns:1fr 1fr; }.baseline-note { color:var(--muted); font-size:12px; line-height:1.4; }
    .metric-visuals { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:9px; margin-top:12px; }.metric-visuals figure { min-width:0; margin:0; overflow:hidden; border:1px solid var(--border); border-radius:6px; background:var(--subtle); }.metric-visuals img { display:block; width:100%; max-height:260px; object-fit:contain; background:#fff; }.metric-visuals figcaption { padding:6px 8px; color:var(--muted); font-size:10px; text-align:center; }
    details { margin-top:12px; border-top:1px solid var(--muted-surface); }.metric-card summary { padding-top:10px; color:var(--muted); cursor:pointer; font-size:11px; font-weight:700; }.metric-card pre { max-height:260px; overflow:auto; margin:10px 0 0; padding:11px; border-radius:5px; color:var(--soft); background:#f5f7f8; font:11px/1.45 "SFMono-Regular",Consolas,monospace; white-space:pre-wrap; overflow-wrap:anywhere; }
    .state-card { max-width:680px; margin:16px auto; padding:34px; border:1px solid var(--border); border-top:5px solid var(--danger); border-radius:10px; text-align:center; }.state-skipped { border-top-color:var(--accent); }.state-icon { display:grid; place-items:center; width:45px; height:45px; margin:0 auto 14px; border-radius:50%; color:#fff; background:var(--danger); font-size:23px; font-weight:800; }.state-skipped .state-icon { background:var(--accent); }.state-card h2 { margin:5px 0 10px; color:var(--navy); }.state-card>p { margin:0; color:var(--soft); line-height:1.55; }
    footer { padding:15px 34px; border-top:1px solid var(--border); color:var(--muted); background:var(--subtle); font-size:11px; text-align:center; }
    @media (max-width:760px) { .shell { margin:0; border-width:0; border-radius:0; }.brand { align-items:flex-start; }.brand-mark { display:none; }.brand { flex-wrap:wrap; }.header-status { order:3; } header,main { padding:22px 18px; }.overview { grid-template-columns:repeat(2,1fr); }.screenshot-grid { grid-template-columns:1fr; }.metric-grid { grid-template-columns:1fr; }.metric-values { grid-template-columns:1fr 1fr; }.metric-values .arrow { display:none; }.page-heading { display:block; }.result-id { display:inline-block; margin-top:9px; } }
    @media (prefers-reduced-motion:reduce) { .screenshot-open::after { transition:none; } }
    @media print { html,body { background:#fff; }.shell { max-width:none; margin:0; border:0; box-shadow:none; }.page-screenshot,.metric-card,.profile-card,.gate,.overview>div { break-inside:avoid; }.screenshot-close,.screenshot-open::after { display:none!important; } details { display:none; } footer { background:#fff; } }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <div class="brand"><span class="brand-mark" aria-hidden="true">UI</span><div class="brand-copy"><span class="eyebrow" style="color:#65c9bd">Automated CI/CD report</span><h1>${escapeHtml(title)}</h1><p>Visual quality evidence, baseline comparisons, and quality-gate decisions.</p></div><span class="header-status status-${rendered.status}">${gateLabel(rendered.status)}</span></div>
      <div class="run-meta"><span>Branch: ${escapeHtml(branch)}</span>${commit ? `<span>Commit: ${escapeHtml(commit)}</span>` : ''}<span>Generated: ${escapeHtml(generatedAt.toISOString())}</span></div>
    </header>
    <main>${rendered.content}</main>
    <footer>Generated automatically by UIQLab CI · The JSON artifact remains the machine-readable source of truth.</footer>
  </div>
</body>
</html>\n`;
}
