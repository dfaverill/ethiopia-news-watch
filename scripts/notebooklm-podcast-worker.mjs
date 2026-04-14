import { chromium } from "playwright";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const NOTEBOOKLM_URL = "https://notebooklm.google.com/";
const SIGN_IN_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_GENERATION_TIMEOUT_MINUTES = 25;
const generationTimeoutMinutes = Number.parseInt(
  process.env.NOTEBOOKLM_GENERATION_TIMEOUT_MINUTES || "",
  10,
);
const GENERATION_TIMEOUT_MS =
  (Number.isFinite(generationTimeoutMinutes) && generationTimeoutMinutes > 0
    ? generationTimeoutMinutes
    : DEFAULT_GENERATION_TIMEOUT_MINUTES) *
  60 *
  1000;

function log(event, details = {}) {
  console.log(
    JSON.stringify({
      scope: "ethiopia-news-watch",
      event,
      timestamp: new Date().toISOString(),
      ...details,
    }),
  );
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSourceLabel(value) {
  return normalizeText(value).toLowerCase();
}

function parseProjectIdFromNotebookUrl(value) {
  const match = String(value || "").match(/\/notebook\/([^/?#]+)/i);
  return match ? match[1] : null;
}

function buildNotebookUrl(projectId) {
  return `${NOTEBOOKLM_URL}notebook/${projectId}`;
}

async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJsonAtomically(filePath, value) {
  const payload = JSON.stringify(value, null, 2);
  const tempPath = `${filePath}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(tempPath, payload, "utf8");

  try {
    await rename(tempPath, filePath);
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : null;
    if (code !== "EPERM" && code !== "EBUSY") {
      throw error;
    }

    await writeFile(filePath, payload, "utf8");
    await unlink(tempPath).catch(() => undefined);
  }
}

async function updateState(statePath, patch) {
  const current = existsSync(statePath) ? await readJson(statePath) : {};
  const nextState = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  await writeJsonAtomically(statePath, nextState);
  return nextState;
}

async function captureScreenshot(page, debugDir, name) {
  await mkdir(debugDir, { recursive: true });
  const filePath = path.join(debugDir, `${name}.png`);
  try {
    await page.screenshot({
      path: filePath,
      fullPage: true,
      timeout: 10_000,
      animations: "disabled",
    });
    return filePath;
  } catch (error) {
    console.warn(
      `NotebookLM screenshot skipped for ${name}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

async function isVisible(locator) {
  try {
    return (await locator.count()) > 0 && (await locator.first().isVisible());
  } catch {
    return false;
  }
}

async function getFirstVisible(locators) {
  for (const locator of locators) {
    if (await isVisible(locator)) {
      return locator.first();
    }
  }

  return null;
}

async function clickFirstVisible(locators) {
  const locator = await getFirstVisible(locators);

  if (!locator) {
    return false;
  }

  await locator.click({ force: true });
  return true;
}

function createButtonLocators(page, names) {
  return names.flatMap((name) => [
    page.getByRole("button", { name }),
    page.getByRole("link", { name }),
    page.getByText(name),
  ]);
}

async function getStudioButton(page, ariaLabel) {
  const buttons = page.locator(`button[aria-label="${ariaLabel}"]`);
  const count = await buttons.count();
  let selectedIndex = -1;
  let selectedY = Number.POSITIVE_INFINITY;

  for (let index = 0; index < count; index += 1) {
    const locator = buttons.nth(index);
    const box = await locator.boundingBox();

    if (!box) {
      continue;
    }

    if (box.x < 1200 || box.y < 360) {
      continue;
    }

    if (box.y < selectedY) {
      selectedIndex = index;
      selectedY = box.y;
    }
  }

  return selectedIndex >= 0 ? buttons.nth(selectedIndex) : null;
}

async function collectStudioArtifactCards(page) {
  const buttons = page.locator("button.artifact-more-button");
  return buttons.evaluateAll((nodes) => {
    function parseCard(node, domIndex) {
      let current = node;
      let chosen = node.parentElement || node;
      for (let i = 0; i < 8 && current; i += 1) {
        const text = (current.innerText || "").trim();
        if (/(Deep Dive|Brief|Critique|Debate)\s+·\s+\d+\s+sources?/i.test(text)) {
          chosen = current;
          break;
        }
        current = current.parentElement;
      }

      const lines = String(chosen.innerText || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const metaIndex = lines.findIndex((line) =>
        /(Deep Dive|Brief|Critique|Debate)\s+·\s+\d+\s+sources?/i.test(line),
      );
      const meta = metaIndex >= 0 ? lines[metaIndex] : "";
      const title = metaIndex > 0 ? lines[metaIndex - 1] : "";
      const match = meta.match(/(Deep Dive|Brief|Critique|Debate)\s+·\s+(\d+)\s+sources?/i);
      const box = node.getBoundingClientRect();

      return {
        domIndex,
        title,
        meta,
        sourceCount: match ? Number(match[2]) : null,
        signature: `${title}|||${match ? match[1] : ""}|||${match ? match[2] : ""}`,
        y: box.y,
      };
    }

    return nodes
      .map((node, index) => parseCard(node, index))
      .sort((left, right) => left.y - right.y);
  });
}

function buildArtifactSignatureCounts(cards) {
  const counts = new Map();
  for (const card of cards) {
    counts.set(card.signature, (counts.get(card.signature) || 0) + 1);
  }
  return counts;
}

function parseArtifactAgeToSeconds(meta) {
  const text = String(meta || "").trim().toLowerCase();
  const ageMatch = text.match(
    /(just now|\d+\s*[smhdw]\s*ago|\d+\s*(?:second|seconds|sec|secs|minute|minutes|min|mins|hour|hours|hr|hrs|day|days|week|weeks)\s*ago)/i,
  );
  const ageText = ageMatch ? ageMatch[1].toLowerCase() : "";

  if (!ageText) {
    return Number.POSITIVE_INFINITY;
  }
  if (ageText === "just now") {
    return 0;
  }

  const shortMatch = ageText.match(/^(\d+)\s*([smhdw])\s*ago$/i);
  if (shortMatch) {
    const amount = Number(shortMatch[1]);
    const unit = shortMatch[2].toLowerCase();
    const multipliers = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
    return amount * (multipliers[unit] || Number.POSITIVE_INFINITY);
  }

  const longMatch = ageText.match(
    /^(\d+)\s*(second|seconds|sec|secs|minute|minutes|min|mins|hour|hours|hr|hrs|day|days|week|weeks)\s*ago$/i,
  );
  if (!longMatch) {
    return Number.POSITIVE_INFINITY;
  }

  const amount = Number(longMatch[1]);
  const unit = longMatch[2].toLowerCase();
  if (/(second|sec)/.test(unit)) return amount;
  if (/(minute|min)/.test(unit)) return amount * 60;
  if (/(hour|hr)/.test(unit)) return amount * 3600;
  if (/day/.test(unit)) return amount * 86400;
  if (/week/.test(unit)) return amount * 604800;
  return Number.POSITIVE_INFINITY;
}

function selectNewestArtifact(cards) {
  if (!Array.isArray(cards) || cards.length === 0) {
    return null;
  }

  return [...cards].sort((left, right) => {
    const ageDelta = parseArtifactAgeToSeconds(left.meta) - parseArtifactAgeToSeconds(right.meta);
    if (ageDelta !== 0) {
      return ageDelta;
    }
    return left.y - right.y;
  })[0];
}

function selectTargetArtifact(cards, previousCards, expectedSourceCount) {
  const previousCounts = buildArtifactSignatureCounts(previousCards);
  const currentCounts = buildArtifactSignatureCounts(cards);
  const matchingCards = cards.filter(
    (card) => !expectedSourceCount || card.sourceCount === expectedSourceCount,
  );
  const candidates = matchingCards.length > 0 ? matchingCards : cards;

  for (const card of candidates) {
    if ((currentCounts.get(card.signature) || 0) > (previousCounts.get(card.signature) || 0)) {
      return card;
    }
  }

  return null;
}

async function ensureNotebookLmSurface(page) {
  await page.goto(NOTEBOOKLM_URL, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.waitForLoadState("networkidle", { timeout: 90_000 }).catch(
    () => undefined,
  );
}

async function waitForNotebookLmSignIn(page, statePath, debugDir) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < SIGN_IN_TIMEOUT_MS) {
    const signInVisible = await getFirstVisible([
      page.getByRole("button", { name: /sign in/i }),
      page.getByRole("link", { name: /sign in/i }),
      page.getByText(/sign in/i),
    ]);
    const notebookSurface = await getFirstVisible([
      page.getByText(/NotebookLM/i),
      page.getByText(/Create notebook/i),
      page.getByText(/Create new notebook/i),
      page.getByText(/Audio Overview/i),
      page.getByText(/Studio/i),
    ]);

    if (!signInVisible && notebookSurface) {
      await updateState(statePath, {
        status: "running",
        needsSignin: false,
        message: "NotebookLM session is ready. Preparing the podcast notebook.",
        error: null,
      });
      return;
    }

    await updateState(statePath, {
      status: "auth-required",
      needsSignin: true,
      message:
        "Sign in to NotebookLM in the opened browser window to continue the Ethiopia News Watch podcast generation.",
      error: null,
    });

    await captureScreenshot(page, debugDir, "auth-required").catch(() => undefined);
    await page.waitForTimeout(2_000);
  }

  throw new Error(
    "NotebookLM sign-in was not completed in time. Re-run the podcast generation after signing in.",
  );
}

async function waitForNotebookProjectId(page, timeoutMs = 180_000) {
  const startedAt = Date.now();
  let lastProjectId = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastProjectId = parseProjectIdFromNotebookUrl(page.url());
    const creatingVisible = await isVisible(page.getByText(/Creating your notebook/i));

    if (lastProjectId && !/^creating$/i.test(lastProjectId) && !creatingVisible) {
      return lastProjectId;
    }

    await page.waitForTimeout(1_000);
  }

  throw new Error(
    `NotebookLM stayed on its temporary notebook route too long${
      lastProjectId ? ` (${lastProjectId})` : ""
    }.`,
  );
}

async function waitForNotebookEditor(page, expectedProjectId = null, timeoutMs = 180_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const projectId = parseProjectIdFromNotebookUrl(page.url());
    const creatingVisible = await isVisible(page.getByText(/Creating your notebook/i));
    const readyControl = await getFirstVisible([
      page.getByRole("button", { name: /Add source/i }),
      page.getByText(/Add sources?/i),
      page.getByText(/^Audio Overview$/i),
      page.getByText(/Studio/i),
      page.getByText(/Search the web for new sources/i),
      page.locator(".source-title[aria-label]").first(),
    ]);

    if (
      projectId &&
      !/^creating$/i.test(projectId) &&
      (!expectedProjectId || expectedProjectId === projectId) &&
      !creatingVisible &&
      readyControl
    ) {
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(
        () => undefined,
      );
      return projectId;
    }

    await page.waitForTimeout(1_000);
  }

  throw new Error("NotebookLM notebook editor did not become ready in time.");
}

async function createNotebook(page, statePath, notebookTitle) {
  await ensureNotebookLmSurface(page);

  const createClicked = await clickFirstVisible(
    createButtonLocators(page, [
      /create new notebook/i,
      /create notebook/i,
      /new notebook/i,
    ]),
  );

  if (!createClicked) {
    throw new Error(
      "NotebookLM create notebook control was not found. Check the latest debug screenshot for the current UI.",
    );
  }

  await updateState(statePath, {
    status: "running",
    needsSignin: false,
    message: `Creating the NotebookLM notebook for ${notebookTitle}.`,
    error: null,
  });

  await page.waitForURL(/\/notebook\//i, { timeout: 90_000 });
  const projectId = await waitForNotebookProjectId(page);
  await page.goto(buildNotebookUrl(projectId), {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await waitForNotebookEditor(page, projectId);

  return {
    projectId,
  };
}

async function persistSharedNotebook(job, notebookUrl, notebookTitle) {
  if (!job.sharedNotebookPath || !notebookUrl) {
    return;
  }

  await writeJsonAtomically(job.sharedNotebookPath, {
    notebookTitle,
    notebookUrl,
    updatedAt: new Date().toISOString(),
  });
}

async function getNotebookSourceLabels(page) {
  try {
    return await page.locator(".source-title[aria-label]").evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute("aria-label") || "")
        .map((value) => value.replace(/\s+/g, " ").trim())
        .filter(Boolean),
    );
  } catch {
    return [];
  }
}

function getExpectedNotebookSourceLabels(job) {
  return (Array.isArray(job.sourceFiles) ? job.sourceFiles : [])
    .map((sourceFile) => path.basename(sourceFile?.path || ""))
    .map(normalizeSourceLabel)
    .filter(Boolean);
}

function buildNotebookSourceVerificationSnapshot(actualLabels, expectedLabels) {
  const missingLabels = expectedLabels.filter(
    (expectedLabel) =>
      !actualLabels.some(
        (actualLabel) =>
          actualLabel === expectedLabel ||
          actualLabel.includes(expectedLabel) ||
          expectedLabel.includes(actualLabel),
      ),
  );

  return {
    actualLabels,
    expectedLabels,
    missingLabels,
    matches:
      missingLabels.length === 0 && actualLabels.length === expectedLabels.length,
  };
}

async function ensureExpectedNotebookSources(page, job) {
  const actualLabels = (await getNotebookSourceLabels(page)).map(normalizeSourceLabel);
  const expectedLabels = getExpectedNotebookSourceLabels(job);
  const verification = buildNotebookSourceVerificationSnapshot(
    actualLabels,
    expectedLabels,
  );

  if (!verification.matches) {
    throw new Error(
      `NotebookLM source verification failed. Expected ${expectedLabels.length} sources (${expectedLabels.join(", ")}), but found ${actualLabels.length} (${actualLabels.join(", ") || "none"}). Missing: ${verification.missingLabels.join(", ") || "none"}.`,
    );
  }
}

async function waitForNotebookSourcesToSettle(
  page,
  job,
  statePath,
  settleMs = 5_000,
  timeoutMs = 60_000,
) {
  const expectedLabels = getExpectedNotebookSourceLabels(job);
  const startedAt = Date.now();
  let stableSince = 0;
  let lastStatusUpdateAt = 0;
  let lastMatchedFingerprint = null;

  while (Date.now() - startedAt < timeoutMs) {
    const actualLabels = (await getNotebookSourceLabels(page)).map(normalizeSourceLabel);
    const verification = buildNotebookSourceVerificationSnapshot(
      actualLabels,
      expectedLabels,
    );
    const fingerprint = verification.actualLabels.join("|");

    if (verification.matches) {
      if (settleMs <= 5_000) {
        return;
      }
      if (fingerprint !== lastMatchedFingerprint) {
        stableSince = Date.now();
        lastMatchedFingerprint = fingerprint;
      } else {
        stableSince = stableSince || Date.now();
      }
      if (Date.now() - stableSince >= settleMs) {
        return;
      }
    } else {
      stableSince = 0;
      lastMatchedFingerprint = null;
    }

    if (Date.now() - lastStatusUpdateAt > 15_000) {
      lastStatusUpdateAt = Date.now();
      await updateState(statePath, {
        status: "running",
        needsSignin: false,
        message: `Verifying that all ${expectedLabels.length} NotebookLM sources remain attached before generation.`,
        error: null,
      });
    }

    await page.waitForTimeout(5_000);
  }

  const actualLabels = (await getNotebookSourceLabels(page)).map(normalizeSourceLabel);
  const verification = buildNotebookSourceVerificationSnapshot(
    actualLabels,
    expectedLabels,
  );
  throw new Error(
    `NotebookLM sources did not stay settled long enough before generation. Expected ${expectedLabels.length} sources (${expectedLabels.join(", ")}), found ${actualLabels.length} (${actualLabels.join(", ") || "none"}). Missing: ${verification.missingLabels.join(", ") || "none"}.`,
  );
}

async function ensureNotebookTitle(page, notebookTitle) {
  const titleHost = page.locator("editable-project-title").first();
  if (!(await isVisible(titleHost))) {
    return;
  }

  const titleLabel = titleHost.locator(".title-label-inner").first();
  const currentTitle = normalizeText(
    (await titleLabel.textContent().catch(() => "")) || "",
  );

  if (currentTitle === normalizeText(notebookTitle)) {
    return;
  }

  await titleLabel.click({ force: true }).catch(() => undefined);
  await titleLabel.dblclick({ force: true }).catch(() => undefined);

  const titleInput = titleHost.locator("input.title-input").first();
  await titleInput.waitFor({ state: "visible", timeout: 15_000 }).catch(
    () => undefined,
  );

  if (!(await isVisible(titleInput))) {
    return;
  }

  await titleInput.fill("");
  await titleInput.fill(notebookTitle);
  await titleInput.press("Enter").catch(() => undefined);
  await page.waitForTimeout(1_000);
}

async function removeSingleNotebookSource(page) {
  const sourceMenuButton = page.locator("button.source-item-more-button").first();
  if (!(await isVisible(sourceMenuButton))) {
    return false;
  }

  await sourceMenuButton.click({ force: true });
  await page.waitForTimeout(400);

  const removeTarget = await getFirstVisible([
    page.getByRole("menuitem", { name: /Remove source/i }),
    page.getByText(/Remove source/i),
    page.getByRole("menuitem", { name: /Delete/i }),
    page.getByText(/^Delete$/i),
  ]);

  if (!removeTarget) {
    await page.keyboard.press("Escape").catch(() => undefined);
    return false;
  }

  const previousLabels = await getNotebookSourceLabels(page);
  await removeTarget.click({ force: true });

  const confirmTarget = await getFirstVisible([
    page.getByRole("button", { name: /Remove source/i }),
    page.getByRole("button", { name: /^Remove$/i }),
    page.getByRole("button", { name: /^Delete$/i }),
    page.getByText(/^Remove$/i),
    page.getByText(/^Delete$/i),
  ]);

  if (confirmTarget) {
    await confirmTarget.click({ force: true }).catch(() => undefined);
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    const currentLabels = await getNotebookSourceLabels(page);
    if (currentLabels.length < previousLabels.length) {
      await page.waitForTimeout(400);
      return true;
    }
    await page.waitForTimeout(400);
  }

  return false;
}

async function clearNotebookSources(page, statePath) {
  let attempts = 0;

  while (attempts < 20) {
    const currentLabels = await getNotebookSourceLabels(page);
    if (currentLabels.length === 0) {
      return;
    }

    await updateState(statePath, {
      status: "running",
      needsSignin: false,
      message: `Removing ${currentLabels.length} old NotebookLM sources before uploading the refreshed packet.`,
      error: null,
    });

    const removed = await removeSingleNotebookSource(page);
    if (!removed) {
      const remainingLabels = await getNotebookSourceLabels(page);
      throw new Error(
        `NotebookLM did not fully clear the previous source set before upload. Remaining sources: ${remainingLabels.join(", ") || "unknown"}.`,
      );
    }

    attempts += 1;
  }

  const remainingLabels = await getNotebookSourceLabels(page);
  if (remainingLabels.length > 0) {
    throw new Error(
      `NotebookLM exceeded the source-clear retry budget. Remaining sources: ${remainingLabels.join(", ")}.`,
    );
  }
}

async function countStudioArtifactButtons(page) {
  return page.locator("button.artifact-more-button").count();
}

async function removeSingleStudioArtifact(page) {
  const artifactMenuButton = await getStudioButton(page, "More");
  if (!artifactMenuButton || !(await isVisible(artifactMenuButton))) {
    return false;
  }

  const previousCount = await countStudioArtifactButtons(page);
  await artifactMenuButton.click({ force: true }).catch(() => undefined);
  await page.waitForTimeout(400);

  const deleteTarget = await getFirstVisible([
    page.getByRole("menuitem", { name: /Delete/i }),
    page.getByRole("button", { name: /^Delete$/i }),
    page.getByText(/^Delete$/i),
  ]);

  if (!deleteTarget) {
    await page.keyboard.press("Escape").catch(() => undefined);
    return false;
  }

  await deleteTarget.click({ force: true }).catch(() => undefined);

  const confirmTarget = await getFirstVisible([
    page.getByRole("button", { name: /Confirm deletion/i }),
    page.getByRole("button", { name: /^Delete$/i }),
    page.getByRole("button", { name: /Delete audio overview/i }),
    page.getByText(/^Delete$/i),
  ]);

  if (confirmTarget) {
    await confirmTarget.click({ force: true }).catch(() => undefined);
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    const currentCount = await countStudioArtifactButtons(page);
    if (currentCount < previousCount) {
      await page.waitForTimeout(400);
      return true;
    }
    await page.waitForTimeout(400);
  }

  return false;
}

async function clearStudioArtifacts(page, statePath) {
  let attempts = 0;

  while (attempts < 20) {
    const artifactCount = await countStudioArtifactButtons(page);
    if (artifactCount === 0) {
      return;
    }

    await updateState(statePath, {
      status: "running",
      needsSignin: false,
      message: `Removing ${artifactCount} old NotebookLM studio artifacts before generating the refreshed audio overview.`,
      error: null,
    });

    const removed = await removeSingleStudioArtifact(page);
    if (!removed) {
      throw new Error(
        "NotebookLM did not fully clear the previous studio artifacts before generation.",
      );
    }

    attempts += 1;
  }

  const remainingArtifacts = await countStudioArtifactButtons(page);
  if (remainingArtifacts > 0) {
    throw new Error(
      `NotebookLM exceeded the studio-artifact clear retry budget. Remaining artifacts: ${remainingArtifacts}.`,
    );
  }
}


function getSourceUploadMatchers(sourceFile) {
  const fileName = path.basename(sourceFile.path || "");
  const baseName = fileName.replace(/\.[^.]+$/, "");

  return [fileName, baseName, sourceFile.driveDocTitle]
    .map((value) => normalizeText(value))
    .filter(Boolean);
}

async function waitForUploadedSources(page, previousCount, sourceFiles, timeoutMs = 120_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const currentLabels = (await getNotebookSourceLabels(page)).map(normalizeText);
    const matchedCount = sourceFiles.filter((sourceFile) =>
      getSourceUploadMatchers(sourceFile).some((matcher) =>
        currentLabels.some(
          (label) => label.includes(matcher) || matcher.includes(label),
        ),
      ),
    ).length;

    if (
      currentLabels.length >= previousCount + sourceFiles.length ||
      matchedCount === sourceFiles.length
    ) {
      await page.waitForTimeout(2_000);
      return;
    }

    await page.waitForTimeout(1_000);
  }

  throw new Error(
    "NotebookLM did not finish attaching the uploaded local source files in time.",
  );
}

async function uploadLocalSourcesToNotebook(page, statePath, sourceFiles) {
  const existingFiles = sourceFiles.filter(
    (sourceFile) => sourceFile.path && existsSync(sourceFile.path),
  );

  if (existingFiles.length === 0) {
    throw new Error("NotebookLM local source packet files were not found for upload.");
  }

  await updateState(statePath, {
    status: "running",
    needsSignin: false,
    message: `Uploading ${existingFiles.length} local source packet files into NotebookLM.`,
    error: null,
  });

  await waitForNotebookEditor(page);
  const previousLabels = await getNotebookSourceLabels(page);

  const addSourceTarget = await getFirstVisible([
    page.getByRole("button", { name: /Add source/i }),
    page.getByText(/Add sources?/i),
  ]);
  const localUploadTargets = createButtonLocators(page, [
    /Upload files?/i,
    /Upload sources?/i,
    /From your computer/i,
    /^Computer$/i,
    /Choose files?/i,
    /Browse files?/i,
    /^Upload$/i,
  ]);

  let fileChooser = null;

  if (addSourceTarget) {
    const chooserPromise = page
      .waitForEvent("filechooser", { timeout: 5_000 })
      .catch(() => null);
    await addSourceTarget.click({ force: true }).catch(() => undefined);
    fileChooser = await chooserPromise;

    if (!fileChooser) {
      await addSourceTarget.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(1_500);
    }
  }

  if (!fileChooser) {
    const uploadFilesButton = page
      .getByRole("button", { name: /Upload files?/i })
      .first();

    await uploadFilesButton.waitFor({ state: "visible", timeout: 10_000 }).catch(
      () => undefined,
    );

    if (await isVisible(uploadFilesButton)) {
      const chooserPromise = page
        .waitForEvent("filechooser", { timeout: 8_000 })
        .catch(() => null);

      await uploadFilesButton.click({ force: true }).catch(() => undefined);
      fileChooser = await chooserPromise;

      if (!fileChooser) {
        await page.waitForTimeout(1_000);
      }
    }
  }

  if (!fileChooser) {
    const uploadTarget = await getFirstVisible(localUploadTargets);

    if (uploadTarget) {
      const chooserPromise = page
        .waitForEvent("filechooser", { timeout: 8_000 })
        .catch(() => null);

      await uploadTarget.click({ force: true }).catch(() => undefined);
      fileChooser = await chooserPromise;

      if (!fileChooser) {
        await page.waitForTimeout(750);
      }
    }
  }

  if (fileChooser) {
    await fileChooser.setFiles(existingFiles.map((sourceFile) => sourceFile.path));
    await waitForUploadedSources(page, previousLabels.length, existingFiles);
    return;
  }

  await clickFirstVisible(localUploadTargets).catch(() => undefined);

  const fileInput = page.locator('input[type="file"]').last();
  await fileInput.waitFor({ state: "attached", timeout: 30_000 });
  await fileInput.setInputFiles(existingFiles.map((sourceFile) => sourceFile.path));
  await waitForUploadedSources(page, previousLabels.length, existingFiles);
}

async function waitForDrivePickerFrame(page) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 30_000) {
    const pickerFrame = page
      .frames()
      .find((frame) => frame.url().includes("docs.google.com/picker"));

    if (pickerFrame) {
      return pickerFrame;
    }

    await page.waitForTimeout(300);
  }

  throw new Error("NotebookLM did not open the Google Drive picker.");
}

async function openDrivePicker(page) {
  await waitForNotebookEditor(page);

  let driveTarget = await getFirstVisible([
    page.getByRole("button", { name: /^Drive$/i }),
    page.getByText(/^Drive$/i),
  ]);

  if (!driveTarget) {
    const addSourceTarget = await getFirstVisible([
      page.getByRole("button", { name: /Add source/i }),
      page.getByText(/Add sources?/i),
    ]);

    if (!addSourceTarget) {
      throw new Error(
        "NotebookLM add-source control was not found in the digest notebook.",
      );
    }

    await addSourceTarget.click({ force: true });
    await page.waitForTimeout(750);

    driveTarget = await getFirstVisible([
      page.getByRole("button", { name: /^Drive$/i }),
      page.getByText(/^Drive$/i),
    ]);
  }

  if (!driveTarget) {
    throw new Error("NotebookLM did not expose the Google Drive source picker.");
  }

  await driveTarget.click({ force: true });

  const pickerFrame = await waitForDrivePickerFrame(page);
  const searchInput = pickerFrame
    .locator('input[aria-label="Search in Drive or paste URL"]')
    .last();
  await searchInput.waitFor({ state: "visible", timeout: 30_000 });

  return {
    pickerFrame,
    searchInput,
  };
}

async function addDriveSourceToNotebook(page, sourceFile) {
  const previousLabels = await getNotebookSourceLabels(page);
  const previousCount = previousLabels.length;
  const { pickerFrame, searchInput } = await openDrivePicker(page);
  const searchTerms = [sourceFile.docUrl, sourceFile.driveDocTitle].filter(Boolean);
  let selectionTriggered = false;

  for (const searchTerm of searchTerms) {
    await searchInput.fill("");
    await searchInput.fill(searchTerm);
    await pickerFrame.waitForTimeout(1_500);

    const resultTarget = await getFirstVisible([
      pickerFrame.getByText(sourceFile.driveDocTitle, { exact: false }),
      pickerFrame.locator(`[title="${sourceFile.driveDocTitle}"]`),
      pickerFrame.locator(`text=${sourceFile.driveDocTitle}`),
    ]);

    if (resultTarget) {
      await resultTarget.click({ force: true }).catch(() => undefined);
      await resultTarget.dblclick({ force: true }).catch(() => undefined);
      selectionTriggered = true;
    }

    const confirmTarget = await getFirstVisible([
      pickerFrame.getByRole("button", { name: /^Select$/i }),
      pickerFrame.getByRole("button", { name: /^Insert$/i }),
      pickerFrame.getByRole("button", { name: /^Add$/i }),
      pickerFrame.getByText(/^Select$/i),
      pickerFrame.getByText(/^Insert$/i),
      pickerFrame.getByText(/^Add$/i),
    ]);

    if (confirmTarget) {
      await confirmTarget.click({ force: true }).catch(() => undefined);
    }

    await pickerFrame.page().keyboard.press("Enter").catch(() => undefined);
    await page.keyboard.press("Enter").catch(() => undefined);

    const startedAt = Date.now();
    while (Date.now() - startedAt < 20_000) {
      const currentLabels = await getNotebookSourceLabels(page);
      if (
        currentLabels.length > previousCount ||
        currentLabels.some((label) =>
          normalizeText(label).includes(normalizeText(sourceFile.driveDocTitle)),
        )
      ) {
        await page.waitForTimeout(1_000);
        return;
      }

      await page.waitForTimeout(1_000);
    }
  }

  if (!selectionTriggered) {
    throw new Error(
      `NotebookLM could not find ${sourceFile.driveDocTitle} in the Google Drive picker.`,
    );
  }

  throw new Error(
    `NotebookLM did not attach the Google Drive source ${sourceFile.driveDocTitle} in time.`,
  );
}

async function loadDriveSourceDocuments(job) {
  const index = await readJson(job.driveSourceIndexPath);
  const documents = Array.isArray(index?.documents) ? index.documents : [];

  return job.sourceFiles.map((sourceFile) => {
    const match = documents.find(
      (document) =>
        normalizeText(document.source) === normalizeText(sourceFile.source) ||
        normalizeText(document.docTitle) === normalizeText(sourceFile.driveDocTitle),
    );

    if (!match?.docUrl) {
      throw new Error(
        `NotebookLM Drive source document is missing for ${sourceFile.source}.`,
      );
    }

    return {
      ...sourceFile,
      docId: match.docId ?? null,
      docUrl: match.docUrl,
    };
  });
}

async function syncNotebookSources(page, statePath, driveSources) {
  const currentLabels = (await getNotebookSourceLabels(page)).map(normalizeText);
  const missingSources = driveSources.filter(
    (sourceFile) =>
      !currentLabels.some((label) => {
        const normalizedTitle = normalizeText(sourceFile.driveDocTitle);
        return label.includes(normalizedTitle) || normalizedTitle.includes(label);
      }),
  );

  for (const [index, sourceFile] of missingSources.entries()) {
    await updateState(statePath, {
      status: "running",
      needsSignin: false,
      message: `Attaching Google Drive source ${index + 1}/${missingSources.length}: ${sourceFile.source}.`,
      error: null,
    });
    await addDriveSourceToNotebook(page, sourceFile);
  }

  await page.waitForTimeout(2_500);
}

async function openNotebook(job, page, statePath, debugDir) {
  let projectId = parseProjectIdFromNotebookUrl(job.notebookUrl);

  if (projectId && !/^creating$/i.test(projectId)) {
    await page.goto(buildNotebookUrl(projectId), {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await waitForNotebookEditor(page, projectId).catch(() => undefined);
  } else {
    const createdNotebook = await createNotebook(page, statePath, job.notebookTitle);
    projectId = createdNotebook.projectId;
  }

  await page.goto(buildNotebookUrl(projectId), {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await waitForNotebookEditor(page, projectId);
  await ensureNotebookTitle(page, job.notebookTitle);
  await persistSharedNotebook(job, page.url(), job.notebookTitle);
  await clearNotebookSources(page, statePath);

  const localSourceFiles = Array.isArray(job.sourceFiles) ? job.sourceFiles : [];
  if (localSourceFiles.some((sourceFile) => sourceFile?.path && existsSync(sourceFile.path))) {
    await uploadLocalSourcesToNotebook(page, statePath, localSourceFiles);
  } else {
    const driveSources = await loadDriveSourceDocuments(job);
    await syncNotebookSources(page, statePath, driveSources);
  }
  await waitForNotebookSourcesToSettle(page, job, statePath);
  await captureScreenshot(page, debugDir, "after-source-upload");
  await ensureExpectedNotebookSources(page, job);
  await ensureNotebookTitle(page, job.notebookTitle);
  await updateState(statePath, {
    notebookUrl: page.url(),
    notebookTitle: job.notebookTitle,
  });
  await persistSharedNotebook(job, page.url(), job.notebookTitle);
}

async function configureAudioOverview(page, job, statePath, debugDir) {
  await updateState(statePath, {
    status: "running",
    needsSignin: false,
    message: "Opening the NotebookLM Audio Overview generator.",
    error: null,
  });

  const existingGeneration = await getFirstVisible([
    page.getByText(/Generating Audio Overview/i),
    page.getByText(/Come back in a few minutes/i),
    page.getByText(/Preparing audio overview/i),
  ]);

  if (existingGeneration) {
    await updateState(statePath, {
      status: "running",
      needsSignin: false,
      message: "NotebookLM is already generating the Ethiopia News Watch audio overview.",
      error: null,
    });
    await captureScreenshot(page, debugDir, "audio-generation-resumed");
    return await collectStudioArtifactCards(page);
  }

  const audioOverviewTile = page
    .locator('div.create-artifact-button-container[aria-label="Audio Overview"]')
    .first();
  let audioOverviewClicked = false;

  if (await isVisible(audioOverviewTile)) {
    await audioOverviewTile.click({ force: true }).catch(() => undefined);
    audioOverviewClicked = true;
  } else {
    audioOverviewClicked = await clickFirstVisible(
      createButtonLocators(page, [
        /^Audio Overview$/i,
        /Generate Audio Overview/i,
        /Create Audio Overview/i,
        /Audio overview/i,
      ]),
    );
  }

  if (!audioOverviewClicked) {
    throw new Error(
      "NotebookLM Audio Overview control was not found. Check the latest debug screenshot to update the automation selectors.",
    );
  }

  await page.waitForTimeout(2_000);

  const customizeDialog = page.locator("mat-dialog-container").first();
  await customizeDialog.waitFor({ state: "visible", timeout: 15_000 }).catch(
    () => undefined,
  );

  if (await isVisible(customizeDialog)) {
    const previousArtifacts = await collectStudioArtifactCards(page);
    await ensureExpectedNotebookSources(page, job);
    await clickFirstVisible([page.getByText(/^Deep Dive$/i)]).catch(() => undefined);
    const longButton = customizeDialog.locator("button#mat-button-toggle-2-button").first();
    await longButton.waitFor({ state: "visible", timeout: 15_000 });
    const ensureLongSelected = async () => {
      const currentValue = await longButton.getAttribute("aria-checked");
      if (currentValue !== "true") {
        await longButton.click({ force: true });
        await page.waitForTimeout(300);
      }
      const verifiedValue = await longButton.getAttribute("aria-checked");
      if (verifiedValue !== "true") {
        throw new Error(
          "NotebookLM Long length was not selected after verification.",
        );
      }
    };
    await ensureLongSelected();

    const promptField = customizeDialog
      .locator('textarea[aria-label="What should the AI hosts focus on in this episode?"]')
      .first();
    await promptField.waitFor({ state: "visible", timeout: 15_000 });
    await promptField.fill("");
    await promptField.fill(job.prompt);
    await page.waitForTimeout(300);

    await ensureLongSelected();

    const longSelected = await longButton.getAttribute("aria-checked");
    if (longSelected !== "true") {
      throw new Error(
        "NotebookLM Long length was not selected after prompt verification.",
      );
    }

    await captureScreenshot(page, debugDir, "audio-configured");

    const generateButton = customizeDialog
      .locator("button.button-color--primary")
      .first();
    const generateClicked = await isVisible(generateButton);

    if (!generateClicked) {
      throw new Error(
        "NotebookLM generate control was not found after configuring the audio overview.",
      );
    }

    await generateButton.click({ force: true });
    await page.waitForTimeout(2_500);
    await updateState(statePath, {
      status: "running",
      needsSignin: false,
      message: "NotebookLM is generating the Ethiopia News Watch audio overview.",
      error: null,
    });
    return previousArtifacts;
  }

  await page.waitForTimeout(2_500);
  await updateState(statePath, {
    status: "running",
    needsSignin: false,
    message: "NotebookLM is generating the Ethiopia News Watch audio overview.",
    error: null,
  });

  return await collectStudioArtifactCards(page);
}

async function tryDownloadLatestAudio(page, latestAudioMenuButton) {
  await latestAudioMenuButton.click({ force: true }).catch(() => undefined);
  await page.waitForTimeout(500);

  const downloadTarget = await getFirstVisible([
    page.getByRole("menuitem", { name: /Download/i }),
    page.getByRole("button", { name: /Download/i }),
    page.getByText(/^Download$/i),
    page.getByText(/Download audio/i),
  ]);

  if (!downloadTarget) {
    await page.keyboard.press("Escape").catch(() => undefined);
    return null;
  }

  await downloadTarget.waitFor({ state: "visible", timeout: 10_000 }).catch(
    () => undefined,
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const downloadPromise = page.waitForEvent("download", { timeout: 15_000 }).catch(
      () => null,
    );
    await downloadTarget.click({ force: true }).catch(() => undefined);
    const download = await downloadPromise;
    if (download) {
      return download;
    }
    await page.waitForTimeout(1_000);
  }

  await page.keyboard.press("Escape").catch(() => undefined);
  return null;
}

async function waitForAudioDownload(
  page,
  job,
  statePath,
  debugDir,
  previousArtifacts = [],
) {
  const startedAt = Date.now();
  let observedGeneration = false;
  let lastStatusUpdateAt = 0;
  const expectedSourceCount = Array.isArray(job.sourceFiles) ? job.sourceFiles.length : null;

  while (Date.now() - startedAt < GENERATION_TIMEOUT_MS) {
    const generationIndicator = await getFirstVisible([
      page.getByText(/Generating Audio Overview/i),
      page.getByText(/Come back in a few minutes/i),
      page.getByText(/Preparing audio overview/i),
    ]);

    if (generationIndicator) {
      observedGeneration = true;
    }

    const cards = await collectStudioArtifactCards(page);
    const targetArtifact = selectTargetArtifact(
      cards,
      previousArtifacts,
      expectedSourceCount,
    );
    const latestAudioMenuButton =
      targetArtifact && Number.isInteger(targetArtifact.domIndex)
        ? page.locator("button.artifact-more-button").nth(targetArtifact.domIndex)
        : null;

    if (latestAudioMenuButton && !generationIndicator && (observedGeneration || previousArtifacts.length === 0)) {
      await updateState(statePath, {
        status: "running",
        needsSignin: false,
        message: "Downloading the finished NotebookLM audio overview.",
        error: null,
      });

      const download = await tryDownloadLatestAudio(page, latestAudioMenuButton);

      if (download) {
        await mkdir(path.dirname(job.outputAudioPath), { recursive: true });
        await download.saveAs(job.outputAudioPath);
        const audioStats = await stat(job.outputAudioPath);
        const proofPayload = {
          generatedAt: new Date().toISOString(),
          jobKey: job.jobKey,
          audioPath: job.outputAudioPath,
          byteLength: audioStats.size,
        };
        await writeJsonAtomically(job.outputAudioProofPath, proofPayload);
        await writeJsonAtomically(
          path.join(path.dirname(job.outputAudioProofPath), `${job.scope}-latest.json`),
          proofPayload,
        );
        await captureScreenshot(page, debugDir, "audio-ready");
        return;
      }
    }

    if (Date.now() - lastStatusUpdateAt > 30_000) {
      lastStatusUpdateAt = Date.now();
      await updateState(statePath, {
        status: "running",
        needsSignin: false,
        message: "Waiting for NotebookLM to finish the audio overview.",
        error: null,
      });
    }

    await page.waitForTimeout(5_000);
  }

  throw new Error(
    "NotebookLM did not expose a downloadable audio overview in time. Check the debug screenshots for the current generation state.",
  );
}

async function main() {
  const jobPath = process.argv[2];

  if (!jobPath) {
    throw new Error("NotebookLM worker requires a path to the job JSON file.");
  }

  const job = await readJson(jobPath);
  const userDataDir =
    typeof job.browserProfileDirectory === "string" &&
    job.browserProfileDirectory.trim().length > 0
      ? job.browserProfileDirectory.trim()
      : job.profileDir;

  await mkdir(userDataDir, { recursive: true });
  await mkdir(job.debugDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: job.browserChannel || undefined,
    headless: Boolean(job.browserHeadless),
    acceptDownloads: true,
    viewport: {
      width: 1600,
      height: 900,
    },
  });
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await updateState(job.statePath, {
      status: "running",
      needsSignin: false,
      completedAt: null,
      audioPath: null,
      message:
        job.operation === "sync-sources"
          ? "Refreshing NotebookLM sources."
          : "Launching NotebookLM for the Ethiopia News Watch audio overview.",
      error: null,
    });

    await ensureNotebookLmSurface(page);
    await waitForNotebookLmSignIn(page, job.statePath, job.debugDir);
    await openNotebook(job, page, job.statePath, job.debugDir);

    if (job.operation !== "generate-audio") {
      await captureScreenshot(page, job.debugDir, "source-sync-complete");
      await updateState(job.statePath, {
        status: "failed",
        needsSignin: false,
        completedAt: null,
        notebookUrl: page.url(),
        message:
          "NotebookLM sources were refreshed, but the rebuilt worker only supports full audio generation right now.",
        error: "Source-only repair is not supported by the rebuilt worker.",
      });
      return;
    }

    const previousArtifacts = await configureAudioOverview(
      page,
      job,
      job.statePath,
      job.debugDir,
    );
    await waitForAudioDownload(
      page,
      job,
      job.statePath,
      job.debugDir,
      previousArtifacts,
    );

    await updateState(job.statePath, {
      status: "ready",
      needsSignin: false,
      completedAt: new Date().toISOString(),
      notebookUrl: page.url(),
      notebookTitle: job.notebookTitle,
      audioPath: job.outputAudioPath,
      message:
        job.scope === "recent"
          ? "Google NotebookLM last two days audio overview is ready."
          : "Google NotebookLM deep-dive audio overview is ready.",
      error: null,
    });
  } catch (error) {
    await captureScreenshot(page, job.debugDir, "worker-failed").catch(() => undefined);
    await updateState(job.statePath, {
      status: "failed",
      needsSignin: false,
      completedAt: null,
      message:
        "NotebookLM automation hit a problem. Check the latest debug screenshot and retry once any sign-in or UI issues are resolved.",
      error: error instanceof Error ? error.message : "Unknown NotebookLM error",
    });
    log("notebooklm_podcast_failed", {
      jobKey: job.jobKey,
      message: error instanceof Error ? error.message : "Unknown NotebookLM error",
    });
    throw error;
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
