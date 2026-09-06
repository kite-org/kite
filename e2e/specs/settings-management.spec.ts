import { expect, test } from "@playwright/test";

test.describe("settings management", () => {
  test("admin can save unauthenticated SMTP settings without sending email", async ({
    page,
  }) => {
    await page.goto("/settings?tab=general");

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    const smtpSection = page
      .locator("div.rounded-lg.border")
      .filter({ has: page.getByText("SMTP", { exact: true }) });
    const smtpSwitch = smtpSection.getByRole("switch", {
      name: "Enable SMTP",
    });
    if ((await smtpSwitch.getAttribute("data-state")) !== "checked") {
      await smtpSwitch.click();
    }
    await expect(smtpSection.getByLabel("Test recipient")).toBeVisible();

    await smtpSection.getByLabel("Host").fill("smtp.example.test");
    await smtpSection.getByLabel("Port").fill("2525");
    await smtpSection.getByLabel("From Email").fill("kite@example.test");
    await smtpSection.getByLabel("From Name").fill("Kite E2E");
    await smtpSection.getByLabel("Encryption").click();
    await page.getByRole("option", { name: "None" }).click();

    const saveResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/admin/general-setting/") &&
        response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("General settings updated")).toBeVisible();
    const response = await saveResponse;
    expect(response.ok()).toBe(true);

    await page.reload();
    const refreshedSMTPSection = page
      .locator("div.rounded-lg.border")
      .filter({ has: page.getByText("SMTP", { exact: true }) });
    await expect(
      refreshedSMTPSection.getByRole("switch", { name: "Enable SMTP" }),
    ).toBeChecked();
    await expect(refreshedSMTPSection.getByLabel("Host")).toHaveValue(
      "smtp.example.test",
    );
    await expect(refreshedSMTPSection.getByLabel("Port")).toHaveValue("2525");
    await expect(refreshedSMTPSection.getByLabel("From Email")).toHaveValue(
      "kite@example.test",
    );
    await expect(refreshedSMTPSection.getByLabel("From Name")).toHaveValue(
      "Kite E2E",
    );
  });

  test("creates an API key and shows it in the table", async ({ page }) => {
    const apiKeyName = `e2e-api-key-${Date.now()}`;

    await page.goto("/settings?tab=apikeys");

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add API Key" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Add API Key" }).click();
    await expect(
      page.getByRole("dialog", { name: "Create API Key" }),
    ).toBeVisible();

    await page.getByLabel("Name").fill(apiKeyName);
    await page.getByRole("button", { name: "Create" }).click();

    const row = page.getByRole("row").filter({ hasText: apiKeyName });
    await expect(row).toBeVisible();
    await expect(row.locator("code")).not.toHaveText(/^•+$/);
  });
});
