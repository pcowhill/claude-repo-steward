import { expect, test } from '@playwright/test';
import { prepare, loadScenario } from './helpers';

test.describe('Live AI mode degrades gracefully', () => {
  test('unconfigured Live AI fails non-destructively with a clear message', async ({ page }) => {
    await prepare(page);
    await page.goto('/issues/42');

    // Selecting Live AI without keys warns immediately…
    await page.getByTestId('mode-select').selectOption('live');
    await expect(page.locator('.toast').first()).toContainText(/not configured|unreachable/i);

    // …and running still works end-to-end as a failed, non-destructive run.
    await loadScenario(page, 1);
    await page.getByTestId('run-steward-panel').click();
    await expect(page.getByTestId('steward-status')).toContainText('Last run failed', { timeout: 20_000 });
    await expect(page.getByTestId('steward-panel')).toContainText(/Live AI mode is not configured|Analysis failed/);

    // Repository state is untouched.
    await expect(page.getByTestId('issue-labels')).not.toContainText('bug');
    await expect(page.getByTestId('issue-labels')).toContainText('needs-triage');

    // Switching back to scripted mode recovers fully.
    await page.getByTestId('mode-select').selectOption('scripted');
    await page.getByTestId('run-steward-panel').click();
    await expect(page.getByTestId('steward-status')).toContainText('Steward idle', { timeout: 20_000 });
    await expect(page.getByTestId('issue-labels')).toContainText('bug');
  });
});
