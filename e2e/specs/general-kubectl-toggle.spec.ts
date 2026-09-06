import { expect, test } from "@playwright/test";

test("kubectl terminal toggle updates the header button", async ({ page }) => {
  await page.goto("/");

  const kubectlButton = page.getByRole("button", {
    name: "Toggle Kubectl Terminal",
  });
  await expect(kubectlButton).toBeVisible();

  await page.goto("/settings?tab=general");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  const kubectlSwitch = page.getByRole("switch", {
    name: "Enable kubectl",
  });

  await expect(kubectlSwitch).toBeChecked();
  await kubectlSwitch.click();
  await expect(kubectlSwitch).not.toBeChecked();
  await page
    .locator("div.flex.justify-end")
    .getByRole("button", { name: "Save" })
    .click();
  await expect(page.getByText("General settings updated")).toBeVisible();

  await page.reload();
  await expect(kubectlButton).toHaveCount(0);

  await expect(kubectlSwitch).not.toBeChecked();
  await kubectlSwitch.click();
  await expect(kubectlSwitch).toBeChecked();
  await page
    .locator("div.flex.justify-end")
    .getByRole("button", { name: "Save" })
    .click();
  await expect(page.getByText("General settings updated")).toBeVisible();

  await page.reload();
  await expect(kubectlButton).toBeVisible();
});
