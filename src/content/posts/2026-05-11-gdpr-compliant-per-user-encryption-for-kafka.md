---
title: GDPR-Compliant Per-User Encryption for Kafka
date: 2026-05-11
summary: Kafka's log is immutable and replicated everywhere; GDPR demands you make a user's data unreachable on request. Per-user DEKs in Postgres, an Avro envelope on the wire, and crypto-shredding gets you both — without ever mutating Kafka.
tags: [kafka, gdpr, encryption, security, postgresql, distributed-systems]
cover: /img/posts/kafka-pii-encryption/cover.png
coverAlt: Stylised teal padlock over cloud forms, surrounded by circuit traces — secure data over distributed infrastructure.
---

Two of the things you most want from Kafka — durability and immutability — are the same two things GDPR's right-to-erasure tells you to undo on demand. The naive question "how do we delete a user's data from a Kafka topic?" doesn't have a good answer. Compaction is best-effort, tombstones are deferred, and every backup, mirror, and tiered-storage snapshot is one more place the data hides.

This post is about the pattern that sidesteps the question. Instead of deleting the data, you encrypt every PII field with a per-user key, keep that key somewhere you *can* delete (Postgres), and erase the key when the user asks to be forgotten. The Kafka log stays untouched — the ciphertext becomes permanent noise.

# The pattern: KEK/DEK

A two-tier key hierarchy. Each user has their own **Data Encryption Key** (DEK). That DEK encrypts every PII field for that user, in every Kafka topic that carries their data. The DEK itself lives encrypted at rest, wrapped by a single **Key Encryption Key** (KEK) that sits in a managed vault (Azure Key Vault, AWS KMS, Google Cloud KMS — pick your poison).

The split exists because:

- **The KEK is rare and protected.** One key, externally managed, lifecycle-controlled by the vault, never on local disk. Compromise of the KEK is catastrophic — so it's the one thing you never touch except on startup and rotation.
- **DEKs are cheap and disposable.** One per user. Easy to delete (right-to-erasure becomes a single `DELETE`). Compromise of one DEK exposes one user, not the fleet.

The KEK never leaves the encryption service's memory in plaintext form after the initial unwrap. The DEKs never live inside Kafka messages — only their *ciphertext* does, indirectly, by way of the encrypted field values they protected.

# Storage model

```sql
CREATE TABLE user_deks (
    user_id       UUID        PRIMARY KEY,
    encrypted_dek BYTEA       NOT NULL,
    key_id        TEXT        NOT NULL,
    key_version   INT         NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    rotated_at    TIMESTAMPTZ,
    deleted_at    TIMESTAMPTZ,
    deleted_by    TEXT
);
```

Postgres holds the source of truth: one row per user, the DEK stored encrypted-at-rest by the KEK. The `deleted_at` / `deleted_by` columns aren't tombstones — they're audit trail. The actual erasure is a hard `DELETE`, because GDPR doesn't accept "soft delete with a flag".

Redis caches the *plaintext* DEK with a short TTL, keyed by user ID. That cache is the only place plaintext DEKs ever live, and only for as long as the TTL allows. On a user-delete event, the cache entry is invalidated immediately — we don't wait for it to expire.

The read path:

<figure class="d2-diagram" role="img" aria-label="DEK read path: in-process cache miss falls back to Postgres, unwraps via the in-memory KEK, then backfills Redis for the next call.">
  <img src="/img/diagrams/kafka-pii-dek-read-path.svg" alt="" />
  <figcaption>DEK read path: in-process cache miss falls back to Postgres, unwraps via the in-memory KEK, then backfills Redis for the next call.</figcaption>
</figure>

The write path is the inverse: generate a fresh DEK, wrap it with the KEK in memory, `INSERT` into Postgres, populate Redis. The KEK is consulted once on the wrap; never again until the row is read back from cold storage.

# Keep the vault out of the hot path

The most tempting mistake is calling Key Vault on every Kafka message. Don't. The vaults are built for low-frequency, high-trust operations:

- **Latency.** Round-trips to a managed vault land in the 50–300 ms range. Per-message decryption at that latency means a single-digit-throughput consumer.
- **Rate limits.** Vaults rate-limit per region, per vault. Exceed it and you get `429`s that cascade into consumer lag, partition stalls, and (depending on your retry strategy) a self-DoS.

Fetch the KEK once on service startup. Hold it in memory with a bounded lifetime. Rotate by re-fetching when the vault tells you the version changed. The KEK is the only thing in this design that ever talks to the vault at runtime.

# The Avro envelope

Every encrypted PII field on the wire is the same shape — an `EncryptedValue` record with everything a consumer needs to decrypt it, except the DEK itself:

```
record EncryptedValue {
  string  alg;          // e.g. "AES-256-GCM"
  string  keyId;        // identifier of the KEK that wrapped the DEK
  int     keyVersion;   // KEK version for rotation
  bytes   iv;           // unique-per-encryption nonce
  bytes   tag;          // AEAD authentication tag
  bytes   aad;          // optional bound metadata (topic, user, ...)
  bytes   ciphertext;
}
```

For any nullable PII field in a domain schema you declare it as:

```
"type": ["null", "com.yourorg.crypto.EncryptedValue"]
```

This gives you a contract-driven encryption model: producers and consumers share one version-controlled schema, and there's no in-band guessing about *how* a field was encrypted. The `alg` and `keyVersion` fields are what let you migrate algorithms or rotate keys without breaking old messages.

# Keycloak as the identity spine

Keycloak's role here is narrow — it is the source of truth for *who the user is*, not for any keys. Three things matter:

- **Stable user IDs.** Immutable, opaque identifiers that don't change when the user updates their email. Those IDs are the primary key in `user_deks` and the cache key in Redis.
- **Lifecycle events.** Create, update, and — critically — delete events flow out over Keycloak's event SPI. The delete event is what triggers crypto-shredding downstream.
- **Audit log.** Every identity action is timestamped and attributed. That's the compliance evidence regulators ask for; you don't have to build it yourself.

The encryption service subscribes to the delete events. Nothing else in the system needs to know how identity works.

# Crypto-shredding

The right-to-erasure flow is short:

1. Keycloak emits a user-delete event.
2. The encryption service hard-deletes the row in `user_deks`.
3. The encryption service invalidates the Redis entry.
4. All ciphertext encrypted under that DEK becomes — everywhere it exists — permanent noise.

Step four is the magic. Kafka topics, MirrorMaker copies, tiered-storage segments, backup snapshots — none of it moves. Every consumer that reads those messages sees `EncryptedValue` payloads it can no longer decrypt, because the only DEK in the world that could decrypt them is gone. One `DELETE`, deterministic, auditable, and complete across every replica simultaneously.

That's the whole compliance argument: you don't claim Kafka deleted the data; you demonstrate that the data is no longer readable, which is what the regulation actually asks for.

# Why DEKs must never live inside Kafka messages

This is the load-bearing constraint, and it's easy to get wrong if you optimise for "fewer round-trips at decryption time" — for example by attaching the encrypted DEK to each message. Don't.

Kafka is built to make data spread and stay:

- **Replication.** Every message lands on multiple brokers across multiple ISRs, possibly across multiple regions. The encrypted DEK now lives on every replica. You can't reach inside the log and surgically remove specific bytes.
- **Compaction is not deletion.** Compaction keeps the latest value per key; older segments are eligible for cleanup, but Kafka doesn't promise *when* — and compacted segments may keep data on disk indefinitely. Tombstones are deferred, not synchronous.
- **Backup and mirror leakage.** MirrorMaker, tiered storage, snapshot backups — each one is an additional, independently-managed copy of every byte on the topic. The encrypted DEK rides along with all of them.

The whole point of crypto-shredding is that *one* delete erases access everywhere. The moment a DEK lives in the log, you've lost that property — you'd have to chase the key across every replica, every region, every backup, every retention boundary. You can't.

Keep DEKs in Postgres. One key, one delete, done.

# The architecture at a glance

<figure class="d2-diagram" role="img" aria-label="The encryption service in the middle: Keycloak and Key Vault feed in from above; Postgres and Redis hold DEK state; Kafka carries only EncryptedValue payloads.">
  <img src="/img/diagrams/kafka-pii-architecture.svg" alt="" />
  <figcaption>The encryption service in the middle: Keycloak and Key Vault feed in from above; Postgres and Redis hold DEK state; Kafka carries only EncryptedValue payloads.</figcaption>
</figure>

Each peripheral system has a single, bounded responsibility. Keycloak owns identity. Key Vault owns the KEK. Postgres owns DEKs. Redis owns DEK speed. Kafka owns the event log. The Encryption Service is the only component that knows how the pieces fit, and it's the only thing you'd ever rewrite if you swap, say, Keycloak for an OIDC provider or Azure Key Vault for AWS KMS.

# Wrapping up

The pattern reduces to four rules:

1. One DEK per user. Always.
2. DEKs live in Postgres, never in Kafka.
3. Keep the vault off the hot path — KEK is fetched once and cached in memory.
4. Right-to-erasure is a `DELETE` on `user_deks`, not a Kafka operation.

The fourth rule is what GDPR auditors really care about — give them an audit trail of `user_deks` deletions and a demonstration that ciphertext under a deleted key is permanently unreadable, and the immutability of the Kafka log stops being a compliance problem and starts being a feature.
