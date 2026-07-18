#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CONTROL_REPOSITORY = "gitCarrot/venu-release-control";
const CONTROL_REPOSITORY_OWNER = "gitCarrot";
const CONTROL_REPOSITORY_OWNER_ID = "96459232";
const PROBE_WORKFLOW_PATH = ".github/workflows/staging-boundary-probe.yml";
const PROBE_WORKFLOW_REF =
  `${CONTROL_REPOSITORY}/${PROBE_WORKFLOW_PATH}@refs/heads/main`;
const PROBE_CONFIRMATION = "PROBE_VENU_RELEASE_CONTROL_STAGING";
const PROBE_PROJECT_ID = "venuhi-staging";
const PROBE_PROJECT_NUMBER = "1041272872928";
const PROBE_BUCKET = "venu-release-control-probe-1041272872928";
const PROBE_OBJECT = "probe/v1/release-control-boundary.json";
const PROBE_SERVICE_ACCOUNT =
  `venu-release-control-probe@${PROBE_PROJECT_ID}.iam.gserviceaccount.com`;
const PROBE_PROVIDER =
  `projects/${PROBE_PROJECT_NUMBER}/locations/global/workloadIdentityPools/` +
  "github-release/providers/venu-control-probe";

function fail(message) {
  throw new Error(`[release-control] ${message}`);
}

function fullSha(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) {
    fail(`${label} must be one full lowercase Git commit SHA.`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    fail(`${label} must be a positive integer string.`);
  }
  return value;
}

function assertProbeContext(env = process.env) {
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.CI !== "true" ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_REPOSITORY !== CONTROL_REPOSITORY ||
    env.GITHUB_REPOSITORY_OWNER !== CONTROL_REPOSITORY_OWNER ||
    env.GITHUB_REPOSITORY_OWNER_ID !== CONTROL_REPOSITORY_OWNER_ID ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_REF_TYPE !== "branch" ||
    env.GITHUB_WORKFLOW_REF !== PROBE_WORKFLOW_REF ||
    env.RUNNER_ENVIRONMENT !== "github-hosted" ||
    env.RUNNER_OS !== "Linux" ||
    env.VENU_RELEASE_CONTROL_CONFIRMATION !== PROBE_CONFIRMATION ||
    env.VENU_RELEASE_CONTROL_PROJECT_ID !== PROBE_PROJECT_ID ||
    env.VENU_RELEASE_CONTROL_PROVIDER !== PROBE_PROVIDER ||
    env.VENU_RELEASE_CONTROL_SERVICE_ACCOUNT !== PROBE_SERVICE_ACCOUNT ||
    env.VENU_RELEASE_CONTROL_BUCKET !== PROBE_BUCKET ||
    env.VENU_RELEASE_CONTROL_OBJECT !== PROBE_OBJECT
  ) {
    fail("The request is not the exact isolated staging boundary probe.");
  }

  const workflowSha = fullSha(
    env.VENU_RELEASE_CONTROL_WORKFLOW_SHA,
    "Executing workflow SHA"
  );
  const sourceSha = fullSha(env.GITHUB_SHA, "GITHUB_SHA");
  if (workflowSha !== sourceSha) {
    fail("The executing workflow SHA must exactly match the checked main SHA.");
  }
  positiveInteger(env.GITHUB_RUN_ID, "GITHUB_RUN_ID");
  positiveInteger(env.GITHUB_RUN_ATTEMPT, "GITHUB_RUN_ATTEMPT");

  return Object.freeze({
    bucket: PROBE_BUCKET,
    object: PROBE_OBJECT,
    projectId: PROBE_PROJECT_ID,
    provider: PROBE_PROVIDER,
    repository: CONTROL_REPOSITORY,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    runId: env.GITHUB_RUN_ID,
    serviceAccount: PROBE_SERVICE_ACCOUNT,
    workflowSha,
  });
}

function readBoundedRegularFile(filePath, maxBytes = 64 * 1024) {
  const requested = path.resolve(filePath);
  const requestedStat = fs.lstatSync(requested);
  if (requestedStat.isSymbolicLink()) {
    fail("The probe receipt must not be a symbolic link.");
  }
  const resolved = fs.realpathSync(requested);
  const stat = fs.lstatSync(resolved);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size <= 0 ||
    stat.size > maxBytes
  ) {
    fail("The probe receipt must be a bounded regular one-link file.");
  }
  const descriptor = fs.openSync(
    resolved,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
  );
  try {
    const opened = fs.fstatSync(descriptor);
    if (
      opened.dev !== stat.dev ||
      opened.ino !== stat.ino ||
      opened.size !== stat.size ||
      opened.mtimeMs !== stat.mtimeMs ||
      opened.ctimeMs !== stat.ctimeMs
    ) {
      fail("The probe receipt changed while opening.");
    }
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        offset
      );
      if (count === 0) fail("The probe receipt ended while reading.");
      offset += count;
    }
    const after = fs.fstatSync(descriptor);
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs
    ) {
      fail("The probe receipt changed while reading.");
    }
    return bytes;
  } finally {
    fs.closeSync(descriptor);
  }
}

function verifyProbeReceipt(filePath) {
  const bytes = readBoundedRegularFile(filePath);
  let receipt;
  try {
    receipt = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("The staging probe receipt is invalid JSON.");
  }
  const keys = Object.keys(receipt).sort();
  const expectedKeys = [
    "kind",
    "productionMutation",
    "projectId",
    "schemaVersion",
  ].sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index]) ||
    receipt.schemaVersion !== 1 ||
    receipt.kind !== "venu-release-control-staging-probe" ||
    receipt.projectId !== PROBE_PROJECT_ID ||
    receipt.productionMutation !== false
  ) {
    fail("The staging probe receipt does not match the fixed no-production contract.");
  }
  return Object.freeze({ bytes, receipt: Object.freeze(receipt) });
}

function main(argv = process.argv.slice(2), env = process.env) {
  const [operation, filePath] = argv;
  if (operation === "assert-context" && argv.length === 1) {
    const result = assertProbeContext(env);
    console.log(
      `[release-control] Authorized read-only staging probe for workflow ${result.workflowSha}.`
    );
    return;
  }
  if (operation === "verify-receipt" && argv.length === 2) {
    verifyProbeReceipt(filePath);
    console.log("[release-control] Verified isolated staging probe receipt.");
    return;
  }
  fail(
    "Usage: release-control-boundary.cjs assert-context | verify-receipt <path>."
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  CONTROL_REPOSITORY,
  CONTROL_REPOSITORY_OWNER,
  CONTROL_REPOSITORY_OWNER_ID,
  PROBE_BUCKET,
  PROBE_CONFIRMATION,
  PROBE_OBJECT,
  PROBE_PROJECT_ID,
  PROBE_PROJECT_NUMBER,
  PROBE_PROVIDER,
  PROBE_SERVICE_ACCOUNT,
  PROBE_WORKFLOW_PATH,
  PROBE_WORKFLOW_REF,
  assertProbeContext,
  verifyProbeReceipt,
};
