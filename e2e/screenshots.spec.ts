import { test } from '@playwright/test';
import { prepare, runScenario, loadScenario, runStewardFromPanel } from './helpers';

/**
 * Captures the review screenshots at 1920×1080 into screenshots/.
 * Runs all three scenarios first so every surface shows real state.
 */

const shot = (name: string) => ({ path: `screenshots/${name}.png` as const, fullPage: false });

test('capture desktop screenshots of every major surface', async ({ page }) => {
  test.setTimeout(180_000);
  await prepare(page);

  // Drive all three scenarios end-to-end.
  await page.goto('/issues/42');
  await runScenario(page, 1);
  await page.goto('/pulls/47');
  await loadScenario(page, 2);
  await runStewardFromPanel(page);
  await page.goto('/pulls/39');
  await loadScenario(page, 3);
  await runStewardFromPanel(page);

  // 1. Code browser (file view with syntax readability).
  await page.goto('/code/main/src/state/readinessStore.ts');
  await page.waitForTimeout(250);
  await page.screenshot(shot('01-code-browser'));

  // 2. Issue detail with the Steward panel populated.
  await page.goto('/issues/42');
  await page.waitForTimeout(250);
  await page.screenshot(shot('02-issue-detail-steward-panel'));

  // 3. PR conversation with steward review comments.
  await page.goto('/pulls/47');
  await page.waitForTimeout(250);
  await page.screenshot(shot('03-pr-conversation'));

  // 4. PR files changed with the diff.
  await page.goto('/pulls/47?tab=files');
  await page.waitForTimeout(250);
  await page.screenshot(shot('04-pr-files-changed'));

  // 5. Steward Inbox with pending proposals incl. the docs diff preview.
  await page.goto('/inbox');
  await page.waitForTimeout(250);
  await page.screenshot(shot('05-steward-inbox'));

  // 6. Configuration — visual editor.
  await page.goto('/config');
  await page.waitForTimeout(250);
  await page.screenshot(shot('06-config-visual'));

  // 7. Configuration — YAML editor.
  await page.getByTestId('tab-yaml').click();
  await page.waitForTimeout(250);
  await page.screenshot(shot('07-config-yaml'));

  // 8. Activity log.
  await page.goto('/activity');
  await page.waitForTimeout(250);
  await page.screenshot(shot('08-activity-log'));

  // 9. Approve the docs proposal, then the draft documentation PR.
  await page.goto('/inbox');
  await page
    .getByTestId('inbox-card')
    .filter({ hasText: 'Open draft docs PR' })
    .getByTestId('approve-proposal')
    .click();
  await page.goto('/pulls/48?tab=files');
  await page.waitForTimeout(250);
  await page.screenshot(shot('09-draft-docs-pr'));
});
