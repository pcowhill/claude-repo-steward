import { expect, type Page } from '@playwright/test';

/** Fresh simulator per test: clear persisted state once per tab, then run
 * with collapsed demo latency so scenario runs finish in well under a second. */
export async function prepare(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-seeded')) {
      localStorage.clear();
      sessionStorage.setItem('e2e-seeded', '1');
    }
    localStorage.setItem('repo-steward:latency', 'fast');
  });
}

export async function loadScenario(page: Page, id: 1 | 2 | 3): Promise<void> {
  await page.getByTestId('demo-controls-button').click();
  await page.getByTestId(`load-scenario-${id}`).click();
}

/** Run the loaded scenario from the contextual panel and wait for completion. */
export async function runStewardFromPanel(page: Page): Promise<void> {
  await page.getByTestId('run-steward-panel').click();
  await expect(page.getByTestId('steward-status')).toContainText('Steward idle', { timeout: 20_000 });
}

export async function runScenario(page: Page, id: 1 | 2 | 3): Promise<void> {
  await loadScenario(page, id);
  await runStewardFromPanel(page);
}
