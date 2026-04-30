require("dotenv").config();
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const testData = require("../withdrawinput.json");
const OUTPUT_DIR = path.join(__dirname, "../test-results");
const RESULTS_TEMP = path.join(OUTPUT_DIR, "temp_results.json");
const RESULTS_JSON = path.join(OUTPUT_DIR, "withdraw.json");
const RESULTS_XLSX = path.join(OUTPUT_DIR, "withdraw_result.xlsx");
const SEL = {
  email: 'input[name="email"]',
  password: 'input[name="password"]',
  signIn: "text=Sign In",
  attendance: 'span:has-text("Attendance")',
  manageRequest: 'span:has-text("Manage Request")',
  card: "div.commonThemeMainCard",
  cardReason: 'span[name="textContent"]',
  cardPunchTime: ".request_myRequestPunchDetails__tR5nF label.commonCardDetails",
  withdrawIcon: "svg.tabler-icon-circle-dashed-x",
  modal: ".ant-modal-content",
  confirmBtn: "Confirm",
  nextPage: "li.ant-pagination-next:not(.ant-pagination-disabled)",
  firstPage: "li.ant-pagination-item-1",
};

const normalize = (str = "") => str.replace(/\s+/g, " ").trim().toLowerCase();

function appendResult(result) {
  let existing = [];
  try {
    if (fs.existsSync(RESULTS_TEMP)) {
      existing = JSON.parse(fs.readFileSync(RESULTS_TEMP, "utf8"));
    }
  } catch {
    existing = [];
  }
  existing.push(result);
  fs.writeFileSync(RESULTS_TEMP, JSON.stringify(existing, null, 2));
}

async function goToFirstPage(page) {
  try {
    const firstPage = page.locator(SEL.firstPage);
    if ((await firstPage.count()) > 0) {
      await firstPage.click();
      await page.waitForTimeout(1500);
    }
  } catch {

  }
}

test.describe("Attendance – Withdraw Request", () => {

  let page;
  let context;
  test.beforeAll(async ({ browser }) => {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    if (fs.existsSync(RESULTS_TEMP)) fs.unlinkSync(RESULTS_TEMP);

    context = await browser.newContext();
    page = await context.newPage();
    await page.goto(process.env.URL, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForSelector(SEL.email, { timeout: 30_000 });
    await page.fill(SEL.email, process.env.EMAIL);
    await page.fill(SEL.password, process.env.PASSWORD);
    await page.click(SEL.signIn);
    await page.waitForTimeout(3000);
    await page.waitForSelector(SEL.attendance, { timeout: 30_000 });
    await page.locator(SEL.attendance).first().click();
    await page.waitForTimeout(1000);
    await page.locator(SEL.manageRequest).first().click();
    await page.waitForSelector(SEL.card, { timeout: 60_000 });
    await page.waitForTimeout(2000);
    console.log("\n Login successful — Manage Request page loaded.\n");
  });
  test.afterAll(async () => {
    await context.close();
    let allResults = [];
    if (fs.existsSync(RESULTS_TEMP)) {
      try {
        allResults = JSON.parse(fs.readFileSync(RESULTS_TEMP, "utf8"));
      } catch {
        console.error("Could not parse temp results — output may be incomplete.");
      }
    }
    const seen = new Map();
    for (const r of allResults) {
      seen.set(`${r.reason}||${r.punchTime}`, r);
    }
    const finalResults = Array.from(seen.values());
    const summary = {
      total: finalResults.length,
      completed: finalResults.filter((r) => r.status === "completed").length,
      alreadyCompleted: finalResults.filter((r) => r.status === "already completed").length,
      notFound: finalResults.filter((r) => r.status === "Not Found").length,
      error: finalResults.filter((r) => r.status === "error").length,
    };
    fs.writeFileSync(
      RESULTS_JSON,
      JSON.stringify({ summary, results: finalResults }, null, 2)
    );
    const rows = finalResults.map((item) => ({
      Reason: item.reason,
      "Punch Time": item.punchTime,
      Status: item.status,
      Error: item.errorMessage || "",
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const keys = Object.keys(rows[0] || {});
    ws["!cols"] = keys.map((key) => ({
      wch: Math.max(key.length, ...rows.map((r) => String(r[key] || "").length)) + 2,
    }));
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddr = XLSX.utils.encode_cell({ r: 0, c: col });
      if (!ws[cellAddr]) continue;
      ws[cellAddr].s = { font: { bold: true } };
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Withdraw Results");
    XLSX.writeFile(wb, RESULTS_XLSX);
    if (fs.existsSync(RESULTS_TEMP)) fs.unlinkSync(RESULTS_TEMP);
  });
  for (const [index, entry] of testData.entries()) {
    test(`Withdraw | #${index + 1} | ${entry.reason} | ${entry.punchTime}`, async () => {
      console.log(`\n Processing: "${entry.reason}" | "${entry.punchTime}"`);
      const result = {
        reason: entry.reason,
        punchTime: entry.punchTime,
        status: "Not Found",
        errorMessage: "",
      };
      try {
        let found = false;
        let hasNextPage = true;
        while (hasNextPage && !found) {
          await page.waitForSelector(SEL.card, { timeout: 30_000 });
          await page.waitForTimeout(500);

          const cards = page.locator(`${SEL.card}:visible`);
          const count = await cards.count();
          console.log(`  Cards visible: ${count}`);
          for (let i = 0; i < count; i++) {
            const card = cards.nth(i);

            let cardReason = "";
            let cardPunchTime = "";

            try {
              cardReason = await card.locator(SEL.cardReason).innerText({ timeout: 5000 });
              cardPunchTime = await card.locator(SEL.cardPunchTime).first().innerText({ timeout: 5000 });
            } catch (readErr) {
              console.log(`  Could not read card ${i + 1}: ${readErr.message}`);
              continue;
            }

            console.log(` [${i + 1}/${count}] "${cardReason}" | "${cardPunchTime}"`);

            if (
              normalize(cardReason) === normalize(entry.reason) &&
              normalize(cardPunchTime) === normalize(entry.punchTime)
            ) {

              const withdrawBtn = card.locator(SEL.withdrawIcon);
              const btnCount = await withdrawBtn.count();
              if (btnCount > 0) {
                console.log("   Match found (active request)!");
                found = true;

                await withdrawBtn.first().scrollIntoViewIfNeeded();
                await withdrawBtn.first().click({ force: true });
                console.log("   Withdraw button clicked");

                const modal = page.locator(SEL.modal);
                await modal.waitFor({ state: "visible", timeout: 15_000 });

                await modal.getByRole("button", { name: SEL.confirmBtn }).click();
                console.log("   Confirm clicked");

                await modal.waitFor({ state: "hidden", timeout: 15_000 });
                await page.waitForTimeout(1000);

                result.status = "completed";
                console.log("   Withdrawn successfully");

                break;

              } else {
                console.log("   Duplicate record found (no action available) → skipping");
                continue;
              }
            }
          }
          if (!found) {
            const nextBtn = page.locator(SEL.nextPage);
            if ((await nextBtn.count()) > 0) {
              console.log("  Moving to next page...");
              await nextBtn.click();
              await page.waitForTimeout(2000);
            } else {
              hasNextPage = false;
            }
          }
        }
        if (!found) {
          result.status = "Not Found";
          console.log("   Not found on any page");
        }

      } catch (err) {
        result.status = "error";
        result.errorMessage = err.message ?? String(err);
        console.error(`   Unexpected error: ${result.errorMessage}`);

      } finally {

        await goToFirstPage(page);
        appendResult(result);
        console.log(` Final status: ${result.status}`);
      }
      if (result.status === "error") {
        throw new Error(
          `Error for "${entry.reason} | ${entry.punchTime}" → ${result.errorMessage}`
        );
      }
      if (result.status !== "Not Found") {
        expect(
          ["completed", "already completed"],
          `Invalid status for "${entry.reason} | ${entry.punchTime}" → ${result.status}`
        ).toContain(result.status);
      }

    });

  }

}); 