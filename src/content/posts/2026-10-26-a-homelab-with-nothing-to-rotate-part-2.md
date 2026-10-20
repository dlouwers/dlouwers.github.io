---
title: "A homelab with nothing to rotate, part 2: configuration, conditions and the last key"
date: 2026-10-26
summary: "Part two of replacing every stored credential in my home cluster. Flux reads its configuration from a registry instead of GitHub, the trust conditions do the real work, one key is left, and the cluster survives the cloud being down."
tags: [homelab, kubernetes, k3s, security, workload-identity]
cover: /img/posts/homelab-nothing-to-rotate/cover-part-2.png
coverAlt: "Isometric illustration: a sealed parcel travels from a branching version tree through a container registry to a small server cluster. In the foreground, a single brass key stays locked inside a glowing glass cube; only a coral wax seal leaves it, drifting towards the servers."
draft: true
---

<!--
Part two. The outline rules and the sources for vendor claims are in the
comment at the top of part one; they apply here too. The date is a
placeholder for publication, a week after part one.
-->

[Part one](/posts/2026-10-19-a-homelab-with-nothing-to-rotate/) replaced stored keys with badges. A workload, such as a CI run on GitHub or a pod in the cluster, asks whoever runs it for a short-lived signed token that says who it is. A cloud provider has been told which tokens to trust, under which conditions, and trades a matching one for an hour of access. With that, CI pushes images to a cloud registry and the cluster pulls them as the pod that needs them, with nothing stored anywhere.

This part picks up where that left off: with the cluster's own configuration, which turned out to need a different trick, and then with the parts that decide whether the whole thing is actually secure.

# Letting Flux read its configuration without GitHub

Images are half of what a cluster pulls. The other half is its configuration: the manifests that say which applications run, in which version, with which settings. In my cluster that job belongs to Flux, a GitOps tool. It watches a git repository, and whenever something changes there it applies the change to the cluster, so that what runs is always what is written down. Merging a pull request is deploying.

To watch a repository, Flux has to read it, and my repositories are private. So Flux held a key: first an SSH deploy key, later the private key of a GitHub App, which is GitHub's way of giving a program its own account. Both are stored credentials of exactly the kind these posts are about, and GitHub offers no way around them. It accepts federated tokens from its own Actions runs when they talk to other clouds, but nothing presents a badge to GitHub's own API and gets in.

The way out is to stop the cluster from reading git at all.

Container registries can hold more than container images. An *OCI artifact* uses the same format and the same protocol, but carries whatever files you put in it, and Flux can read its configuration from one instead of from git. So on every merge to the main branch, a CI workflow packages the repository into an artifact and pushes it to the registry from the first part, proving who it is with its GitHub token. Flux polls the registry, sees the new artifact, and applies it. It authenticates the same way the image pulls do: as its own ServiceAccount, with a token the cloud has been told to trust.

<figure class="d2-diagram" role="img" aria-label="Sequence. After a merge, the CI workflow on GitHub pushes the configuration to the cloud registry as the workflow. Every minute, Flux in the cluster asks the registry for anything new, as its own ServiceAccount, receives the new artifact and applies it to the cluster.">
  <img src="/img/diagrams/secret-free-flux-oci.svg" alt="" />
  <figcaption>The cluster's configuration travels through the same registry as its images. Flux never talks to GitHub.</figcaption>
</figure>

The publishing side is two commands in a workflow, using Flux's own command-line tool:

```sh
flux push artifact "oci://<registry>/<repo>/manifests:sha-$GITHUB_SHA" \
  --path . \
  --source "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY" \
  --revision "main@sha1:$GITHUB_SHA"
flux tag artifact "oci://<registry>/<repo>/manifests:sha-$GITHUB_SHA" --tag main
```

Each artifact is stored under the commit it came from, and the `main` tag moves to the newest one. The `--source` and `--revision` flags are worth keeping: they record where the files came from, so Flux can still tell you which git commit it applied, even though it never saw git.

The cluster side replaces the git source with an OCI one, pointing at that tag:

```yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: OCIRepository
metadata:
  name: flux-system
  namespace: flux-system
spec:
  interval: 1m
  url: oci://<registry>/<repo>/manifests
  ref:
    tag: main
  provider: <aws | azure | gcp>
  serviceAccountName: <a ServiceAccount the cloud trusts>
```

Flux does the token exchange itself here; no kubelet plugin is involved. `provider` says which cloud to talk to, and `serviceAccountName` says which identity to use, so each source can have its own and none of them has to share the identity of Flux as a whole. At the time of writing, that per-source identity sits behind a feature flag on Flux's source controller, which has to be switched on.

Moving the source had a side effect I had not planned for, and it removed the second key on my list. Flux can also keep application images up to date: when a new version is published, it writes the new version number into the configuration and commits that to git. That needs write access to the repository, so it needed its own key. It also needed an exemption from branch protection, the rule that nothing reaches the main branch except through a reviewed pull request, because a bot committing straight to main is exactly what that rule forbids. Moving the commit into CI would not have helped: on a personal GitHub account, the token GitHub hands its own CI runs cannot be given that exemption at all. Keeping version updates in git meant keeping a stored credential.

With an artifact in between, it does not have to go through git. For each application, the workflow that builds its artifact looks up the newest image version in the registry and writes it into the files it packages, so the version lives in the artifact and is never committed. Nothing writes to the repository any more, the key that did so is gone, and branch protection stays on without exceptions.

Two things work differently from then on.

Rolling back no longer needs git. Every artifact is still in the registry under its own commit, so going back means moving the `main` tag to an older one. Flux applies it within a minute. The next merge moves the tag forward again, so a rollback that should stick still needs a revert in git, but in an emergency the tag is quicker.

And checking a deploy needs more care, because a command that succeeds is not proof that the cluster runs what you merged. Telling Flux to reconcile can succeed against the artifact it already has, if CI has not pushed the new one yet. What does prove it is the commit Flux reports having applied, which it knows thanks to `--revision` above. Wait for the workflow that publishes the artifact to finish, ask Flux to fetch from the source again, and compare that commit with the one you merged. Anything less tells you a command ran.

# Who may do what

Everything so far rests on one sentence: the cloud has been told which tokens to trust. That sentence is where this setup is secure or not, and it is the part that is easiest to get wrong when you copy it. A key at least makes its danger obvious. A trust rule that is slightly too broad looks exactly like one that is right, and it works just as well, for you and for whoever else it lets in.

Start with what the badge says. A GitHub Actions token carries a few dozen claims, the statements GitHub signs about the run. Trimmed to the ones that matter for access, it looks like this:

```json
{
  "repository_id": "123456789",
  "repository_owner_id": "987654",
  "ref": "refs/heads/main",
  "event_name": "push",
  "job_workflow_ref": "owner/repo/.github/workflows/publish.yml@refs/heads/main"
}
```

Each of these is worth requiring, for a different reason.

- `repository_id` is the repository by number, not by name. Names can be reused: delete a repository, or rename it, and someone can create a new one under the old name. The number belongs to that one repository forever. `repository_owner_id` does the same for the account that owns it.
- `ref` is the branch or tag the run is for. Requiring the main branch means a run for a pull request, or for a branch someone pushed five minutes ago, gets nothing.
- `event_name` is what started the run. A push to main and a manual run on main are different things, and you may want only one of them.
- `job_workflow_ref` names the workflow file that is running, and the branch it was read from. This is the one people leave out, and it matters most for anything that writes. Any workflow in the repository can ask for a token. Without this condition, every workflow on main can push to your registry just as well as the one that was meant to: the one that runs tests, the one somebody adds next year, and any of them that runs a third-party action you have never read.

Every cloud lets you require these, in its own syntax: conditions on a trust policy, a federated credential's subject, or an expression on the provider. Some only look at a single claim, `sub`, a string GitHub builds from a few of the others. GitHub lets you change which claims go into that string, and repositories created since mid-2026 include the numeric IDs in it by default. Find out which claims your cloud actually checks before you rely on one.

The cluster side is simpler, and that is a reason to look at it twice. A pod's token says little more than "ServiceAccount S in namespace N", so the trust rule can only name those. Anyone who can create a pod in that namespace with that ServiceAccount gets its access, so namespace permissions are part of the trust boundary now. My rule admits a short list of named ServiceAccounts, and nothing else in the cluster can get a token the cloud accepts.

Then a rule that is easy to miss: find out how far a grant reaches. On Google, the trust rules sit in groups called pools, and a permission granted to "repository 123456789" applies to tokens admitted by any rule in that pool, not just the one you were thinking of. When a read-only rule and a write rule share a pool, they quietly share each other's access. I keep one pool per kind of privilege for that reason, and one registry repository per source of configuration, because the registry grants access per repository: with a shared one, one project's CI could overwrite another's manifests. Other clouds draw these lines in different places. The habit that carries over is to keep reading and writing in separate trust rules, and to test from the reading side that it cannot write.

That last part is the same lesson as with the image pulls. A rule that lets the right workflow in proves half of what you need. The other half is a workflow it should refuse, and watching it be refused.

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

- Back to the list from part one: of the five long-lived keys, one remains, and nobody can read it.
- The lesson, for the reader's own setup: replace a secret only with something you can test both ways — it lets the right thing in, and it keeps the wrong thing out. Without the second test you have not removed a credential, you have only stopped seeing it.
- Pointers: the plugin, and, if written, follow-ups on application secrets and on review for a one-person cluster.
