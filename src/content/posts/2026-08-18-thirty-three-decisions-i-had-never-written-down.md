---
title: Thirty-three decisions I had never written down
date: 2026-08-18
summary: My homelab has run since early 2024 without ever being rebuilt. I wrote an architecture decision record for every standing decision in it, each grounded by querying the live cluster rather than by memory. They corrected each other, and the most useful one turned out to be wrong.
tags: [homelab, kubernetes, k3s, architecture, adr]
---

*Part 1 of a series on auditing a two-node homelab. [The rest of the series.](/tags/homelab/)*

There is a particular kind of infrastructure that works and that you cannot explain. Not badly built — mine is fine, it has been up since early 2024 and it serves real people. But ask me in April why the control plane was on the smaller of the two machines, and the honest answer was "because that's where it ended up". Ask why the cluster ran the ingress controller it ran, and the answer was "because the distribution ships it". Neither of those is a decision. They are outcomes wearing a decision's clothes, and after a while you stop being able to tell which of your choices were choices.

So I wrote them all down. Thirty-three architecture decision records in one sitting, one per standing decision, and — this is the part that mattered — each one grounded by reading the repository and querying the live cluster rather than by remembering. This post is about what that turned up, which was not what I expected. The rest of the series is the individual findings.

# The cluster nobody designed

The repository is called `experiments`, and that name was accurate when it was chosen. It was where I did homelab and discovery work — the place for trying things — and the first Kubernetes manifests I ever deployed, the CRDs for a game server, went in it because that is exactly what it was for. When the cluster configuration followed them in, it was not a mismatch. It was the same activity.

What nobody decided is what the repository became. A place for trying things is now the source of truth for a cluster that other people depend on: friends whose game worlds live there, strangers hitting a public relay, applications with their own users. Nothing renamed it, because nothing had to — and renaming it now would break the GitOps bootstrap URL and every app installation pointing at it, so it will keep the name. But `experiments` describes an intent, not a status, and the two stopped matching at some point that nothing in the repository records.

The distribution has the same shape. The cluster runs k3s, and the issue that started the GitOps migration opens with the phrase "bootstrap Flux on the **existing** k3s cluster". The distribution is a premise in that sentence, not a topic. When I went looking for the oldest datable artefact, I found a `kubectl get storageclass` from a debugging session that reported the bundled storage class with an age of `2y70d` — putting the install somewhere around March 2024, two years before any of the work I was documenting. There is no issue, no commit and no comment anywhere recording that an alternative was ever considered.

So one of the thirty-three is an ADR about the distribution, and it is short, and it says all of that outright. Its options section exists mainly to admit that it is retrospective: here is what a replacement would have to beat *now*, since nothing was weighed *then*. Writing "no alternative was seriously evaluated" into a document is uncomfortable in a way that is entirely the point. Hold on to that one — it comes back.

# Two nodes that do not match

<figure class="d2-diagram" role="img" aria-label="Two cluster nodes. mini-server-01 is a mini-PC with 4 vCPU and 15.4 GiB running the k3s server, the sole etcd member, the Flux controllers, CoreDNS and sealed-secrets. mini-server-03 is a laptop with 16 vCPU and 30.8 GiB running the k3s agent, the iGPU, the ingress, notifications, Prometheus, Alertmanager and cert-manager.">
  <img src="/img/diagrams/homelab-node-asymmetry.svg" alt="" />
  <figcaption>The control plane runs on the small node. The second machine died in June 2026 and a laptop replaced it.</figcaption>
</figure>

One node has 4 vCPU and 15.4 GiB. The other has 16 vCPU and 30.8 GiB. The control plane — API server, scheduler, the sole etcd member — is on the small one.

That is not a design. The cluster used to have two roughly matched mini-PCs. One of them died in June 2026 and went back under warranty, and what I had spare was a laptop with four times the cores and twice the memory of the survivor. So the laptop joined as a worker, and the asymmetry has driven everything downstream ever since: four times the CPU and twice the memory sit on the machine that is *not* running the control plane, and the alert that measures whether the cluster can tolerate losing a node has been firing, correctly, for weeks.

The laptop brings its own texture. It needs an out-of-tree driver built by DKMS to cap its battery at 80% so it does not swell while running permanently on mains, and its lid switch has to be neutered so closing it does not suspend a cluster node. That detail turns out to be load-bearing: it is the single reason an immutable, API-driven distribution like Talos is disqualified here. Talos has neither apt nor DKMS, so adopting it means running that node in a configuration that damages its battery, or replacing the node. A hardware decision wearing a distribution costume.

# Writing it down changed what I knew

Here is the part I did not anticipate. Because I wrote them in parallel and checked each one against the live cluster, several of them corrected each other — not each other's *decisions*, but the facts those decisions were resting on. One found that another's object counts were stale. One corrected a memory-headroom figure that a third had already built an argument on top of. One caught a fourth citing a threshold whose justification had been deleted months earlier.

That is a strange and slightly unsettling thing to discover about your own documentation. Every one of those numbers had felt like a fact when I wrote it. What made them checkable was that they were written as measurements — a value, and where it came from — rather than as recollections.

The best of them is worth walking through, because it is the one where the mechanism is clearest.

That distribution ADR — the one whose options section exists to admit there were no options — also had to state what the cluster keeps its state in. I reasoned from absence: the server config carries neither `--cluster-init` nor `--datastore-endpoint`, so it must be on the default embedded SQLite. That is a reasonable inference. I labelled it as an inference, and — because a claim you cannot check is not worth writing — I put the falsifying command in the same paragraph:

```sh
kubectl get node mini-server-01 -o jsonpath='{.metadata.labels}' | tr ',' '\n' | grep etcd
kubectl get etcdsnapshotfile.k3s.cattle.io
```

Then, a few documents later, I was writing about whether to add a third node — and that argument turns on the datastore, because adding a control-plane member to etcd is a *join* while migrating off SQLite is a project. So I ran the command. The first line returned `node-role.kubernetes.io/etcd=true`. The second returned six snapshot objects, twelve hours apart, growing from 56 MB to 84 MB.

The cluster has been on embedded etcd as a single member the whole time. My inference was wrong, and it was wrong in the cluster's favour: the expensive option I had been pricing was much cheaper than I thought.

Now, the obvious question, and one I had to answer for myself at the time. Nothing was stopping me from going back and fixing it. The document was hours old, I was still writing the set, and none of it was load-bearing yet. Editing one paragraph would have cost thirty seconds and left a tidier record.

I didn't, and the reason is the whole method in one line: the wrong inference is the only proof I have that the method works.

Read the corrected version alone and you see a document that was simply right about its datastore, which tells you nothing — most documents claim to be right. Read it with the correction in place and you see something you can actually copy: a claim that was labelled as an inference rather than asserted as fact, shipped next to the command that would settle it, and then settled the other way. That is a demonstration that writing things down this way is self-correcting. Editing it out deletes the demonstration and keeps only the answer.

So the paragraph stays, in the past tense, with the correction attached underneath and a note saying which later document found it. It is the single most useful thing in thirty-three files, and it is the part that was wrong.

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
