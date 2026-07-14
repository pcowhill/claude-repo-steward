import { expect, test } from '@playwright/test';
import { prepare, runScenario } from './helpers';

test.describe('Scenario 3 — Documentation Steward', () => {
  test.beforeEach(async ({ page }) => {
    await prepare(page);
  });

  test('detects drift, waits for approval, then creates branch + commit + draft PR', async ({ page }) => {
    await page.goto('/pulls/39');
    await expect(page.getByTestId('pr-state')).toContainText('Merged');
    await runScenario(page, 3);

    // Drift assessment posted automatically on the merged PR.
    await expect(page.getByText('Documentation drift detected — PR #39').first()).toBeVisible();

    // Draft PR creation waits in the inbox with a docs-only diff preview.
    await page.getByTestId('nav-inbox').click();
    const card = page.getByTestId('inbox-card').filter({ hasText: 'Open draft docs PR' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('documentation.openDraftPullRequest');
    const preview = card.getByTestId('docs-diff-preview');
    await expect(preview).toContainText('docs/status-semantics.md');
    await expect(preview).toContainText('docs/operator-guide.md');
    await expect(preview).not.toContainText('src/');

    // Nothing exists until approval.
    await page.goto('/branches');
    await expect(page.getByTestId('branch-row-repo-steward-docs-pr-39')).toHaveCount(0);

    // Approve → branch, steward commit, draft PR #48.
    await page.getByTestId('nav-inbox').click();
    await card.getByTestId('approve-proposal').click();
    // Approved proposals leave the pending view.
    await expect(card).toHaveCount(0);

    await page.goto('/branches');
    const branchRow = page.getByTestId('branch-row-repo-steward-docs-pr-39');
    await expect(branchRow).toBeVisible();
    await expect(branchRow).toContainText('created by steward');
    await expect(branchRow).toContainText('1 ahead');

    // Draft PR #48 with a docs-only diff.
    await page.goto('/pulls/48');
    await expect(page.getByTestId('pr-state')).toContainText('Draft');
    await expect(page.getByText('docs: document the deferred checklist status (follow-up to #39)').first()).toBeVisible();
    await page.getByTestId('tab-files').click();
    const files = page.getByTestId('files-changed');
    await expect(files).toContainText('docs/status-semantics.md');
    await expect(files).toContainText('docs/operator-guide.md');
    await expect(files).toContainText('2 changed files');
    await expect(files).not.toContainText('src/state');

    // The branch is browsable and shows the updated documentation (markdown
    // files render as a preview by default).
    await page.goto('/code/repo-steward/docs-pr-39/docs/status-semantics.md');
    await expect(page.locator('.page .md')).toContainText('deferred');
    // …while main still has the stale version.
    await page.goto('/code/main/docs/status-semantics.md');
    await expect(page.locator('.page .md')).toBeVisible();
    await expect(page.locator('.page .md')).not.toContainText('deferred');

    // Source files on the steward branch are identical to main.
    await page.goto('/pulls/48?tab=files');
    await expect(page.getByTestId('files-changed')).not.toContainText('readinessStore');
  });

  test('rejecting the proposal creates nothing and audits the decision', async ({ page }) => {
    await page.goto('/pulls/39');
    await runScenario(page, 3);
    await page.getByTestId('nav-inbox').click();
    const card = page.getByTestId('inbox-card').filter({ hasText: 'Open draft docs PR' });
    await card.getByTestId('reject-proposal').click();
    await page.getByTestId('reject-reason').fill('Docs freeze until W-1');
    await page.getByTestId('confirm-reject').click();

    await page.goto('/branches');
    await expect(page.getByTestId('branch-row-repo-steward-docs-pr-39')).toHaveCount(0);
    await page.goto('/pulls/48');
    await expect(page.getByText('Pull request #48 not found')).toBeVisible();
    await page.goto('/activity');
    await expect(page.getByTestId('audit-log')).toContainText('Docs freeze until W-1');
  });
});
