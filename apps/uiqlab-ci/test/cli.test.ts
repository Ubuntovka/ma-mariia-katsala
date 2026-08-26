import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

function respond(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

async function requestJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

async function runCli(directory: string, baseUrl: string, extraArgs: string[] = []): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const args = [
    cli,
    '--config', join(directory, '.uiqlab.json'),
    '--url', 'https://preview.example.com',
    '--orchestrator-url', baseUrl,
    '--report', join(directory, 'report.json'),
    '--html-report', join(directory, 'report.html'),
    '--branch', 'main',
    ...extraArgs,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: directory,
      env: {
        ...process.env,
        UIQLAB_REPOSITORY_URL: 'https://git.example.com/team/project.git',
        UIQLAB_COMMIT_SHA: 'abc123',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port.');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test('CLI can keep warning reports non-blocking with warning exit code 0', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'uiqlab-cli-'));
  await writeFile(join(directory, '.uiqlab.json'), JSON.stringify({
    projectKey: '123e4567-e89b-12d3-a456-426614174000',
    assessment: { mode: 'profiles', profiles: [{ id: 'accessibility', direction: 'reduce-issues' }] },
    qualityGate: { mode: 'warn' },
    ci: { branches: ['main'], baselineBranch: 'main', pollIntervalMs: 1 },
  }));
  const server = await listen((request, response) => {
    if (request.method === 'POST') return void respond(response, 200, { result_id: 'run-warning' });
    if (request.url?.includes('/history')) return void respond(response, 200, {
      baselineRun: { id: 1, branch: 'main' },
      metrics: { m13_accessibility: { results: [{ violations: [{ id: 'label', nodes: [{}] }] }] } },
    });
    respond(response, 200, [{ metric_id: 'm13_accessibility', results: [{ violations: [{ id: 'label', nodes: [{}, {}] }] }] }]);
  });
  try {
    const result = await runCli(directory, server.baseUrl, ['--warning-exit-code', '0']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Quality gate: WARNING/);
    assert.match(result.stdout, /Exit code: 0/);
    const report = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8')) as { qualityGate: { status: string } };
    assert.equal(report.qualityGate.status, 'warning');
  } finally {
    await server.close();
  }
});

test('CLI retains a completed page when a later page fails technically', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'uiqlab-cli-'));
  await writeFile(join(directory, '.uiqlab.json'), JSON.stringify({
    projectKey: '123e4567-e89b-12d3-a456-426614174000',
    ci: {
      branches: ['main'], baselineBranch: 'main', pollIntervalMs: 1,
      pages: [
        { path: '/ok', profiles: [{ id: 'accessibility', direction: 'observe' }], qualityGate: { mode: 'report' } },
        { path: '/fails', profiles: [{ id: 'accessibility', direction: 'reduce-issues' }], qualityGate: { mode: 'enforce', requireBaseline: true } },
      ],
    },
  }));
  const server = await listen((request, response) => {
    if (request.method === 'POST') {
      void requestJson(request).then((body) => {
        if (String(body.url).endsWith('/fails')) respond(response, 503, { detail: 'backend unavailable' });
        else respond(response, 200, { result_id: 'run-ok' });
      });
      return;
    }
    if (request.url?.includes('/history')) return void respond(response, 200, {});
    respond(response, 200, [{ metric_id: 'm13_accessibility', results: [{ violations: [] }] }]);
  });
  try {
    const result = await runCli(directory, server.baseUrl);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Page 2\/2.*failed/);
    const report = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8')) as {
      status: string;
      pages: Array<{ status: string; target: string; reason?: string }>;
    };
    assert.equal(report.status, 'failed');
    assert.deepEqual(report.pages.map((page) => page.status), ['completed', 'failed']);
    assert.match(report.pages[1]?.reason ?? '', /HTTP 503/);
    assert.match(await readFile(join(directory, 'report.html'), 'utf8'), /This page could not be completed/);
  } finally {
    await server.close();
  }
});
