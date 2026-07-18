#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const WORKFLOW_DIRECTORY = path.join(ROOT, ".github", "workflows");
const EXPECTED_WORKFLOWS = Object.freeze([
  "staging-boundary-probe.yml",
  "verify.yml",
]);
const PINNED_ACTIONS = Object.freeze({
  "actions/checkout": "11bd71901bbe5b1630ceea73d27597364c9af683",
  "actions/setup-node": "49933ea5288caeca8642d1e84afbd3f7d6820020",
  "google-github-actions/auth": "7c6bc770dae815cd3e89ee6cdf493a5fab2cc093",
  "google-github-actions/setup-gcloud":
    "e427ad8a34f8676edf47cf7d7925499adf3eb74f",
});

function fail(message) {
  throw new Error(`[release-control-source] ${message}`);
}

function workflowFiles(root = ROOT) {
  const directory = path.join(root, ".github", "workflows");
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    fail("The workflow directory may contain only regular files.");
  }
  const names = entries.map((entry) => entry.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(EXPECTED_WORKFLOWS)) {
    fail("The workflow inventory contains a missing or unexpected file.");
  }
  return Object.fromEntries(
    names.map((name) => [
      name,
      fs.readFileSync(path.join(directory, name), "utf8"),
    ])
  );
}

function validatePinnedActions(source, label) {
  const uses = [...source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+).*$/gm)].map(
    (match) => match[1]
  );
  for (const reference of uses) {
    const separator = reference.lastIndexOf("@");
    const action = reference.slice(0, separator);
    const revision = reference.slice(separator + 1);
    if (!PINNED_ACTIONS[action] || PINNED_ACTIONS[action] !== revision) {
      fail(`${label} contains an unapproved or non-SHA Action: ${reference}.`);
    }
  }
}

function validateNoProductionSurface(source, label) {
  const forbidden = [
    /secrets\s*\./i,
    /venu-f58b1/i,
    /firebase\s+deploy/i,
    /androidpublisher/i,
    /play[_ -]?service[_ -]?account/i,
    /square[_ -]?(?:access|client|webhook|token|secret)/i,
    /secretmanager\.versions\.access/i,
    /gcloud\s+(?:projects|iam|secrets)\s+/i,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(source)) {
      fail(`${label} contains a forbidden production or secret surface.`);
    }
  }
}

function validateWorkflows(root = ROOT) {
  const files = workflowFiles(root);
  for (const [name, source] of Object.entries(files)) {
    validatePinnedActions(source, name);
    validateNoProductionSurface(source, name);
    if (/pull_request_target\s*:|schedule\s*:|repository_dispatch\s*:/.test(source)) {
      fail(`${name} contains an unapproved trigger.`);
    }
  }

  const verify = files["verify.yml"];
  if (
    !/pull_request\s*:/.test(verify) ||
    !/push\s*:\s*\n\s*branches:\s*\[main\]/.test(verify) ||
    !/workflow_dispatch\s*:/.test(verify) ||
    /id-token\s*:\s*write/.test(verify) ||
    !/npm run verify/.test(verify)
  ) {
    fail("The verification workflow does not match the no-credential contract.");
  }

  const probe = files["staging-boundary-probe.yml"];
  const required = [
    "workflow_dispatch:",
    "id-token: write",
    "contents: read",
    "PROBE_VENU_RELEASE_CONTROL_STAGING",
    "projects/1041272872928/locations/global/workloadIdentityPools/github-release/providers/gitcarrot-venu-release-control-probe",
    "venu-release-control-probe@venuhi-staging.iam.gserviceaccount.com",
    "gs://venu-release-control-probe-1041272872928/probe/v1/release-control-boundary.json",
    "node scripts/release-control-boundary.cjs assert-context",
    "node scripts/release-control-boundary.cjs verify-receipt",
  ];
  if (required.some((value) => !probe.includes(value))) {
    fail("The staging probe workflow is missing a fixed boundary assertion.");
  }
  if (
    /\b(push|pull_request|schedule|repository_dispatch)\s*:/.test(probe) ||
    !/create_credentials_file:\s*true/.test(probe) ||
    !/export_environment_variables:\s*true/.test(probe)
  ) {
    fail("The staging probe trigger or credential mode is invalid.");
  }

  return Object.freeze({ workflowNames: Object.freeze([...EXPECTED_WORKFLOWS]) });
}

if (require.main === module) {
  try {
    const result = validateWorkflows();
    console.log(
      `[release-control-source] Verified ${result.workflowNames.length} no-production workflows.`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = { EXPECTED_WORKFLOWS, PINNED_ACTIONS, validateWorkflows };
