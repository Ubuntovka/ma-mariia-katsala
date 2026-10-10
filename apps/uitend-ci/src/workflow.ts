export function pageTarget(previewUrl: string, path: string): string {
  const target = new URL(previewUrl);
  target.search = '';
  target.hash = '';
  const basePath = target.pathname === '/' ? '' : target.pathname.replace(/\/+$/, '');
  target.pathname = `${basePath}${path}`;
  return target.toString();
}

export async function assessPagesSequentially<Page, Result>(
  pages: readonly Page[],
  assess: (page: Page, index: number) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = [];
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    if (page === undefined) continue;
    results.push(await assess(page, index));
  }
  return results;
}
