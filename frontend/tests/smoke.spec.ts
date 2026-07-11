import { expect, test } from "@playwright/test";

test("loads metadata, applies command filters, and syncs URL state", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Ka Leo Hawaiʻi Vowel Visualizer" })).toBeVisible();
  await expect(page.getByText("8 speakers · 22 vowels")).toBeVisible();
  await expect(page.getByText("Something went wrong rendering this view.")).toHaveCount(0);
  await expect(page.locator(".js-plotly-plot").first()).toBeVisible({ timeout: 15_000 });

  const command = page.getByLabel("Command");
  await command.fill("compare AA DK unstressed ai raw contours");
  await page.getByRole("button", { name: "Apply" }).click();

  await expect(page.getByRole("button", { name: /Applied/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Raw Contours/ })).toHaveClass(/border-indigo-500/);
  await expect(page).toHaveURL(/tab=raw_contours/);
  await expect(page).toHaveURL(/speakers=AA%2CDK/);
  await expect(page).toHaveURL(/stresses=unstressed/);
  await expect(page.getByText("Something went wrong rendering this view.")).toHaveCount(0);
  expect(pageErrors).toEqual([]);

  await page.getByRole("button", { name: /Corpus Word/ }).click();
  await expect(page).toHaveURL(/tab=corpus_word/);
  await expect(page.getByRole("textbox", { name: "Recorded word" })).toBeVisible();

  await page.getByRole("button", { name: /Live Voice/ }).click();
  await expect(page).toHaveURL(/tab=live_voice/);
  await expect(page.getByRole("button", { name: "Start mic" })).toBeVisible();
  await expect(page.getByText("Live reading")).toBeVisible();
  await expect(page.getByText("Live formant movement")).toBeVisible();
  await expect(page.getByText("Something went wrong rendering this view.")).toHaveCount(0);
});
