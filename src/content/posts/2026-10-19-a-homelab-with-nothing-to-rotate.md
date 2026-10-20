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

Think of the difference between a key and a badge. A key opens the door for anyone holding a copy, and you cannot know how many copies exist. A badge is checked at the door every time. It says who you are, it was issued by someone the door already trusts, and it is only good for today. Lose it, and by tomorrow it is worthless to whoever found it.

Every credential on my list was a key. The idea behind replacing them is that most of the systems involved can already get a badge, without anyone having to store anything.

GitHub Actions is one of them. A workflow run can ask GitHub for a token that says, in effect, "this is the workflow in this file, in this repository, running for this branch", signed by GitHub. The format is OpenID Connect, usually shortened to OIDC: a standard way of writing down who someone is, so that anyone with the issuer's public key can check the signature. The token is valid for minutes, and nobody creates it in advance. The run asks for one when it needs it.

A Kubernetes cluster is the other. Every pod runs as a ServiceAccount, and the cluster already gives each pod a signed token that says "this is ServiceAccount S in namespace N". Kubernetes mostly uses these internally, but they are OIDC tokens as well, and the cluster publishes the public keys needed to check them. A pod can also get one addressed to a specific outside party, its *audience*, and those are short-lived: an hour or less, renewed as they age.

Neither badge opens anything by itself. The missing piece is a door that accepts them, and that is what workload identity federation is. You tell a cloud provider: accept tokens signed by GitHub, but only from this repository, this branch and this workflow file. Or: accept tokens signed by my cluster, but only for this ServiceAccount. A workload presents its token, the provider checks the signature and the conditions, and hands back a credential of its own that lasts about an hour. AWS, Azure and Google all offer this, under different names.

<figure class="d2-diagram" role="img" aria-label="DRAFT: A CI workflow on GitHub, Flux in the cluster and an app pod in the cluster each present a signed statement of who they are to a token exchange at a cloud provider. The workflow's is signed by GitHub, the other two by the cluster. The exchange grants an hour of access to the registry.">
  <img src="/img/diagrams/secret-free-overview.svg" alt="" />
  <figcaption>DRAFT: Nobody holds a key. Everything that needs access proves who it is, and gets an hour.</figcaption>
</figure>

Three things change when access works this way. Nothing long-lived is stored anywhere, so there is nothing to copy, and nothing that is still useful to anyone next week. Access runs out by itself, so taking it away means changing a rule, not hunting down copies. And the question "who can get in?" has an answer you can read: a short condition, kept with the rest of the configuration, instead of a list of everyone who might once have been handed the key.

# Choosing a registry that accepts the badge

All of this only helps if the thing you are trying to reach accepts a badge, and the obvious place for a GitHub user's container images does not. GitHub's own registry has no federation for anyone outside GitHub Actions: a cluster that wants to pull a private image from it needs a personal access token, and that was the first key on my list. So the images had to live somewhere else, somewhere that would accept a token from GitHub when CI pushes and a token from my cluster when it pulls.

The registries of the three large clouds all qualify. Amazon's is ECR, Azure's is ACR, and Google's is Artifact Registry, and each sits behind a provider that federates with GitHub Actions and with Kubernetes clusters running anywhere, not only their own.

One difference between them matters a great deal for a cluster at home. To check the cluster's tokens, the cloud needs the cluster's public signing keys. AWS and Azure fetch those themselves, from an address the cluster names as its issuer, and that address has to be reachable over public HTTPS. A cluster behind a home router is not, so on those two you publish the cluster's keys somewhere public, a static website will do, and configure the cluster to name that site as its issuer. Google also lets you upload the keys instead. That is why I chose Google: nothing about the cluster had to become reachable from the internet. Past that point the three work the same way, with different names for the pieces, and the rest of this post applies to all of them.

It also gave me one place for everything. CI pushes images there, the cluster pulls them from there, and, as it turns out further down, the cluster's own configuration travels the same way. One registry, one way of proving identity, in both directions.

I looked at two alternatives and dropped both quickly. Running a registry inside the cluster moves the problem rather than solving it: the cluster can reach it, but CI now needs a credential for it. And keeping GitHub's registry with a narrower token would still have been a token, which was the thing I was trying to get rid of.

The choice has costs, and they are worth stating before you make it.

The cloud becomes a dependency. If its registry or its token exchange is down, nothing new reaches the cluster. What keeps running, and what to do about the rest, is the last section of this post.

It can cost money, so I set a budget alert, and found out that it is only that: an alert. On an ordinary pay-as-you-go account, none of the three clouds will stop spending for you. Google documents how to build your own switch that turns billing off when a budget is reached, which also stops every service in the project, image pulls included. AWS can run an action when a budget is crossed, such as applying a policy you wrote in advance to restrict what the account may do. Azure has a real spending limit, but only on free and credit-based subscriptions. For a registry holding a handful of images, the bill is small. It is still worth knowing that the alert is not a ceiling.

And the cluster's signing key, which used to concern only the cluster, is now something the cloud trusts. Replacing it means telling the cloud about the new key first, so it becomes a planned step rather than something that happens to you during an upgrade.

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
