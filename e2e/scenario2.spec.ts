import { expect, test } from '@playwright/test';
import { prepare, runScenario } from './helpers';

test.describe('Scenario 2 — Pull Request Steward', () => {
  test.beforeEach(async ({ page }) => {
    await prepare(page);
  });

  test('PR #47 shows the expected diff in Files changed', async ({ page }) => {
    await page.goto('/pulls');
    await page.getByRole('link', { name: 'Invalidate readiness rollup after checklist mutations' }).click();
    await expect(page.getByTestId('pr-state')).toContainText('Open');
    await page.getByTestId('tab-files').click();
    const files = page.getByTestId('files-changed');
    await expect(files).toContainText('src/state/readinessStore.ts');
    await expect(files).toContainText('tests/readinessStore.test.ts');
    await expect(files).toContainText('function mutate(apply: () => void): void {');
  });

  test('steward review posts summary + assessments, proposes inline comments, blocks approve/merge', async ({ page }) => {
    await page.goto('/pulls/47');
    await runScenario(page, 2);

    // Automatic review comments appear in the conversation.
    await expect(page.getByText('PR summary — #47').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Test-gap assessment' })).toBeVisible();
    await expect(page.getByText('tests/e2e/checklist-dialog.spec.ts', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Linked-issue coverage — fixes #42', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('No documentation update required', { exact: false }).first()).toBeVisible();

    // Inline comments wait for approval; approve and merge are blocked.
    const panel = page.getByTestId('steward-panel');
    const pending = panel.locator('.proposal-line[data-status="awaiting_approval"]');
    await expect(pending.filter({ hasText: 'Inline' }).first()).toBeVisible();
    const blocked = panel.locator('.proposal-line[data-status="blocked"]');
    await expect(blocked.filter({ hasText: 'Approve pull request' })).toContainText('pullRequestReview.approvePullRequest is disabled');
    await expect(blocked.filter({ hasText: 'Merge pull request' })).toContainText('safety.autoMerge is false');

    // The merge area exposes the restriction rather than a merge button.
    await expect(page.getByTestId('merge-restriction')).toContainText('Repo Steward can never merge');
    await expect(page.getByRole('button', { name: /^Merge pull request$/ })).toHaveCount(0);

    // PR stays open with no steward review verdict.
    await expect(page.getByTestId('pr-state')).toContainText('Open');

    // Approving an inline comment proposal attaches it in Files changed.
    await page.getByTestId('nav-inbox').click();
    await page
      .getByTestId('inbox-card')
      .filter({ hasText: 'Inline: guard future mutations' })
      .getByTestId('approve-proposal')
      .click();
    await page.goto('/pulls/47?tab=files');
    await expect(page.getByTestId('files-changed')).toContainText('every exported mutation MUST route through mutate()');
  });
});
