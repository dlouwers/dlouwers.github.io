---
title: Thirty-three decisions I had never written down
date: 2026-08-18
summary: My homelab has run for two years and change without ever being rebuilt. I sat down and wrote an architecture decision record for every standing decision in it, grounded by querying the live cluster instead of by memory. Four of them falsified each other.
tags: [homelab, kubernetes, k3s, architecture, adr]
---

*Part 1 of a series on auditing a two-node homelab. [The rest of the series.](/tags/homelab/)*

There is a particular kind of infrastructure that works and that you cannot explain. Not badly built — mine is fine, it has been up for two years and change and it serves real people. But ask me in April why the control plane was on the smaller of the two machines, and the honest answer was "because that's where it ended up". Ask why the cluster ran the ingress controller it ran, and the answer was "because the distribution ships it". Neither of those is a decision. They are outcomes wearing a decision's clothes, and after a while you stop being able to tell which of your choices were choices.

So I wrote them all down. Thirty-three architecture decision records in one sitting, one per standing decision, and — this is the part that mattered — each one grounded by reading the repository and querying the live cluster rather than by remembering. This post is about what that turned up, which was not what I expected. The rest of the series is the individual findings.

# The cluster nobody designed

The repository is called `experiments`. That is a fossil. It started in January 2024 as a scratch place for workstation bootstrapping notes, grew an Advent of Code project in Rust, and acquired a Kubernetes cluster in April 2026 for an entirely mechanical reason: push-based CI could not reach an API server on my LAN, and a repository already existed. Nobody decided to put a cluster in a repo named `experiments`. It is also not moving, because renaming it breaks the GitOps bootstrap URL and the app installations that point at it — a bad name is cheaper than a migration.

The distribution has the same shape. The cluster runs k3s, and the issue that started the GitOps migration opens with the phrase "bootstrap Flux on the **existing** k3s cluster". The distribution is a premise in that sentence, not a topic. When I went looking for the oldest datable artefact, I found a `kubectl get storageclass` from a debugging session that reported the bundled storage class with an age of `2y70d` — putting the install somewhere around March 2024, two years before any of the work I was documenting. There is no issue, no commit and no comment anywhere recording that an alternative was ever considered.

The ADR for that one is short and says so. It has an options section that exists mainly to admit it is retrospective: here is what a replacement would have to beat *now*, since nothing was weighed *then*. Writing "no alternative was seriously evaluated" in a document is uncomfortable in a way that is entirely the point.

# Two nodes that do not match

<figure class="d2-diagram" role="img" aria-label="Two cluster nodes. mini-server-01 is a mini-PC with 4 vCPU and 15.4 GiB running the k3s server, the sole etcd member, the Flux controllers, CoreDNS and sealed-secrets. mini-server-03 is a laptop with 16 vCPU and 30.8 GiB running the k3s agent, the iGPU, the ingress, notifications, Prometheus, Alertmanager and cert-manager.">
  <img src="/img/diagrams/homelab-node-asymmetry.svg" alt="" />
  <figcaption>The control plane runs on the small node. The second machine died in June 2026 and a laptop replaced it.</figcaption>
</figure>

One node has 4 vCPU and 15.4 GiB. The other has 16 vCPU and 30.8 GiB. The control plane — API server, scheduler, the sole etcd member — is on the small one.

That is not a design. The cluster used to have two roughly matched mini-PCs. One of them died in June 2026 and went back under warranty, and what I had spare was a laptop with four times the cores and twice the memory of the survivor. So the laptop joined as a worker, and the asymmetry has driven everything downstream ever since: four times the CPU and twice the memory sit on the machine that is *not* running the control plane, and the alert that measures whether the cluster can tolerate losing a node has been firing, correctly, for weeks.

The laptop brings its own texture. It needs an out-of-tree driver built by DKMS to cap its battery at 80% so it does not swell while running permanently on mains, and its lid switch has to be neutered so closing it does not suspend a cluster node. That detail turns out to be load-bearing: it is the single reason an immutable, API-driven distribution like Talos is disqualified here. Talos has neither apt nor DKMS, so adopting it means running that node in a configuration that damages its battery, or replacing the node. A hardware decision wearing a distribution costume.

# Writing it down changed what I knew

Here is the part I did not anticipate. Several of these documents falsified each other, and one falsified itself.

The distribution ADR needed to say what the datastore was. I reasoned from absence: the server config carries neither `--cluster-init` nor `--datastore-endpoint`, so it must be on the default embedded SQLite. That is a reasonable inference. I labelled it as an inference, and — because a claim you cannot check is not worth writing — I put the falsifying command in the same paragraph:

```sh
kubectl get node mini-server-01 -o jsonpath='{.metadata.labels}' | tr ',' '\n' | grep etcd
kubectl get etcdsnapshotfile.k3s.cattle.io
```

The first returned `node-role.kubernetes.io/etcd=true`. The second returned six snapshot objects, twelve hours apart, growing from 56 MB to 84 MB. The cluster is on embedded etcd as a single member, and has been all along.

This is good news twice over. Practically, it means adding a control-plane node is a *join* rather than a datastore migration, which is materially cheaper than the ADR I was in the middle of writing had assumed — a different document found this and corrected the first one. But the more useful outcome is the shape of the thing: an inference, labelled as an inference, shipped alongside the command that disproved it, inside a document that is now kept with the wrong turn intact rather than quietly rewritten.

Deleting that paragraph would have made the record tidier and taught the next reader nothing.

# Some decisions were never decided

The sharper problem, and the one that made the whole exercise worth the day it cost, is that a homelab accumulates two kinds of decision and they are indistinguishable from the outside.

There are decisions you argued. And there are defaults you inherited: the distribution ships an ingress controller, so the cluster runs that ingress controller. The storage chart defaults to node-local paths, so volumes lived on node-local paths until something broke and someone noticed a game server had been running for 224 days on volumes with a `Delete` reclaim policy and no backup coverage at all.

Neither is wrong. Inherited defaults are usually fine — that is why they are defaults. But you cannot tell them apart by reading the cluster, and the two fail differently: an argued decision fails in a way you anticipated, and an inherited one fails in a way nobody has ever thought about. An ADR set makes the distinction visible, mostly by having entries that honestly admit which kind they are.

# Twelve of them contradict the cluster

The convention I settled on is that an ADR may describe what the homelab *needs* even when the homelab does not do that. Those are filed as `Proposed`, and the gap between the document and the cluster is not an embarrassment to be closed before publishing — it is the signal. Twelve of the thirty-three are in that state. One of them argues for replacing the secrets mechanism that is running in production right now.

Then I applied the tiering from the last ADR written — a scheme that ranks every service by *who notices when it stops* — to the cluster as it actually stood that morning. It convicts fourteen things.

I will spend the rest of this series on the interesting ones, but the headline is worth stating now, because it is the single most useful sentence the whole exercise produced. The most important component in the cluster — the one thing whose failure takes out every service and, worse, takes out the path by which I would be told that anything had failed — is configured like the least important thing running. One replica. No disruption budget. The lowest possible quality-of-service class, which makes it the *first* thing the kernel kills when a node runs short of memory.

Three separate documents noticed that pod was a single replica. None of them fixed it, because none of them could say what standard it was failing.

# Wrapping up

1. **Ground every claim in a command, and write the command down.** The single most valuable thing in thirty-three documents was an inference that turned out to be wrong, and it was only *discoverable* as wrong because the falsifying check shipped next to it.
2. **Say when a decision was never made.** "No alternative was seriously evaluated" is a finding. Reconstructing a flattering rationale for a chart default is worse than admitting you inherited it.
3. **Let the written-down version contradict the running system.** A document that describes what you need is useful before you need it; forcing it to match reality first just means it never gets written.
4. **Keep the wrong turns.** Corrections belong in place, in the past tense, with the reasoning that produced them. The tidied-up version of a record is the version that teaches nobody anything.

None of this made my cluster better. It has exactly the same defects it had the week before, and I have a list now instead of a feeling. But a defect you can name is a defect somebody can fix, and for two years these were not defects at all — they were just the way things were.
