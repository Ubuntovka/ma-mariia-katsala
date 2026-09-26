#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { loadConfig, matchesBranch } from './config.js';
import {
  buildBatchReport,
  buildFailedPageReport,
  buildReport,
  formatBatchSummary,
  formatSummary,
  type AssessmentReport,
  type PageAssessmentReport,
} from './report.js';
import { qualityGateExitCode, type QualityGateMode } from './qualityGate.js';
import { jsonRequest } from './http.js';
import { pollEvaluationResult } from './poll.js';
import { assessPagesSequentially, pageTarget } from './workflow.js';
import { renderHtmlReportWithEmbeddedImages } from './htmlReport.js';
import { validateHistoryResponse, validateScalarMetricValues, validateSubmissionResponse } from './apiValidation.js';

interface GitMetadata {
  branch?: string;
  commitHash?: string;
  repositoryUrl?: string;
  mergeRequestId?: string;
}

let activeReportPath = 'uiqlab-report.json';
let activeHtmlReportPath = 'uiqlab-report.html';
let activeQualityGateMode: QualityGateMode = 'warn';
let activeRequireBaseline = false;
let activeAssessment: AssessmentReport['assessment'] | undefined;
let activeBatch = false;

function argument(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function resolveWarningExitCode(): 0 | 2 {
  const index = process.argv.indexOf('--warning-exit-code');
  const value = index >= 0
    ? process.argv[index + 1]
    : process.env.UIQLAB_WARNING_EXIT_CODE ?? '2';
  if (value !== '0' && value !== '2') {
    throw new Error('--warning-exit-code and UIQLAB_WARNING_EXIT_CODE must be either 0 or 2.');
  }
  return value === '0' ? 0 : 2;
}

async function writeReportArtifacts(report: unknown, reportPath: string, htmlReportPath: string): Promise<void> {
  const html = await renderHtmlReportWithEmbeddedImages(report);
  await Promise.all([
    writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`),
    writeFile(htmlReportPath, html),
  ]);
}

function git(...args: string[]): string | undefined {
  try { return execFileSync('git', args, { encoding: 'utf8' }).trim(); } catch { return undefined; }
}

function safeRepositoryUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return value;
  }
}

function metadata(): GitMetadata {
  const githubRepositoryUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}.git`
    : undefined;
  const result: GitMetadata = {};
  const branch = argument('--branch', process.env.UIQLAB_BRANCH ?? process.env.CI_COMMIT_BRANCH ?? process.env.GITHUB_HEAD_REF ?? process.env.GITHUB_REF_NAME ?? git('branch', '--show-current'));
  const commitHash = process.env.UIQLAB_COMMIT_SHA ?? process.env.CI_COMMIT_SHA ?? process.env.GITHUB_SHA ?? git('rev-parse', 'HEAD');
  const repositoryUrl = safeRepositoryUrl(process.env.UIQLAB_REPOSITORY_URL ?? process.env.CI_PROJECT_URL ?? githubRepositoryUrl ?? process.env.CI_REPOSITORY_URL ?? git('config', '--get', 'remote.origin.url'));
  const mergeRequestId = process.env.UIQLAB_MERGE_REQUEST_ID ?? process.env.CI_MERGE_REQUEST_IID ?? process.env.GITHUB_REF?.match(/refs\/pull\/(\d+)/)?.[1];
  if (branch) result.branch = branch;
  if (commitHash) result.commitHash = commitHash;
  if (repositoryUrl) result.repositoryUrl = repositoryUrl;
  if (mergeRequestId) result.mergeRequestId = mergeRequestId;
  return result;
}

interface PageAssessmentInput {
  target: string;
  metrics: string[];
  assessment: AssessmentReport['assessment'];
  qualityGateMode: QualityGateMode;
  requireBaseline: boolean;
}

async function assessPage(
  page: PageAssessmentInput,
  baseUrl: string,
  config: Awaited<ReturnType<typeof loadConfig>>,
  meta: GitMetadata & { branch: string; repositoryUrl: string },
): Promise<AssessmentReport> {
  activeAssessment = page.assessment;
  activeQualityGateMode = page.qualityGateMode;
  activeRequireBaseline = page.requireBaseline;
  const submission = validateSubmissionResponse(await jsonRequest<unknown>(`${baseUrl}/eval/evaluate_url_input_test`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: page.target,
      metrics: page.metrics,
      assessment: page.assessment,
      projectKey: config.projectKey,
      projectName: config.projectName,
      repositoryUrl: meta.repositoryUrl,
      source: 'ci/cd',
      branch: meta.branch,
      commitHash: meta.commitHash,
      gitDirty: false,
      mergeRequestId: meta.mergeRequestId,
    }),
  }));
  const results = await pollEvaluationResult(baseUrl, submission.result_id, page.metrics, config.timeoutMs, config.pollIntervalMs);
  const failedMetrics = results.filter((item) => item.results.length === 0);
  if (failedMetrics.length) throw new Error(`Assessment failed technically for: ${failedMetrics.map((item) => item.metric_id).join(', ')}`);
  validateScalarMetricValues(results);
  const query = new URLSearchParams({ baseline_branch: config.baselineBranch });
  const history = validateHistoryResponse(
    await jsonRequest<unknown>(`${baseUrl}/eval/result/${encodeURIComponent(submission.result_id)}/history?${query}`),
    {
      expectedMetricIds: results.map((result) => result.metric_id),
      expectedBaselineBranch: config.baselineBranch,
    },
  );
  const currentScreenshotId = history.currentRun?.screenshotResultId ?? submission.result_id;
  const baselineScreenshotId = history.baselineRun?.screenshotResultId;
  return buildReport({
    target: page.target,
    branch: meta.branch,
    ...(meta.commitHash ? { commitHash: meta.commitHash } : {}),
    resultId: submission.result_id,
    baselineBranch: config.baselineBranch,
    results,
    history,
    assessment: page.assessment,
    qualityGateMode: page.qualityGateMode,
    requireBaseline: page.requireBaseline,
    screenshots: {
      current: `${baseUrl}/eval/result/${encodeURIComponent(currentScreenshotId)}/screenshot.png`,
      ...(baselineScreenshotId
        ? { baseline: `${baseUrl}/eval/result/${encodeURIComponent(baselineScreenshotId)}/screenshot.png` }
        : {}),
    },
  });
}

async function main(): Promise<void> {
  const configPath = argument('--config', process.env.UIQLAB_CONFIG ?? '.uiqlab.json') ?? '.uiqlab.json';
  const reportPath = argument('--report', process.env.UIQLAB_REPORT ?? 'uiqlab-report.json') ?? 'uiqlab-report.json';
  const htmlReportPath = argument('--html-report', process.env.UIQLAB_HTML_REPORT ?? 'uiqlab-report.html') ?? 'uiqlab-report.html';
  activeReportPath = reportPath;
  activeHtmlReportPath = htmlReportPath;
  const warningExitCode = resolveWarningExitCode();
  const baseUrl = argument('--orchestrator-url', process.env.UIQLAB_ORCHESTRATOR_URL)?.replace(/\/$/, '');
  const previewUrl = argument('--url', process.env.UIQLAB_PREVIEW_URL);
  const config = await loadConfig(configPath);
  activeQualityGateMode = config.qualityGateMode;
  activeRequireBaseline = config.requireBaseline;
  activeAssessment = config.assessment;
  activeBatch = config.pages.length > 0;
  const meta = metadata();
  if (!meta.branch) throw new Error('Could not determine the CI branch. Set UIQLAB_BRANCH.');
  if (!matchesBranch(meta.branch, config.branches)) {
    const skipped = activeBatch
      ? { schemaVersion: 2, status: 'skipped', reason: `Branch ${meta.branch} does not match ci.branches.`, branch: meta.branch, source: 'ci/cd', pages: config.pages.map((page) => ({ path: page.path, assessment: { mode: 'profiles', profiles: page.profiles }, qualityGate: { mode: page.qualityGateMode, status: 'pass', reason: 'The branch trigger skipped this page assessment.', requireBaseline: page.requireBaseline } })), qualityGate: { mode: 'per-page', status: 'pass', reason: 'The branch trigger skipped this assessment.' } }
      : { schemaVersion: 1, status: 'skipped', reason: `Branch ${meta.branch} does not match ci.branches.`, branch: meta.branch, source: 'ci/cd', assessment: config.assessment, profileOutcomes: [], qualityGate: { mode: config.qualityGateMode, status: 'pass', reason: 'The branch trigger skipped this assessment.', requireBaseline: config.requireBaseline } };
    await writeReportArtifacts(skipped, reportPath, htmlReportPath);
    console.log(`Web UI Assessment\n\nSkipped: branch "${meta.branch}" does not match ci.branches.`);
    return;
  }
  if (!baseUrl) throw new Error('UIQLAB_ORCHESTRATOR_URL is required.');
  if (!previewUrl) throw new Error('UIQLAB_PREVIEW_URL is required for an assessed branch.');
  if (!meta.repositoryUrl) throw new Error('Could not determine repository URL. Set UIQLAB_REPOSITORY_URL.');
  new URL(previewUrl);
  const assessedMeta: GitMetadata & { branch: string; repositoryUrl: string } = {
    ...meta,
    branch: meta.branch,
    repositoryUrl: meta.repositoryUrl,
  };

  const pages: PageAssessmentInput[] = config.pages.length > 0
    ? config.pages.map((page) => ({
      target: pageTarget(previewUrl, page.path),
      metrics: page.metrics,
      assessment: { mode: 'profiles', profiles: page.profiles },
      qualityGateMode: page.qualityGateMode,
      requireBaseline: page.requireBaseline,
    }))
    : [{ target: previewUrl, metrics: config.metrics, assessment: config.assessment, qualityGateMode: config.qualityGateMode, requireBaseline: config.requireBaseline }];
  const reports = await assessPagesSequentially(pages, async (page, index) => {
    if (pages.length > 1) console.log(`Assessing page ${index + 1}/${pages.length}: ${page.target}`);
    try {
      return await assessPage(page, baseUrl, config, assessedMeta);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Page ${index + 1}/${pages.length} (${page.target}) failed: ${message}`);
      return buildFailedPageReport({
        target: page.target,
        branch: assessedMeta.branch,
        ...(meta.commitHash ? { commitHash: meta.commitHash } : {}),
        assessment: page.assessment,
        qualityGateMode: page.qualityGateMode,
        requireBaseline: page.requireBaseline,
        reason: message,
      });
    }
  }) satisfies PageAssessmentReport[];

  if (activeBatch) {
    const report = buildBatchReport(reports, meta.branch, meta.commitHash);
    await writeReportArtifacts(report, reportPath, htmlReportPath);
    console.log(formatBatchSummary(report, config.baselineBranch, warningExitCode));
    process.exitCode = qualityGateExitCode(report.qualityGate, warningExitCode);
  } else {
    const report = reports[0];
    if (!report) throw new Error('No page assessment was completed.');
    await writeReportArtifacts(report, reportPath, htmlReportPath);
    if (report.status === 'completed') {
      console.log(formatSummary(report, config.baselineBranch, warningExitCode));
    } else {
      console.error(`Web UI Assessment\n\nAssessment failed because of a technical error.\n${report.reason}`);
    }
    process.exitCode = qualityGateExitCode(report.qualityGate, warningExitCode);
  }
}

main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Web UI Assessment\n\nAssessment failed because of a technical error.\n${message}`);
  const failureReport = {
    schemaVersion: activeBatch ? 2 : 1,
    status: 'failed',
    source: 'ci/cd',
    reason: message,
    ...(activeAssessment ? { assessment: activeAssessment } : {}),
    profileOutcomes: [],
    qualityGate: { mode: activeQualityGateMode, status: 'fail', reason: 'A technical error prevented the assessment from completing.', requireBaseline: activeRequireBaseline },
  };
  try {
    await writeReportArtifacts(failureReport, activeReportPath, activeHtmlReportPath);
  } catch (reportError) {
    console.error(`Could not write report artifacts: ${reportError instanceof Error ? reportError.message : String(reportError)}`);
  }
  process.exitCode = 1;
});
