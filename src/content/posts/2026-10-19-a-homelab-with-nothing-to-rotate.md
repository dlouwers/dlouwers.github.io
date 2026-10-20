---
title: A homelab with nothing to rotate
date: 2026-10-19
summary: My home Kubernetes cluster used to run on long-lived keys, copied into more places than I could list. Now the systems involved prove who they are to each other with short-lived tokens, and there is almost nothing left to rotate.
tags: [homelab, kubernetes, k3s, security, workload-identity]
draft: false
---

<!--
OUTLINE, second version. Not prose yet.

WHO THIS IS FOR
Someone who runs Kubernetes at home or at work and uses GitHub Actions, and
who has at some point pasted a token into a Secret and felt slightly bad
about it. They know what a container registry, a ServiceAccount and a CI
workflow are. They do NOT know cloud IAM, workload identity federation, or
how the kubelet pulls images. Nothing in this post may assume they have
seen my repository.

Standalone post, not part of the homelab series.

VENDOR-NEUTRAL
The idea is the subject, not the cloud. Describe each mechanism in generic
terms ("the cloud provider", "its registry", "its key management service")
and mention that I happened to use Google Cloud once, in the registry
section, alongside the AWS and Azure equivalents. Provider-specific syntax
appears only where it is marked as one example of many.

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
- Diagram captions and aria-labels below are drafts.

SOURCES FOR THE VENDOR CLAIMS (checked 2026-10-20)
- Kubelet ServiceAccount tokens for credential providers, alpha 1.33, beta
  and on by default 1.34:
  https://kubernetes.io/blog/2025/09/03/kubernetes-v1-34-sa-tokens-image-pulls-beta/
  https://kubernetes.io/docs/tasks/administer-cluster/kubelet-credential-provider
- AWS issuer must be publicly reachable over HTTPS with a discovery document:
  https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html
- Entra (Azure) federates GitHub Actions and Kubernetes anywhere, and
  validates tokens against the issuer's OIDC endpoint, downloading its keys:
  https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation
  (It says the keys are downloaded from the endpoint; it does not say
  "public" in so many words. Entra is a cloud service, so in practice it is.)
- Google accepts an uploaded JWKS when the issuer is not public:
  https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-providers
- Official plugins and the pod token, from their source code:
  kubernetes/cloud-provider-aws cmd/ecr-credential-provider/main.go
  (AssumeRoleWithWebIdentity, role from the eks.amazonaws.com/ecr-role-arn
  ServiceAccount annotation); kubernetes-sigs/cloud-provider-azure
  pkg/credentialprovider/azure_credentials.go (client assertion credential);
  Google's auth-provider-gcp hardcodes the GKE fleet audience, per the
  gcp-wif-credential-provider README.
- Budgets: Google, disabling billing is DIY and not guaranteed:
  https://docs.cloud.google.com/billing/docs/how-to/disable-billing-with-notifications
  AWS Budgets Actions:
  https://aws.amazon.com/about-aws/whats-new/2020/10/announcing-aws-budgets-actions/
  Azure spending limit, not available for pay-as-you-go:
  https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/spending-limit
-->

# Every homelab has a token in a Secret

Sooner or later, a cluster needs to reach something private. An image you have not published, a repository it reads its configuration from, a library your build depends on. The quickest way through is always the same: generate a personal access token, paste it into a Kubernetes Secret or a CI secret, and move on. It works the first time, so it stays.

What you have made at that moment is a password. It never expires, or it expires on a date nobody wrote down. It can usually do more than the job needs, because the permissions on offer are coarse and finding the narrowest one is tedious. And it does not stay in one place. The second repository that needs the same access gets a copy. The backup of your secrets gets a copy. So does the note you left yourself for the day you rotate it.

That day is where the cost shows. Rotating the token means finding every copy first, and you will miss one. Revoking it means something breaks, and you learn what depended on it by watching what fails. Leaking it — in a log line, a screenshot, a repository that turned out to be public — gives whoever finds it everything the token can do, for as long as it takes you to notice.

My home cluster had five of these. A token so the cluster could pull its own application images. A key that let it read its configuration from three repositories, and a second key that let it write version updates back. A key copied into four places so that builds could fetch a private library. And one more, for publishing a package. Each had been the quickest way through at the time.

By the end, four of them were gone, and the fifth sits somewhere nobody can read it, me included. None of them was replaced by a different secret. This post is about how that works, and about the one place where it does not.

One boundary before going on. This is about how machines prove who they are to each other: the build system, the registry and the cluster. The passwords applications use for their own databases, and the keys they hold for other people's APIs, are still secrets, kept the way they were. That is a different problem, and a different post.

# The idea: prove who you are, don't hold a key

One idea, explained well enough that the rest of the post is just examples.

<figure class="d2-diagram" role="img" aria-label="DRAFT: A CI workflow on GitHub, Flux in the cluster and an app pod in the cluster each present a signed statement of who they are to a token exchange at a cloud provider. The workflow's is signed by GitHub, the other two by the cluster. The exchange grants an hour of access to the registry.">
  <img src="/img/diagrams/secret-free-overview.svg" alt="" />
  <figcaption>DRAFT: Nobody holds a key. Everything that needs access proves who it is, and gets an hour.</figcaption>
</figure>

- The analogy: a key you copy versus a badge checked at the door. Anyone with a copy of the key gets in. A badge is issued for today, to you, by someone the door already trusts.
- The two things you already have that can issue such a badge, without you storing anything:
  - GitHub Actions can give every workflow run a signed token that says "this is workflow X in repository Y, running for branch Z" (introduce: OIDC token, in one sentence — a standard format for "who I am", signed by the issuer);
  - every Kubernetes cluster already signs tokens for its ServiceAccounts ("this pod runs as ServiceAccount S in namespace N"), and publishes the public keys to check them.
- The third piece is something that accepts those badges and swaps them for real access. Introduce workload identity federation as exactly that: you tell a cloud provider "trust tokens signed by GitHub, but only for this repository and this workflow", and it exchanges a matching token for a short-lived credential. All three large clouds offer it, under slightly different names.
- What the reader should take away: nothing long-lived is stored anywhere; access lasts about an hour; and the rule for who gets in is a readable condition, not a list of who holds a copy.

# Choosing a registry that accepts the badge

- The deciding fact: the reader's obvious choice, GitHub's own container registry, cannot do this. Pulling a private image from it needs a token. What I needed was a registry that accepts federated badges from both GitHub and my cluster.
- The large clouds' registries do: AWS's ECR, Azure's ACR, Google's Artifact Registry. All three clouds federate with GitHub Actions and with Kubernetes clusters running anywhere.
- One difference matters for a cluster at home, so give it a paragraph: to check the cluster's tokens, the cloud needs the cluster's public signing keys. AWS and Azure fetch them from the cluster's issuer URL, which must be reachable over public HTTPS — so a cluster behind a home router has to publish its discovery document and keys somewhere public (a static site will do) and use that URL as its issuer. Google also lets you upload the keys directly, which is why I used Google: nothing about the cluster had to become public. Everything else below works the same on all three, with different names for the pieces.
- So one place, one trust mechanism, for every direction: CI pushes, the cluster pulls.
- Alternatives considered, a sentence each: running my own registry (the credential problem just moves inside the cluster), keeping GitHub's registry with a token (the thing I was trying to remove).
- What it costs, before the reader asks:
  - a dependency on the cloud provider being up (last section);
  - real money is possible, so a budget alert — and the surprising detail that it is only an alert: on a normal pay-as-you-go account none of the three caps spending for you. Google documents a do-it-yourself way to switch billing off when a budget is hit (which shuts down everything in the project, every image pull included); AWS can run actions when a budget is crossed, such as applying a restrictive policy; Azure's spending limit exists only on free and credit-based subscriptions;
  - the cluster's signing key becomes something the cloud trusts, so replacing it becomes a planned step.

# Pulling an image as the pod that needs it

The technically most interesting part; give it room.

<figure class="d2-diagram" role="img" aria-label="DRAFT: Sequence. The kubelet sees that pod my-app needs an image from the registry. It asks the credential provider plugin for credentials, handing it a token for ServiceAccount my-app. The plugin swaps that token at the cloud token exchange for a registry token valid for one hour and returns it. The kubelet pulls the image as my-app.">
  <img src="/img/diagrams/secret-free-image-pull.svg" alt="" />
  <figcaption>DRAFT: The pull happens as the pod's own identity. There is no pull secret, and a ServiceAccount the cloud was never told to trust gets nothing.</figcaption>
</figure>

- The puzzle, posed to the reader: the image is pulled before the container starts, by the kubelet (introduce: the agent on each node that starts containers), not by the application. So whose identity is the pull?
- The usual answer is an image pull secret: a stored credential again.
- The newer answer: Kubernetes lets the kubelet call a small plugin to get registry credentials, and can hand that plugin a token for the pod's ServiceAccount. The plugin swaps it at the cloud provider and returns a registry token. This part is plain Kubernetes, the same on every cloud; show the kubelet side, trimmed, because a reader can reuse it:

  ```yaml
  apiVersion: kubelet.config.k8s.io/v1
  kind: CredentialProviderConfig
  providers:
    - name: <your-credential-provider>
      apiVersion: credentialprovider.kubelet.k8s.io/v1
      matchImages: ["<your registry's host>"]
      defaultCacheDuration: "50m"
      tokenAttributes:
        serviceAccountTokenAudience: "<what your cloud expects>"
        requireServiceAccount: true
  ```

  Explain the two lines that matter: `matchImages` (only images from that one registry go through the plugin; everything else pulls as before) and the token attributes (the kubelet mints a token for the pod's ServiceAccount, for this purpose only). This arrived as alpha in Kubernetes 1.33 and has been beta, on by default, since 1.34.
- Contrast with how image pulls from a cloud registry used to work: the plugin authenticated as the *node*, so every pod on a node could pull whatever the node could.
- Each cloud's own plugin now accepts the pod's token: AWS's assumes a role named in an annotation on the ServiceAccount, Azure's exchanges it as a federated credential. Google's only works on Google's own Kubernetes service, because it expects that service's identity setup. That gap is why I wrote a small plugin for Google outside its managed Kubernetes: released with a verifiable build record, installed on each node by checksum. Link to it; a reader on AWS or Azure should use the official plugin.
- How I knew it worked, which is the convincing part:
  - a test pod that must pull fresh every time, because a cached image hides a broken pull;
  - a pod whose ServiceAccount was never meant to have access: refused by the cloud provider. That refusal is the proof that the identity does the work, not some leftover credential on the node.

# Letting Flux read its configuration without GitHub

<figure class="d2-diagram" role="img" aria-label="DRAFT: Sequence. After a merge, the CI workflow on GitHub pushes the configuration to the cloud registry as the workflow. Every minute, Flux in the cluster asks the registry for anything new, as its own ServiceAccount, receives the new artifact and applies it to the cluster.">
  <img src="/img/diagrams/secret-free-flux-oci.svg" alt="" />
  <figcaption>DRAFT: The cluster's configuration travels through the same registry as its images. Flux never talks to GitHub.</figcaption>
</figure>

- Introduce Flux in a sentence: it keeps the cluster in line with configuration stored in git, by polling the repository and applying what changed.
- The problem: polling a private repository needs a GitHub credential, and GitHub accepts no federated badge for its own API.
- The trick: don't let the cluster read git at all. Every merge, CI packages the configuration into an artifact (introduce: the same format as a container image, holding files instead of a filesystem) and pushes it to the registry. Flux pulls it from there with its own ServiceAccount, exactly like the image pull.
- A detail readers with branch protection will recognise: automation that commits version bumps back to git does not mix with a protected main branch, and GitHub's built-in CI token cannot be exempted. So the version numbers are now written into the artifact instead of committed to git. One fewer write credential, and branch protection stays on.
- Rolling back no longer needs git: point the "current" tag at an older artifact.
- What changes in day-to-day verification, in one paragraph: "the command succeeded" is not proof the cluster runs the new version; check which commit it reports having applied.

# Who may do what

Short section; it is the part a reader copying this is most likely to get wrong.

- The conditions are the security. Show what GitHub's token says, trimmed to the fields that matter, and what to require of each — not one provider's condition syntax:

  ```json
  {
    "repository_id": "123456789",
    "ref": "refs/heads/main",
    "job_workflow_ref": "owner/repo/.github/workflows/publish.yml@refs/heads/main"
  }
  ```

  Explain each field: the repository by number, not name (a deleted and re-created repository with the same name is a different repository); the branch; and the one workflow file allowed to write. Then one sentence: each cloud lets you require these, in its own syntax.
- One general lesson, with my provider as the example: find out how far a grant reaches. On Google, a permission granted to "repository X" applies across every trust rule in the same group, so a read-only rule and a write rule in one group quietly share access. Other providers scope it differently; the habit to keep is separating read and write trust, and testing that the read side cannot write.

# The one key I kept

- The honest limit: to change something *on GitHub* — here, publishing a new version of my Homebrew package to another repository — GitHub still wants one of its own credentials. It accepts no federated badge for that.
- What I did instead of a stored key: the key exists only inside the cloud provider's key management service, where it can sign but can never be read out, and only the release workflow, on a release tag, can ask it to sign. It is federation with a key-shaped last step.
- One sentence on the alternative I designed and parked (the package repository pulling verified releases itself), and why it only becomes better with an organisation account.

# When the cloud is down

- What keeps working: everything that is already running; Flux keeps applying the last configuration it fetched.
- What stops: anything new reaching the cluster.
- The escape hatch: apply the configuration from a local checkout, then hand control back to Flux once the registry is reachable. Rehearsed, not theoretical: a cold restart of the component that fetches artifacts recovered in about five minutes.
- Rebuilding the cluster from scratch has one step outside it: telling the cloud provider to trust the new cluster's signing key.

# Wrapping up

- Back to the opening list: of the long-lived keys, one remains, and nobody can read it.
- The lesson, for the reader's own setup: replace a secret only with something you can test both ways — it lets the right thing in, and it keeps the wrong thing out. Without the second test you have not removed a credential, you have only stopped seeing it.
- Pointers: the plugin, and, if written, follow-ups on application secrets and on review for a one-person cluster.
