import { chromium, Browser, Page } from 'playwright-core';

// Reserve space below Nginx's default 1 MiB request-body limit for the
// multipart boundaries, metric IDs, and project metadata.
const MAX_SCREENSHOT_BYTES = 900 * 1024;

export interface CaptureResult {
  screenshot: Buffer;
  html: string;
  requestedUrl: string;
  finalUrl: string;
  viewport: { width: number; height: number };
  screenshotDimensions: { width: number; height: number };
  deviceScaleFactor: number;
  timestamp: string;
}

export function getPngDimensions(png: Buffer): { width: number; height: number } {
  const pngSignature = '89504e470d0a1a0a';
  if (png.length < 24 || png.subarray(0, 8).toString('hex') !== pngSignature) {
    throw new Error('Could not read dimensions from the captured PNG');
  }
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

async function resizePng(page: Page, png: Buffer, width: number, height: number): Promise<Buffer> {
  const resized = await page.evaluate(async ({ encodedPng, targetWidth, targetHeight }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${encodedPng}`;
    await image.decode();

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not create a canvas context for screenshot resizing');
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, targetWidth, targetHeight);

    return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
  }, {
    encodedPng: png.toString('base64'),
    targetWidth: width,
    targetHeight: height,
  });

  return Buffer.from(resized, 'base64');
}

async function fitScreenshotToUploadLimit(
  page: Page,
  screenshot: Buffer,
  initialWidth: number,
  initialHeight: number,
): Promise<Buffer> {
  let fitted = screenshot;
  let width = initialWidth;
  let height = initialHeight;

  while (fitted.length > MAX_SCREENSHOT_BYTES && (width > 1 || height > 1)) {
    // PNG size is approximately proportional to pixel count. The extra
    // headroom accounts for content whose compression ratio changes on resize.
    const ratio = Math.min(0.85, Math.sqrt(MAX_SCREENSHOT_BYTES / fitted.length) * 0.9);
    const nextWidth = Math.max(1, Math.min(width - 1, Math.floor(width * ratio)));
    const nextHeight = Math.max(1, Math.min(height - 1, Math.floor(height * ratio)));
    fitted = await resizePng(page, fitted, nextWidth, nextHeight);
    width = nextWidth;
    height = nextHeight;
  }

  if (fitted.length > MAX_SCREENSHOT_BYTES) {
    throw new Error(`Could not reduce screenshot below ${MAX_SCREENSHOT_BYTES} bytes`);
  }
  return fitted;
}

export async function capturePage(url: string, timeoutMs = 30000): Promise<CaptureResult> {
  if (!isHttpUrl(url)) {
    throw new Error('Invalid URL: must be http:// or https://');
  }

  let browser: Browser | undefined;
  const viewport = { width: 1440, height: 900 };
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
      // const buf = await page.screenshot({ type: 'png', fullPage: false });
      const buf = await page.screenshot({
        type: 'png',
        fullPage: false,
        scale: 'css',
      });
      screenshot = await fitScreenshotToUploadLimit(
        page,
        Buffer.from(buf),
        viewport.width,
        viewport.height,
      );
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
    const screenshotDimensions = getPngDimensions(screenshot);

    return {
      screenshot,
      html,
      requestedUrl: url,
      finalUrl,
      viewport,
      screenshotDimensions,
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
