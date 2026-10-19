---
title: A homelab with nothing to rotate
date: 2026-10-19
summary: My cluster used to hold a classic GitHub PAT, two GitHub App keys and four copies of a third. Now CI, the registry and the cluster trust each other through workload identity federation, and there is nothing left to rotate. Almost.
tags: [homelab, kubernetes, k3s, security, workload-identity, gcp]
draft: true
---

<!--
OUTLINE — not prose yet. Each section lists the beats, the evidence to cite,
and the source to check it against (issue numbers are dlouwers/experiments
unless noted). Write the prose in the voice of the "thirty-three decisions"
post: first person, claims as measurements, wrong turns kept in.

Open questions for the author:
- One long post, or split section 3 (the kubelet plugin) into its own part?
- Keep the FluxResourceMetricsIncomplete mistake (section 4) as the example
  of verifying the new state, or drop it?
- Part of the homelab series (post 01 is still on its own branch), or a
  standalone post that links to it?
-->

*Part N of a series on auditing a two-node homelab. [The rest of the series.](/tags/homelab/)*

# The inventory that started it

- Open on `credentials.md` as it stood in early October 2026. The machine credentials:
  - a classic GitHub PAT, so the cluster could pull private images from GHCR (`ghcr-pull`);
  - `github-app-read`, so Flux could read three repositories;
  - `github-app-write`, so image automation could commit tag bumps to git;
  - `DS_APP_PRIVATE_KEY`, four copies across two repositories and two secret stores, with a rotation procedure written in a comment;
  - the Homebrew tap App.
- What they share: long-lived, mostly copied to more than one place, and each one a thing to rotate on a calendar nobody keeps.
- Scope it honestly, early. "Secret-free" means the trust between CI, registry and cluster. Application secrets (OAuth clients, the DNS token, the S3 key for backups) are still SealedSecrets, and say so before a reader finds out.

# Why Google Artifact Registry, for a homelab

- GHCR is the obvious home and has no federation: a private pull needs a PAT, full stop.
- GAR accepts federated identity from both sides with one trust plane:
  - GitHub Actions OIDC tokens (for CI pushing);
  - the k3s cluster's own ServiceAccount tokens, once its JWKS is uploaded to a workload identity pool (for the cluster pulling).
- Alternatives weighed: a self-hosted registry (moves the credential problem inside the cluster), Harbor, GHCR with an App token (still a key).
- The costs, stated plainly:
  - GAR and Google STS become a hard dependency of every pull and every reconcile (see the last section);
  - the €100 budget is a notification, not a cap — GCP cannot hard-cap a normal project, and auto-disabling billing would take every pull down with it;
  - the cluster's ServiceAccount signing key becomes something with a rotation procedure (`credentials.md`, "Rotating the k3s ServiceAccount signing key").
- Source: #487.

# Pulling images as the pod

<figure class="d2-diagram" role="img" aria-label="TODO: describe the image pull flow">
  <img src="/img/diagrams/secret-free-image-pull.svg" alt="" />
  <figcaption>TODO</figcaption>
</figure>

- The problem: the kubelet pulls before the pod exists, so whose identity is the pull?
- The mechanism: kubelet credential providers can be handed a ServiceAccount token for the pod being started. A small plugin, `gcp-wif-credential-provider`, exchanges it at STS for a GAR token.
- It matches only `*-docker.pkg.dev`, so every other image pull in the cluster is untouched.
- Supply chain of the plugin itself: released with build-provenance attestation, pinned by sha256 in the Ansible `k3s_server` / `k3s_agent` roles, RBAC for `system:nodes` on the audience.
- The evidence, and why it had to be this shape:
  - positive: throwaway pods with `imagePullPolicy: Always`, placed on each node with `nodeName`, because the image cache hides a broken pull;
  - negative, twice: an unannotated ServiceAccount (the plugin is never called) and an annotated one outside the attribute condition (STS refuses, `rejected by the attribute condition`). Both `ErrImagePull`. That is what proves the identity does the work, not some ambient credential on the node.
- Source: #487, the plugin repository.

# Flux without a GitHub credential

<figure class="d2-diagram" role="img" aria-label="TODO: describe the OCI artifact flow">
  <img src="/img/diagrams/secret-free-flux-oci.svg" alt="" />
  <figcaption>TODO</figcaption>
</figure>

- Flux stops reading git. Every push to `main` is published by CI as an OCI artifact in GAR; source-controller pulls it as a Kubernetes ServiceAccount through the same pool (`provider: gcp`, the `ObjectLevelWorkloadIdentity` gate).
- The kink: branch protection. `GITHUB_TOKEN` cannot push past a protected `main`, a pull request it opens triggers no checks, and it cannot be a ruleset bypass actor. So CI stopped writing image tags to git at all and sets them *in the artifact*. Image automation, and its write App, went away entirely.
- Rollback without git: retag an older artifact as `main`.
- Verifying the new state is live: `lastAppliedOriginRevision` names the commit; "reconcile exited 0" proves only that a command ran.
- Possible example: removing the image controllers made a metrics-completeness alert fire, because its expected count was written for a cluster that had them. Mine; fixed the same evening.
- Source: #509.

# One pool per privilege

<figure class="d2-diagram" role="img" aria-label="TODO: describe the identity pools">
  <img src="/img/diagrams/secret-free-wif-pools.svg" alt="" />
  <figcaption>TODO</figcaption>
</figure>

- The trap: a `principalSet` binding spans every provider in its pool. A reader and a writer in one pool quietly share each other's grants.
- So: separate pools for the cluster, image pushes, Flux artifacts and Go modules.
- Conditions on the numeric `repository_id` and owner id (a deleted and re-created repository with the same name is not trusted), and on `job_workflow_ref` (one workflow file may write, from one ref).

# Even the private Go module

- The design system is a private Go module. It now lives in a GAR Go repository, uploaded per tag from `git archive` so the hash matches what consumers already have in `go.sum`.
- CI and image builds read it through WIF; the container build gets a `.netrc` as a BuildKit secret, never a layer.
- Dependabot had never once managed to update it — the weekly job failed silently because it could not read the private repository.
- Two gotchas worth a paragraph each:
  - Dependabot's proxy refuses a direct federated token as expiring too soon (dependabot/proxy#262), so it impersonates a service account with no key instead;
  - GAR reports the upload time as a version's release time, so a backfill puts every version inside Dependabot's cooldown.
- Source: #526.

# The one I kept

- GitHub accepts no federated identity for its own API. Writing to another repository takes an App, a PAT, a deploy key, or that repository's own `GITHUB_TOKEN` — and on a personal account the last cannot be a bypass actor (the API answers 422).
- So the Homebrew tap App stays. Its key is non-exportable in Cloud KMS, and only the release workflow, on a `v*` tag, can get permission through OIDC to sign with it. It is federation with an App-shaped last mile.
- The alternative is designed and parked: the tap pulls attested casks from the release itself. It becomes the better option the day the tap lives in an organisation.
- Bridge to review: four eyes belong on the source and on the decision to release, not on files a machine derived from them.
- Source: #505, #531.

# What it costs when Google is down

- What keeps working: running pods, and kustomize-controller re-applying the last artifact it fetched.
- What does not: anything new reaching the cluster.
- The fallback, rehearsed: build a Kustomization from a checkout, apply it as kustomize-controller, resume when the source is back. A cold restart of source-controller recovered in about five minutes.
- A new cluster has exactly one precondition outside itself: upload its JWKS to the pool.

# Wrapping up

- The new inventory: a few rows whose credential column reads "no stored credential".
- The lesson: trade a secret away only for something you can prove — a positive test and a negative one. Otherwise you have moved a credential to where you can no longer see it.
