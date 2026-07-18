#!/usr/bin/env node

"use strict";

const { assertProbeContext } = require("./release-control-boundary.cjs");

const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_TOKEN_BYTES = 32 * 1024;
const SAFE_CLAIMS = Object.freeze([
  "actor",
  "actor_id",
  "aud",
  "event_name",
  "job_workflow_ref",
  "job_workflow_sha",
  "ref",
  "ref_type",
  "repository",
  "repository_id",
  "repository_owner",
  "repository_owner_id",
  "repository_visibility",
  "runner_environment",
  "sub",
  "workflow",
  "workflow_ref",
  "workflow_sha",
]);

function fail(message) {
  throw new Error(`[oidc-diagnostic] ${message}`);
}

function decodeJwtPayload(token) {
  if (
    typeof token !== "string" ||
    token.length < 32 ||
    token.length > MAX_TOKEN_BYTES
  ) {
    fail("GitHub returned an invalid bounded OIDC token.");
  }
  const segments = token.split(".");
  if (segments.length !== 3 || segments.some((segment) => !segment)) {
    fail("GitHub returned a malformed OIDC token.");
  }
  let payload;
  try {
    payload = JSON.parse(
      Buffer.from(segments[1], "base64url").toString("utf8")
    );
  } catch {
    fail("GitHub returned an unreadable OIDC claim payload.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail("GitHub returned an invalid OIDC claim payload.");
  }
  return payload;
}

function safeClaims(payload) {
  return Object.freeze(
    Object.fromEntries(
      SAFE_CLAIMS.filter((claim) =>
        Object.prototype.hasOwnProperty.call(payload, claim)
      ).map((claim) => [claim, payload[claim]])
    )
  );
}

async function readOidcClaims({
  env = process.env,
  fetchImpl = globalThis.fetch,
  logger = console,
} = {}) {
  const context = assertProbeContext(env);
  const requestUrl = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (
    typeof requestUrl !== "string" ||
    !requestUrl.startsWith("https://") ||
    requestUrl.length > 4096 ||
    typeof requestToken !== "string" ||
    requestToken.length < 32 ||
    requestToken.length > MAX_TOKEN_BYTES ||
    typeof fetchImpl !== "function"
  ) {
    fail("The GitHub OIDC request channel is unavailable or malformed.");
  }
  const audience = `https://iam.googleapis.com/${context.provider}`;
  const url = new URL(requestUrl);
  url.searchParams.set("audience", audience);
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${requestToken}` },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const raw = await response.text();
  if (!response.ok || Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) {
    fail("GitHub rejected the bounded OIDC claim request.");
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    fail("GitHub returned an invalid OIDC response.");
  }
  const claims = safeClaims(decodeJwtPayload(body?.value));
  logger.log(`[oidc-diagnostic] Safe claims: ${JSON.stringify(claims)}`);
  return claims;
}

if (require.main === module) {
  readOidcClaims().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = { SAFE_CLAIMS, decodeJwtPayload, readOidcClaims, safeClaims };
