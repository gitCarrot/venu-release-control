"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  CONTROL_REPOSITORY,
  CONTROL_REPOSITORY_OWNER,
  CONTROL_REPOSITORY_OWNER_ID,
  PROBE_BUCKET,
  PROBE_CONFIRMATION,
  PROBE_OBJECT,
  PROBE_PROJECT_ID,
  PROBE_PROVIDER,
  PROBE_SERVICE_ACCOUNT,
  PROBE_WORKFLOW_REF,
  assertProbeContext,
  verifyProbeReceipt,
} = require("../scripts/release-control-boundary.cjs");
const { validateWorkflows } = require("../scripts/validate-workflows.cjs");

function exactEnvironment() {
  return {
    CI: "true",
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REF_TYPE: "branch",
    GITHUB_REPOSITORY: CONTROL_REPOSITORY,
    GITHUB_REPOSITORY_OWNER: CONTROL_REPOSITORY_OWNER,
    GITHUB_REPOSITORY_OWNER_ID: CONTROL_REPOSITORY_OWNER_ID,
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_RUN_ID: "123456",
    GITHUB_SHA: "a".repeat(40),
    GITHUB_WORKFLOW_REF: PROBE_WORKFLOW_REF,
    RUNNER_ENVIRONMENT: "github-hosted",
    RUNNER_OS: "Linux",
    VENU_RELEASE_CONTROL_BUCKET: PROBE_BUCKET,
    VENU_RELEASE_CONTROL_CONFIRMATION: PROBE_CONFIRMATION,
    VENU_RELEASE_CONTROL_OBJECT: PROBE_OBJECT,
    VENU_RELEASE_CONTROL_PROJECT_ID: PROBE_PROJECT_ID,
    VENU_RELEASE_CONTROL_PROVIDER: PROBE_PROVIDER,
    VENU_RELEASE_CONTROL_SERVICE_ACCOUNT: PROBE_SERVICE_ACCOUNT,
    VENU_RELEASE_CONTROL_WORKFLOW_SHA: "a".repeat(40),
  };
}

test("accepts only the exact isolated staging probe context", () => {
  const result = assertProbeContext(exactEnvironment());
  assert.equal(result.projectId, "venuhi-staging");
  assert.equal(result.workflowSha, "a".repeat(40));
  assert.equal(Object.isFrozen(result), true);
});

test("rejects every security-relevant context substitution", async (t) => {
  const cases = [
    ["repository", "GITHUB_REPOSITORY", "attacker/venu-release-control"],
    ["owner", "GITHUB_REPOSITORY_OWNER", "attacker"],
    ["owner id", "GITHUB_REPOSITORY_OWNER_ID", "1"],
    ["event", "GITHUB_EVENT_NAME", "push"],
    ["ref", "GITHUB_REF", "refs/heads/feature"],
    ["ref type", "GITHUB_REF_TYPE", "tag"],
    ["workflow", "GITHUB_WORKFLOW_REF", "gitCarrot/venu-release-control/.github/workflows/other.yml@refs/heads/main"],
    ["runner", "RUNNER_ENVIRONMENT", "self-hosted"],
    ["operating system", "RUNNER_OS", "Windows"],
    ["project", "VENU_RELEASE_CONTROL_PROJECT_ID", "venu-f58b1"],
    ["provider", "VENU_RELEASE_CONTROL_PROVIDER", "projects/1/providers/other"],
    ["service account", "VENU_RELEASE_CONTROL_SERVICE_ACCOUNT", "owner@venu-f58b1.iam.gserviceaccount.com"],
    ["bucket", "VENU_RELEASE_CONTROL_BUCKET", "production"],
    ["object", "VENU_RELEASE_CONTROL_OBJECT", "other"],
    ["confirmation", "VENU_RELEASE_CONTROL_CONFIRMATION", "PROMOTE"],
    ["workflow sha", "VENU_RELEASE_CONTROL_WORKFLOW_SHA", "b".repeat(40)],
  ];
  for (const [name, key, value] of cases) {
    await t.test(name, () => {
      assert.throws(
        () => assertProbeContext({ ...exactEnvironment(), [key]: value }),
        /release-control/
      );
    });
  }
});

test("verifies only the exact no-production staging receipt", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "venu-control-probe-"));
  const receiptPath = path.join(directory, "receipt.json");
  fs.writeFileSync(
    receiptPath,
    `${JSON.stringify({
      schemaVersion: 1,
      kind: "venu-release-control-staging-probe",
      projectId: "venuhi-staging",
      productionMutation: false,
    })}\n`,
    { mode: 0o600 }
  );
  try {
    const result = verifyProbeReceipt(receiptPath);
    assert.equal(result.receipt.productionMutation, false);
    fs.writeFileSync(
      receiptPath,
      `${JSON.stringify({
        schemaVersion: 1,
        kind: "venu-release-control-staging-probe",
        projectId: "venu-f58b1",
        productionMutation: true,
      })}\n`,
      { mode: 0o600 }
    );
    assert.throws(() => verifyProbeReceipt(receiptPath), /no-production/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("checked workflows expose no production mutation or secret surface", () => {
  const result = validateWorkflows();
  assert.deepEqual(result.workflowNames, [
    "staging-boundary-probe.yml",
    "verify.yml",
  ]);
});
