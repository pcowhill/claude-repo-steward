import { expect, test } from '@playwright/test';
import { prepare, runScenario } from './helpers';

test.describe('Configuration changes steer outcomes', () => {
  test.beforeEach(async ({ page }) => {
    await prepare(page);
  });

  async function setMarkAiCandidate(page: import('@playwright/test').Page, level: 'Disabled' | 'Propose' | 'Automatic') {
    await page.goto('/config');
    await page
      .getByTestId('config-issueTriage-markAiCandidate')
      .getByRole('radio', { name: level })
      .click();
    await page.getByTestId('apply-config').click();
  }

  test('disabled → blocked, propose → inbox, automatic → executed', async ({ page }) => {
    // 1. Disabled: the proposal is blocked outright.
    await setMarkAiCandidate(page, 'Disabled');
    await page.goto('/issues/42');
    await runScenario(page, 1);
    const panel = page.getByTestId('steward-panel');
    await expect(panel.locator('.proposal-line[data-status="blocked"]').filter({ hasText: 'ai-candidate' })).toContainText(
      'issueTriage.markAiCandidate is disabled',
    );
    await expect(page.getByTestId('issue-labels')).not.toContainText('ai-candidate');

    // 2. Propose: it enters the Steward Inbox.
    await setMarkAiCandidate(page, 'Propose');
    await page.goto('/issues/42');
    await runScenario(page, 1);
    await page.getByTestId('nav-inbox').click();
    await expect(page.getByTestId('inbox-card').filter({ hasText: 'Mark as ai-candidate' }).first()).toBeVisible();
    await page.goto('/issues/42');
    await expect(page.getByTestId('issue-labels')).toBeVisible();
    await expect(page.getByTestId('issue-labels')).not.toContainText('ai-candidate');

    // 3. Automatic with a threshold the confidence (0.78) clears: it executes.
    await page.goto('/config');
    await page.getByTestId('config-issueTriage-markAiCandidate').getByRole('radio', { name: 'Automatic' }).click();
    await page.getByTestId('min-auto-confidence').fill('0.7');
    await page.getByTestId('apply-config').click();
    await page.goto('/issues/42');
    await runScenario(page, 1);
    await expect(page.getByTestId('issue-labels')).toContainText('ai-candidate');
    await expect(
      page.getByTestId('steward-panel').locator('.proposal-line[data-status="executed"]').filter({ hasText: 'ai-candidate' }),
    ).toContainText('confidence 0.78 exceeds the 0.70 threshold');
  });

  test('YAML editor validates, previews a diff, and stays in sync with the visual editor', async ({ page }) => {
    await page.goto('/config');
    // Visual change reflects into YAML.
    await page.getByTestId('config-issueTriage-addLabels').getByRole('radio', { name: 'Propose' }).click();
    await page.getByTestId('tab-yaml').click();
    await expect(page.getByTestId('yaml-editor')).toHaveValue(/addLabels: propose/);
    await expect(page.getByTestId('yaml-validity')).toContainText('valid');

    // Invalid YAML cannot be applied and shows useful errors.
    const editor = page.getByTestId('yaml-editor');
    await editor.fill('version: 1\nnot-a-real-key: true\n');
    await expect(page.getByTestId('yaml-validity')).toContainText('invalid');
    await expect(page.getByTestId('yaml-errors')).toContainText('not-a-real-key');
    await expect(page.getByTestId('apply-config')).toBeDisabled();

    // Restore defaults; the diff preview appears before applying.
    await page.getByRole('button', { name: 'Reset to committed defaults' }).click();
    await expect(page.getByTestId('yaml-validity')).toContainText('valid');
  });

  test('presets load and Observer stops automatic execution', async ({ page }) => {
    await page.goto('/config');
    await page.getByTestId('preset-observer').click();
    await page.getByTestId('apply-config').click();
    await page.goto('/issues/42');
    await runScenario(page, 1);
    // Nothing executed automatically: no labels applied, everything proposed.
    await expect(page.getByTestId('issue-labels')).not.toContainText('bug');
    const panel = page.getByTestId('steward-panel');
    await expect(panel.locator('.proposal-line[data-status="executed"]')).toHaveCount(0);
    await expect(panel.locator('.proposal-line[data-status="awaiting_approval"]').first()).toBeVisible();
  });
});
