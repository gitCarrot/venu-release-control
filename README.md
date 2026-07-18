# Venu release control

This public repository is a minimal trust anchor for Venu releases. It does
not contain application source, production configuration, signing material,
Google Play credentials, Square credentials, or long-lived Google service
account keys.

## Current state

- Production promotion is intentionally absent and disabled.
- The only cloud-connected workflow is a read-only probe against an isolated
  object in the `venuhi-staging` project.
- The private `gitCarrot/venu` repository remains the application source and
  has no production authority through this repository.
- A production workflow must not be added until its exact commit SHA is
  separately trusted by Google Workload Identity Federation and its candidate
  contract has passed the private-source and control-repository test suites.

## Boundary

The staging probe accepts an OIDC token only for the exact repository, numeric
repository owner, `main` ref, manual event, GitHub-hosted runner, workflow path,
and workflow commit configured in Google Cloud. The probe service account can
read one isolated staging bucket and has no Firebase, IAM, Secret Manager,
Google Play, Square, or production-project role.

All Actions are pinned to full commit SHAs. Pull requests and `main` run the
same no-secret verification job. Branch protection is configured on the public
repository because GitHub Free supports protected public branches.
