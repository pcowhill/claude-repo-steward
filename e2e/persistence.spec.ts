import { expect, test } from '@playwright/test';
import { prepare, runScenario } from './helpers';

test.describe('Persistence and reset', () => {
  test.beforeEach(async ({ page }) => {
    await prepare(page);
  });

  test('scenario progress survives a reload', async ({ page }) => {
    await page.goto('/issues/42');
    await runScenario(page, 1);
    await expect(page.getByTestId('issue-labels')).toContainText('bug');

    await page.reload();
    await expect(page.getByTestId('issue-labels')).toContainText('bug');
    await expect(page.getByTestId('current-scenario')).toContainText('Scenario 1');
    // Steward comments are still on the timeline after reload.
    await expect(page.getByText('Readiness assessment — issue #42')).toBeVisible();
    // Inbox still holds the pending proposals.
    await page.getByTestId('nav-inbox').click();
    await expect(page.getByTestId('inbox-card').first()).toBeVisible();
  });

  test('reset entire demo restores the seed state after confirmation', async ({ page }) => {
    await page.goto('/issues/42');
    await runScenario(page, 1);
    await expect(page.getByTestId('issue-labels')).toContainText('bug');

    await page.getByTestId('demo-controls-button').click();
    await page.getByTestId('reset-demo').click();
    await page.getByRole('button', { name: 'Reset everything' }).click();

    await expect(page.getByTestId('issue-labels')).not.toContainText('bug');
    await expect(page.getByTestId('issue-labels')).toContainText('needs-triage');
    await page.getByTestId('nav-inbox').click();
    await expect(page.getByText('Inbox zero')).toBeVisible();
  });

  test('reset current scenario returns to the pre-run checkpoint', async ({ page }) => {
    await page.goto('/issues/42');
    await runScenario(page, 1);
    await expect(page.getByTestId('issue-labels')).toContainText('bug');

    await page.getByTestId('demo-controls-button').click();
    await page.getByTestId('reset-scenario').click();
    await expect(page.getByTestId('issue-labels')).not.toContainText('bug');
    await expect(page.getByTestId('current-scenario')).toContainText('Scenario 1');
  });

  test('snapshot jumps move between pipeline stages', async ({ page }) => {
    await page.goto('/issues/42');
    await runScenario(page, 1);

    await page.getByTestId('demo-controls-button').click();
    await page.getByRole('button', { name: 'After policy' }).click();
    await expect(page.getByTestId('issue-labels')).not.toContainText('bug');

    await page.getByTestId('demo-controls-button').click();
    await page.getByRole('button', { name: 'After execution' }).click();
    await expect(page.getByTestId('issue-labels')).toContainText('bug');
  });
});
