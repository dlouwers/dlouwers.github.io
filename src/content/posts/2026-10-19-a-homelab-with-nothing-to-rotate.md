---
title: "A homelab with nothing to rotate, part 1: images without a key"
date: 2026-10-19
summary: "My home Kubernetes cluster used to run on long-lived keys, copied into more places than I could list. Part one: the idea that replaced them, and how the cluster now pulls its images as the pod that needs them, without a stored credential."
tags: [homelab, kubernetes, k3s, security, workload-identity]
cover: /img/posts/homelab-nothing-to-rotate/cover.png
coverAlt: "Isometric illustration of an archway of shipping containers. A glowing teal seedling is checked at the gateway and blooms inside it, while a ring of old keys beside it fades into particles. A light trace leads on to a server carrying container blocks."
draft: false
---

# Every homelab has a token in a Secret

Sooner or later, a cluster needs to reach something private. An image you have not published, a repository it reads its configuration from, a library your build depends on. The quickest way through is always the same: generate a personal access token, paste it into a Kubernetes Secret or a CI secret, and move on. It works the first time, so it stays.

What you have made at that moment is a password. It never expires, or it expires on a date nobody wrote down. It can usually do more than the job needs, because the permissions on offer are coarse and finding the narrowest one is tedious. And it does not stay in one place. The second repository that needs the same access gets a copy. The backup of your secrets gets a copy. So does the note you left yourself for the day you rotate it.

That day is where the cost shows. Rotating the token means finding every copy first, and you will miss one. Revoking it means something breaks, and you learn what depended on it by watching what fails. Leaking it — in a log line, a screenshot, a repository that turned out to be public — gives whoever finds it everything the token can do, for as long as it takes you to notice.

My home cluster had five of these. A token so the cluster could pull its own application images. A key that let it read its configuration from three repositories, and a second key that let it write version updates back. A key copied into four places so that builds could fetch a private library. And one more, for publishing a package. Each had been the quickest way through at the time.

By the end, four of them were gone, and the fifth sits somewhere nobody can read it, me included. None of them was replaced by a different secret. This is the first of two posts about how that works. This one covers the idea, the choice of registry, and how images reach the cluster. [The second](/posts/2026-10-19-a-homelab-with-nothing-to-rotate-part-2/) covers the cluster's configuration, the conditions that decide who gets in, the one key that is left, and what happens when the cloud is down.

One boundary before going on. This is about how machines prove who they are to each other: the build system, the registry and the cluster. The passwords applications use for their own databases, and the keys they hold for other people's APIs, are still secrets, kept the way they were. That is a different problem, and a different post.

# The idea: prove who you are, don't hold a key

Think of the difference between a key and a badge. A key opens the door for anyone holding a copy, and you cannot know how many copies exist. A badge is checked at the door every time. It says who you are, it was issued by someone the door already trusts, and it is only good for today. Lose it, and by tomorrow it is worthless to whoever found it.

Every credential on my list was a key. The idea behind replacing them is that most of the systems involved can already get a badge, without anyone having to store anything.

GitHub Actions is one of them. A workflow run can ask GitHub for a token that says, in effect, "this is the workflow in this file, in this repository, running for this branch", signed by GitHub. The format is OpenID Connect, usually shortened to OIDC: a standard way of writing down who someone is, so that anyone with the issuer's public key can check the signature. The token is valid for minutes, and nobody creates it in advance. The run asks for one when it needs it.

A Kubernetes cluster is the other. Every pod runs as a ServiceAccount, and the cluster already gives each pod a signed token that says "this is ServiceAccount S in namespace N". Kubernetes mostly uses these internally, but they are OIDC tokens as well, and the cluster publishes the public keys needed to check them. A pod can also get one addressed to a specific outside party, its *audience*, and those are short-lived: an hour or less, renewed as they age.

Neither badge opens anything by itself. The missing piece is a door that accepts them, and that is what workload identity federation is. You tell a cloud provider: accept tokens signed by GitHub, but only from this repository, this branch and this workflow file. Or: accept tokens signed by my cluster, but only for this ServiceAccount. A workload presents its token, the provider checks the signature and the conditions, and hands back a credential of its own that lasts about an hour. AWS, Azure and Google all offer this, under different names.

<figure class="d2-diagram" role="img" aria-label="A CI workflow on GitHub, Flux in the cluster and an app pod in the cluster each present a signed statement of who they are to a token exchange at a cloud provider. The workflow's is signed by GitHub, the other two by the cluster. The exchange grants an hour of access to the registry.">
  <img src="/img/diagrams/secret-free-overview.svg" alt="" />
  <figcaption>Nobody holds a key. Everything that needs access proves who it is, and gets an hour.</figcaption>
</figure>

Three things change when access works this way. Nothing long-lived is stored anywhere, so there is nothing to copy, and nothing that is still useful to anyone next week. Access runs out by itself, so taking it away means changing a rule, not hunting down copies. And the question "who can get in?" has an answer you can read: a short condition, kept with the rest of the configuration, instead of a list of everyone who might once have been handed the key.

# Choosing a registry that accepts the badge

All of this only helps if the thing you are trying to reach accepts a badge, and the obvious place for a GitHub user's container images does not. GitHub's own registry has no federation for anyone outside GitHub Actions: a cluster that wants to pull a private image from it needs a personal access token, and that was the first key on my list. So the images had to live somewhere else, somewhere that would accept a token from GitHub when CI pushes and a token from my cluster when it pulls.

The registries of the three large clouds all qualify. Amazon's is ECR, Azure's is ACR, and Google's is Artifact Registry, and each sits behind a provider that federates with GitHub Actions and with Kubernetes clusters running anywhere, not only their own.

One difference between them matters a great deal for a cluster at home. To check the cluster's tokens, the cloud needs the cluster's public signing keys. AWS and Azure fetch those themselves, from an address the cluster names as its issuer, and that address has to be reachable over public HTTPS. A cluster behind a home router is not, so on those two you publish the cluster's keys somewhere public, a static website will do, and configure the cluster to name that site as its issuer. Google also lets you upload the keys instead. That is why I chose Google: nothing about the cluster had to become reachable from the internet. Past that point the three work the same way, with different names for the pieces, and the rest of these two posts applies to all of them.

It also gave me one place for everything. CI pushes images there, the cluster pulls them from there, and, as the second part shows, the cluster's own configuration travels the same way. One registry, one way of proving identity, in both directions.

I looked at two alternatives and dropped both quickly. Running a registry inside the cluster moves the problem rather than solving it: the cluster can reach it, but CI now needs a credential for it. And keeping GitHub's registry with a narrower token would still have been a token, which was the thing I was trying to get rid of.

The choice has costs, and they are worth stating before you make it.

The cloud becomes a dependency. If its registry or its token exchange is down, nothing new reaches the cluster. What keeps running, and what to do about the rest, is in the last section of the second part.

It can cost money, so I set a budget alert, and found out that it is only that: an alert. On an ordinary pay-as-you-go account, none of the three clouds will stop spending for you. Google documents how to build your own switch that turns billing off when a budget is reached, which also stops every service in the project, image pulls included. AWS can run an action when a budget is crossed, such as applying a policy you wrote in advance to restrict what the account may do. Azure has a real spending limit, but only on free and credit-based subscriptions. For a registry holding a handful of images, the bill is small. It is still worth knowing that the alert is not a ceiling.

And the cluster's signing key, which used to concern only the cluster, is now something the cloud trusts. Replacing it means telling the cloud about the new key first, so it becomes a planned step rather than something that happens to you during an upgrade.

# Pulling an image as the pod that needs it

Here is a puzzle that looks simple. A pod is scheduled onto a node and needs an image from a private registry. Who pulls it? Not the application: it does not exist yet. The pull is done by the kubelet, the agent on every node that starts and stops containers, before any container of the pod runs. So when the registry asks "who are you?", what is the answer?

For most clusters the answer is an image pull secret: a registry password stored in a Secret, which the kubelet hands to the registry on the pod's behalf. That is a stored credential again, and in my case it was the first key on the list.

Kubernetes has a second answer, and it has had it for a while. Instead of reading a Secret, the kubelet can run a small program, a *credential provider plugin*, and ask it for registry credentials whenever it is about to pull from a particular registry. The plugin replies with a username and password, and the kubelet caches them for as long as the plugin says they are good. Every cloud ships such a plugin for its own registry.

What those plugins used to lack was any idea of which pod they were pulling for. They authenticated as the node, using whatever identity the cloud had given the machine. That removed the stored password, but at a price: every pod on a node could pull everything the node could, and there was no way to say "only this application may pull this image".

That changed recently. The kubelet can now hand the plugin a token for the pod's own ServiceAccount, minted for this purpose and addressed to the cloud. The plugin presents it at the cloud's token exchange, exactly as described earlier, and gets back a registry credential that belongs to that ServiceAccount and to nothing else. The pull happens as the pod.

<figure class="d2-diagram" role="img" aria-label="Sequence. The kubelet sees that pod my-app needs an image from the registry. It asks the credential provider plugin for credentials, handing it a token for ServiceAccount my-app. The plugin swaps that token at the cloud token exchange for a registry token valid for one hour and returns it. The kubelet pulls the image as my-app.">
  <img src="/img/diagrams/secret-free-image-pull.svg" alt="" />
  <figcaption>The pull happens as the pod's own identity. There is no pull secret, and a ServiceAccount the cloud was never told to trust gets nothing.</figcaption>
</figure>

The kubelet side is plain Kubernetes and the same on every cloud. It is a configuration file that the kubelet reads at startup, and trimmed to what matters it looks like this:

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
      cacheType: Token
      requireServiceAccount: true
```

Two parts of it do the work. `matchImages` limits the plugin to one registry: images from anywhere else are pulled exactly as before, and the plugin never sees them. `tokenAttributes` is the new part. It tells the kubelet to mint a token for the pod's ServiceAccount, with the audience your cloud expects, and to cache the resulting credential per token rather than per node, so one pod's credential is never reused for another. This arrived as an alpha feature in Kubernetes 1.33 and has been beta, and on by default, since 1.34.

One more piece is easy to miss. A node may not ask for ServiceAccount tokens addressed to any audience it likes; since 1.33 it needs explicit permission for each one, granted with an ordinary RBAC rule. Without it, the plugin is simply never called, and the only trace is an audience error in the kubelet's log. If you set this up and the pull fails with nothing in the plugin's output, look there first.

For Amazon's and Azure's registries, the official plugins already accept the pod's token. Amazon's assumes a role named in an annotation on the ServiceAccount; Azure's presents the token as a federated credential. From a cluster at home, though, either one only works after the step from the registry section: publishing the cluster's signing keys at a public address, because those two clouds fetch the keys themselves. I have not tried that route. Google's plugin is the odd one out. It only works on Google's own managed Kubernetes, because it expects the identity setup that service creates, and there was nothing for a cluster you run yourself that pulls from Google's registry. So I wrote one: [gcp-wif-credential-provider](https://github.com/dlouwers/gcp-wif-credential-provider), about three hundred lines of Go without dependencies. Each release carries a signed record of the build that produced it, and my nodes install it by checksum, so what runs next to the kubelet is the binary that was built from the source. You only need it in that one case: your own cluster, pulling from Artifact Registry. On Google's managed Kubernetes, Google's own plugin does the job; this one exists to fill a gap, not to compete.

Then the part that convinced me, which is testing. Two things make a test of image pulls lie to you.

The first is the cache. A node keeps every image it has pulled, and a pod that asks for an image the node already has will usually just get it, without the kubelet asking the registry anything. A broken pull can go unnoticed for weeks, until a pod lands on a fresh node. So the test pod is set to pull every time it starts, and it is worth running it on every node.

The second is that a pull that works does not prove much. It might work because of the new mechanism, or because of something left over: an old pull secret, a node identity, a cached image. The proof is the other half. A pod whose ServiceAccount the cloud was never told about has to be refused, with an authorisation error from the registry. When that pod fails and the first one succeeds, on the same node, against the same image, the only thing that differs is who the pod is. That is the identity doing the work.

# Next: the configuration

Images were the first thing the cluster had to fetch without a key. The second is its own configuration, which it used to read straight from GitHub, and GitHub accepts no badge. How that was solved, how to write the conditions that decide who gets in, and the one key I could not get rid of, are in [part two](/posts/2026-10-19-a-homelab-with-nothing-to-rotate-part-2/).
