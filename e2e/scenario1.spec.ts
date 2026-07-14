import { expect, test } from '@playwright/test';
import { prepare, runScenario } from './helpers';

test.describe('Scenario 1 — Issue Steward', () => {
  test.beforeEach(async ({ page }) => {
    await prepare(page);
  });

  test('issue #42 is browsable before any steward run', async ({ page }) => {
    await page.goto('/issues');
    const row = page.getByRole('link', { name: 'Readiness board remains green after checklist edit' });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByText('Refreshing the page made the board correctly show a blocked state', { exact: false })).toBeVisible();
    await expect(page.getByTestId('issue-labels')).toContainText('needs-triage');
  });

  test('running the steward labels the issue, comments, proposes and blocks', async ({ page }) => {
    await page.goto('/issues/42');
    await runScenario(page, 1);

    // Labels applied automatically.
    const labels = page.getByTestId('issue-labels');
    for (const label of ['bug', 'frontend', 'state-management', 'high-impact']) {
      await expect(labels).toContainText(label);
    }

    // Steward comments appear on the timeline (assessment, questions, plan).
    const stewardComments = page.locator('.comment-box.steward');
    await expect(stewardComments.nth(2)).toBeVisible();
    await expect(page.getByText('Readiness assessment — issue #42').first()).toBeVisible();
    await expect(page.getByText('Proposed implementation plan').first()).toBeVisible();

    // Timeline shows the label events by the bot.
    await expect(page.locator('.timeline-event-line', { hasText: 'added the' }).filter({ hasText: 'repo-steward' }).first()).toBeVisible();

    // Panel shows the three-way outcome split with policy rules.
    const panel = page.getByTestId('steward-panel');
    await expect(panel.getByText('Executed automatically', { exact: false }).first()).toBeVisible();
    await expect(panel.getByText('Awaiting approval', { exact: false }).first()).toBeVisible();
    await expect(panel.getByText('Blocked by policy', { exact: false }).first()).toBeVisible();
    const blocked = panel.locator('.proposal-line[data-status="blocked"]');
    await expect(blocked).toContainText('Assign marco-ruiz');
    await expect(blocked).toContainText('issueTriage.assignUsers');

    // Proposals land in the Steward Inbox.
    await page.getByTestId('nav-inbox').click();
    const cards = page.getByTestId('inbox-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.filter({ hasText: 'Mark as ai-candidate' })).toBeVisible();
    await expect(cards.filter({ hasText: 'Remove needs-repro' })).toBeVisible();

    // Approving the ai-candidate proposal mutates the issue for real.
    await cards.filter({ hasText: 'Mark as ai-candidate' }).getByTestId('approve-proposal').click();
    await page.goto('/issues/42');
    await expect(page.getByTestId('issue-labels')).toContainText('ai-candidate');
  });

  test('audit log records the full pipeline with policy explanations', async ({ page }) => {
    await page.goto('/issues/42');
    await runScenario(page, 1);
    await page.goto('/activity');
    const log = page.getByTestId('audit-log');
    await expect(log.getByText('issue.opened', { exact: false }).first()).toBeVisible();
    await expect(log.getByText('Automatically applied because issueTriage.addLabels is automatic', { exact: false }).first()).toBeVisible();
    await expect(log.getByText('Blocked because safety.assignUsers is false', { exact: false }).first()).toBeVisible();
  });
});
