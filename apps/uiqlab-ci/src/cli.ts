#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { loadConfig, matchesBranch } from './config.js';
import { buildReport, formatSummary, type AssessmentHistory } from './report.js';
import { jsonRequest } from './http.js';
import { pollEvaluationResult } from './poll.js';

interface GitMetadata {
  branch?: string;
  commitHash?: string;
  repositoryUrl?: string;
  mergeRequestId?: string;
}

function argument(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
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

async function main(): Promise<void> {
  const configPath = argument('--config', process.env.UIQLAB_CONFIG ?? '.uiqlab.json') ?? '.uiqlab.json';
  const reportPath = argument('--report', process.env.UIQLAB_REPORT ?? 'uiqlab-report.json') ?? 'uiqlab-report.json';
  const baseUrl = argument('--orchestrator-url', process.env.UIQLAB_ORCHESTRATOR_URL)?.replace(/\/$/, '');
  const target = argument('--url', process.env.UIQLAB_PREVIEW_URL);
  const config = await loadConfig(configPath);
  const meta = metadata();
  if (!meta.branch) throw new Error('Could not determine the CI branch. Set UIQLAB_BRANCH.');
  if (!matchesBranch(meta.branch, config.branches)) {
    await writeFile(reportPath, `${JSON.stringify({ schemaVersion: 1, status: 'skipped', reason: `Branch ${meta.branch} does not match ci.branches.`, branch: meta.branch, source: 'ci/cd' }, null, 2)}\n`);
    console.log(`Web UI Assessment\n\nSkipped: branch "${meta.branch}" does not match ci.branches.`);
    return;
  }
  if (!baseUrl) throw new Error('UIQLAB_ORCHESTRATOR_URL is required.');
  if (!target) throw new Error('UIQLAB_PREVIEW_URL is required for an assessed branch.');
  if (!meta.repositoryUrl) throw new Error('Could not determine repository URL. Set UIQLAB_REPOSITORY_URL.');
  new URL(target);

  const submission = await jsonRequest<{ result_id?: unknown }>(`${baseUrl}/eval/evaluate_url_input_test`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: target, metrics: config.metrics, projectKey: config.projectKey, projectName: config.projectName, repositoryUrl: meta.repositoryUrl, source: 'ci/cd', branch: meta.branch, commitHash: meta.commitHash, gitDirty: false, mergeRequestId: meta.mergeRequestId }),
  });
  if (typeof submission.result_id !== 'string') throw new Error('Orchestrator response did not contain result_id.');
  const results = await pollEvaluationResult(baseUrl, submission.result_id, config.metrics.length, config.timeoutMs, config.pollIntervalMs);
  const failedMetrics = results.filter((item) => item.results.length === 0);
  if (failedMetrics.length) throw new Error(`Assessment failed technically for: ${failedMetrics.map((item) => item.metric_id).join(', ')}`);
  const query = new URLSearchParams({ baseline_branch: config.baselineBranch });
  const history = await jsonRequest<AssessmentHistory>(`${baseUrl}/eval/result/${encodeURIComponent(submission.result_id)}/history?${query}`);
  const report = buildReport({ target, branch: meta.branch, ...(meta.commitHash ? { commitHash: meta.commitHash } : {}), resultId: submission.result_id, baselineBranch: config.baselineBranch, results, history });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(formatSummary(report, config.baselineBranch));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Web UI Assessment\n\nAssessment failed because of a technical error.\n${message}`);
  process.exitCode = 1;
});
