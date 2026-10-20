---
title: A homelab with nothing to rotate
date: 2026-10-19
summary: My home Kubernetes cluster used to run on long-lived keys, copied into more places than I could list. Now the systems involved prove who they are to each other with short-lived tokens, and there is almost nothing left to rotate.
tags: [homelab, kubernetes, k3s, security, workload-identity, gcp]
draft: false
---

<!--
OUTLINE, second version. Not prose yet.

WHO THIS IS FOR
Someone who runs Kubernetes at home or at work and uses GitHub Actions, and
who has at some point pasted a token into a Secret and felt slightly bad
about it. They know what a container registry, a ServiceAccount and a CI
workflow are. They do NOT know Google Cloud IAM, workload identity
federation, or how the kubelet pulls images. Nothing in this post may
assume they have seen my repository.

RULES FOR THE PROSE
- Explain every term the first time it appears, in one plain sentence, or
  do not use it. Terms that need introducing are listed per section below.
- No issue numbers, no file names from my repository, no internal resource
  names. Name things by their role ("the workflow that builds the image"),
  not by what they are called in my setup.
- Code only where the reader could reuse it, and short.
- Each mechanism: what proves what to whom, and what happens when that proof
  is missing. The failure case is what makes it believable.

OPEN QUESTIONS FOR THE AUTHOR
- Part of the homelab series, or standalone? (Series part 1 is unpublished.)
- Name Google Cloud in the title, or keep it vendor-neutral and say early
  that the same idea works with AWS and Azure?
- Diagram captions and aria-labels below are drafts.
-->

# Every homelab has a token in a Secret

The opening should be the reader's situation, not mine.

- The familiar moment: a private image, a private repository, a CI job that needs to push somewhere. The quickest way through is a personal access token, pasted into a Kubernetes Secret or a CI secret. It works, so it stays.
- What that token is: a password that never expires, or expires on a date nobody remembers, that usually has more access than the job needs, and that gets copied — to a second repository, a second secret store, a backup.
- What it costs, concretely: rotating it means finding every copy; revoking it means something breaks and you find out which; leaking it means whoever has it can do whatever it can do, until you notice.
- My version of that list, briefly and in plain words: one token to pull images, two keys so the cluster could read and write its own configuration in git, four copies of a key so CI could fetch a private library. Say that by the end, all but one were gone, and that the post is about how.
- Scope, stated early and honestly: this is about how *machines* authenticate to each other — CI, the registry, the cluster. Application secrets such as database passwords and third-party API keys are still secrets, and a different problem (a possible follow-up).

# The idea: prove who you are, don't hold a key

One idea, explained well enough that the rest of the post is just examples.

<figure class="d2-diagram" role="img" aria-label="DRAFT: A GitHub Actions workflow, Flux and an application pod each send a signed statement of who they are to a token exchange in Google Cloud, which hands back a token that lives for an hour and grants access to the registry.">
  <img src="/img/diagrams/secret-free-overview.svg" alt="" />
  <figcaption>DRAFT: Nobody holds a key. Everything that needs access proves who it is, and gets an hour.</figcaption>
</figure>

- The analogy: a key you copy versus a badge checked at the door. Anyone with a copy of the key gets in. A badge is issued for today, to you, by someone the door already trusts.
- The two things you already have that can issue such a badge, without you storing anything:
  - GitHub Actions can give every workflow run a signed token that says "this is workflow X in repository Y, running for branch Z" (introduce: OIDC token, in one sentence — a standard format for "who I am", signed by the issuer);
  - every Kubernetes cluster already signs tokens for its ServiceAccounts ("this pod runs as ServiceAccount S in namespace N"), and publishes the public keys to check them.
- The third piece is something that accepts those badges and swaps them for real access. Introduce workload identity federation as exactly that: you tell the cloud provider "trust tokens signed by GitHub, but only for this repository and this workflow", and it exchanges a matching token for a short-lived credential.
- What the reader should take away: nothing long-lived is stored anywhere; access lasts about an hour; and the rule for who gets in is a readable condition, not a list of who holds a copy.

# Why I put everything in Google's registry

- The deciding fact: the reader's obvious choice, GitHub's own container registry, cannot do this. Pulling a private image from it needs a token. Google Artifact Registry (introduce it as Google's registry for container images and other packages) accepts the federated badges from both GitHub and my cluster.
- So one place, one trust mechanism, for every direction: CI pushes, the cluster pulls.
- Alternatives considered, a sentence each: running my own registry (the credential problem just moves inside the cluster), other registries without federation, keeping GitHub's registry with a token (the thing I was trying to remove).
- What it costs, before the reader asks:
  - a dependency on Google being up (last section);
  - real money is possible, so a budget alert — and the surprising detail that it is only an alert: Google cannot hard-cap a project, and switching billing off automatically would take every image pull down with it;
  - the cluster's signing key becomes something Google trusts, so replacing it becomes a planned step.

# Pulling an image as the pod that needs it

The technically most interesting part; give it room.

<figure class="d2-diagram" role="img" aria-label="DRAFT: A pod runs as ServiceAccount my-app. The kubelet asks a credential provider plugin for registry credentials, handing it a token for my-app. The plugin swaps that token at Google for a registry token valid for an hour, and the kubelet pulls the image as my-app.">
  <img src="/img/diagrams/secret-free-image-pull.svg" alt="" />
  <figcaption>DRAFT: The pull happens as the pod's own identity. There is no pull secret.</figcaption>
</figure>

- The puzzle, posed to the reader: the image is pulled before the container starts, by the kubelet (introduce: the agent on each node that starts containers), not by the application. So whose identity is the pull?
- The usual answer is an image pull secret: a stored credential again.
- The newer answer: Kubernetes lets the kubelet call a small plugin to get registry credentials, and can hand that plugin a token for the pod's ServiceAccount. The plugin swaps it at Google and returns a registry token. Show the kubelet side, trimmed, because a reader can reuse it:

  ```yaml
  apiVersion: kubelet.config.k8s.io/v1
  kind: CredentialProviderConfig
  providers:
    - name: gcp-wif-credential-provider
      apiVersion: credentialprovider.kubelet.k8s.io/v1
      matchImages: ["*-docker.pkg.dev"]
      defaultCacheDuration: "50m"
      tokenAttributes:
        serviceAccountTokenAudience: "<what Google expects>"
        requireServiceAccount: true
  ```

  Explain the two lines that matter: `matchImages` (only images from Google's registry go through the plugin; everything else pulls as before) and the token attributes (the kubelet mints a token for the pod's ServiceAccount, for this purpose only).
- One sentence on the plugin itself: small, written for this, released with a verifiable build record, and installed on each node by checksum. Link to it.
- How I knew it worked, which is the convincing part:
  - a test pod that must pull fresh every time, because a cached image hides a broken pull;
  - a pod whose ServiceAccount was never meant to have access: refused by Google. That refusal is the proof that the identity does the work, not some leftover credential on the node.

# Letting Flux read its configuration without GitHub

<figure class="d2-diagram" role="img" aria-label="DRAFT: A merged change makes CI package the configuration as an artifact and push it to the registry in Google Cloud as the workflow. Flux in the home cluster pulls it every minute as its own ServiceAccount and applies it.">
  <img src="/img/diagrams/secret-free-flux-oci.svg" alt="" />
  <figcaption>DRAFT: The cluster's configuration travels through the same registry as its images.</figcaption>
</figure>

- Introduce Flux in a sentence: it keeps the cluster in line with configuration stored in git, by polling the repository and applying what changed.
- The problem: polling a private repository needs a GitHub credential, and GitHub accepts no federated badge for its own API.
- The trick: don't let the cluster read git at all. Every merge, CI packages the configuration into an artifact (introduce: the same format as a container image, holding files instead of a filesystem) and pushes it to the registry. Flux pulls it from there with its own ServiceAccount, exactly like the image pull.
- A detail readers with branch protection will recognise: automation that commits version bumps back to git does not mix with a protected main branch, and GitHub's built-in CI token cannot be exempted. So the version numbers are now written into the artifact instead of committed to git. One fewer write credential, and branch protection stays on.
- Rolling back no longer needs git: point the "current" tag at an older artifact.
- What changes in day-to-day verification, in one paragraph: "the command succeeded" is not proof the cluster runs the new version; check which commit it reports having applied.

# Who may do what

Short section; it is the part a reader copying this is most likely to get wrong.

- The conditions are the security. Show one, generic:

  ```
  assertion.repository_id == '123456789'
  && assertion.ref == 'refs/heads/main'
  && assertion.job_workflow_ref.startsWith('owner/repo/.github/workflows/publish.yml@')
  ```

  Explain each line: the repository by number, not name (a deleted and re-created repository with the same name is a different repository); the branch; and the one workflow file allowed to write.
- One trap worth a paragraph: in Google's setup, a permission granted to "repository X" applies to every rule in the same group of trust rules. Put a read-only rule and a write rule in the same group and they quietly share access. One group per kind of access avoids it.

# The one key I kept

- The honest limit: to change something *on GitHub* — here, publishing a new version of my Homebrew package to another repository — GitHub still wants one of its own credentials. It accepts no federated badge for that.
- What I did instead of a stored key: the key exists only inside Google's key management service, where it can sign but can never be read out, and only the release workflow, on a release tag, can ask it to sign. It is federation with a key-shaped last step.
- One sentence on the alternative I designed and parked (the package repository pulling verified releases itself), and why it only becomes better with an organisation account.

# When Google is down

- What keeps working: everything that is already running; Flux keeps applying the last configuration it fetched.
- What stops: anything new reaching the cluster.
- The escape hatch: apply the configuration from a local checkout, then hand control back to Flux once the registry is reachable. Rehearsed, not theoretical: a cold restart of the component that fetches artifacts recovered in about five minutes.
- Rebuilding the cluster from scratch has one step outside it: telling Google to trust the new cluster's signing key.

# Wrapping up

- Back to the opening list: of the long-lived keys, one remains, and nobody can read it.
- The lesson, for the reader's own setup: replace a secret only with something you can test both ways — it lets the right thing in, and it keeps the wrong thing out. Without the second test you have not removed a credential, you have only stopped seeing it.
- Pointers: the plugin, and, if written, follow-ups on application secrets and on review for a one-person cluster.
