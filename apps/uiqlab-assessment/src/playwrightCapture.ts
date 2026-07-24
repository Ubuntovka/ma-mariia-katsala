import { chromium, Browser, Page } from 'playwright-core';

export interface CaptureResult {
  screenshot: Buffer;
  html: string;
  requestedUrl: string;
  finalUrl: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  timestamp: string;
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function capturePage(url: string, timeoutMs = 30000): Promise<CaptureResult> {
  if (!isHttpUrl(url)) {
    throw new Error('Invalid URL: must be http:// or https://');
  }

  let browser: Browser | undefined;
  const viewport = { width: 1200, height: 1200 };
  const deviceScaleFactor = 2;
  const timestamp = new Date().toISOString();

  try {
    try {
      browser = await chromium.launch({ headless: true });
    } catch (err: any) {
      throw new Error(`Failed to launch browser: ${err?.message ?? err}`);
    }

    const context = await browser.newContext({
      viewport,
      deviceScaleFactor,
      colorScheme: 'light',
    });

    const page = await context.newPage();

    page.setDefaultNavigationTimeout(timeoutMs);

    try {
      const response = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
      if (!response) {
        throw new Error('Navigation failed: no response received');
      }
    } catch (err: any) {
      throw new Error(`Navigation failed: ${err?.message ?? err}`);
    }

    // Wait until document.readyState === 'complete'
    try {
      await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: timeoutMs });
    } catch (err: any) {
      // continue; we'll still wait extra time below
    }

    // Wait additional 5 seconds for dynamic content
    await page.waitForTimeout(5000);

    // Disable animations by injecting CSS
    await page.addStyleTag({ content: `*, *::before, *::after { animation: none !important; transition: none !important; }` });

    // Capture screenshot with fixed viewport (not fullPage)
    let screenshot: Buffer;
    try {
      const buf = await page.screenshot({ type: 'png', fullPage: false });
      screenshot = Buffer.from(buf);
    } catch (err: any) {
      throw new Error(`Screenshot failed: ${err?.message ?? err}`);
    }

    // Capture rendered HTML
    let html: string;
    try {
      html = await page.content();
    } catch (err: any) {
      throw new Error(`Failed to get page content: ${err?.message ?? err}`);
    }

    const finalUrl = page.url();

    return {
      screenshot,
      html,
      requestedUrl: url,
      finalUrl,
      viewport,
      deviceScaleFactor,
      timestamp,
    };
  } finally {
    try {
      if (browser) {
        await browser.close();
      }
    } catch {
      // ignore
    }
  }
}
