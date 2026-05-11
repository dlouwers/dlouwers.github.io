---
title: Transactional Consumer Pattern with Kafka and PostgreSQL
date: 2026-05-10
summary: Co-locating the Kafka offset with business data in a single PostgreSQL transaction gives you exactly-once consumer semantics without a distributed transaction coordinator. A walkthrough in Spring Boot and Kotlin.
tags: [kafka, postgresql, kotlin, spring-boot, distributed-systems]
cover: /img/posts/transactional-consumer/cover.png
coverAlt: Stylised illustration of a distributed system — services and data stores connected by glowing traces.
---

If you've ever consumed from Kafka, written to a database, and then wondered what happens when the JVM dies between the two — this post is about the pattern I reach for. It's commonly called the *transactional consumer*: instead of letting Kafka track where you are, you store the offset in your own database, in the same transaction as the business write. Then you only acknowledge the message back to the broker after that transaction commits.

It is not glamorous, but it gives you exactly-once processing semantics with the tools you already have, and without dragging in a distributed transaction coordinator.

# The dual-writes problem

The naive Kafka consumer does two things:

1. Process the record (write a row to PostgreSQL).
2. Commit the offset back to Kafka.

Both can fail independently. If step 1 succeeds and step 2 crashes, the next consumer rebalance will replay the same message — your business write happens twice. If you flip the order and commit first, then a crash during step 1 loses the message entirely. Either way, you end up papering over the gap with idempotency tricks or — worse — accepting drift.

The reason this is hard is that Kafka and PostgreSQL don't share a transaction. There is no `COMMIT` you can issue across both.

# The pattern

<figure class="d2-diagram" role="img" aria-label="Sequence: poll, then both writes inside one PostgreSQL transaction the consumer opens and commits, then commit the offset back to the broker.">
  <img src="/img/diagrams/transactional-consumer-flow.svg" alt="" />
  <figcaption>Sequence: poll, then both writes inside one PostgreSQL transaction the consumer opens and commits, then commit the offset back to the broker.</figcaption>
</figure>

The trick is to treat the consumer offset as just another row in your database, alongside the business data. A single `BEGIN…COMMIT` covers both writes. The Kafka offset that the broker tracks becomes a hint, not the source of truth — on restart you read the last processed offset from the database and `seek()` the consumer to that position before polling.

The flow:

1. Poll Kafka with auto-commit disabled.
2. In a database transaction, write the business data **and** the new offset row.
3. After the transaction commits, optionally commit the offset back to Kafka so consumer-group lag metrics stay accurate.
4. On crash and restart, ignore Kafka's view of where you were, read from the offset table, and `seek()` to that position.

The database is the only place the truth lives.

# Schema

A composite key keeps one row per `(topic, partition, consumer_group)`:

```sql
CREATE TABLE kafka_offsets (
    topic           VARCHAR(255) NOT NULL,
    partition       INT          NOT NULL,
    offset_value    BIGINT       NOT NULL,
    consumer_group  VARCHAR(255) NOT NULL,
    updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (topic, partition, consumer_group)
);
```

If you run multiple consumer groups against the same database, the `consumer_group` column keeps them from clobbering each other.

# Spring Boot configuration

The single most important line is `enable.auto.commit=false`. With auto-commit, Kafka may acknowledge offsets in the background while your transaction is still open — the whole pattern unravels.

```kotlin
@Configuration
class KafkaConfig {
    @Bean
    fun consumerFactory(): ConsumerFactory<String, String> {
        val props = mapOf(
            ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG to "localhost:9092",
            ConsumerConfig.GROUP_ID_CONFIG to "transactional-consumer",
            ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG to "false",
            ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG to StringDeserializer::class.java,
            ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG to StringDeserializer::class.java,
        )
        return DefaultKafkaConsumerFactory(props)
    }
}
```

# The offset repository

A boring JPA entity and repository — there's nothing clever happening here, and that's the point. The cleverness is in *when* it gets called.

```kotlin
@Entity
@Table(name = "kafka_offsets")
data class KafkaOffset(
    @Id @GeneratedValue
    val id: Long? = null,
    val topic: String,
    val partition: Int,
    val offsetValue: Long,
    val consumerGroup: String,
    val updatedAt: LocalDateTime = LocalDateTime.now(),
)

@Repository
interface KafkaOffsetRepository : JpaRepository<KafkaOffset, Long> {
    fun findByTopicAndPartitionAndConsumerGroup(
        topic: String,
        partition: Int,
        consumerGroup: String,
    ): KafkaOffset?
}
```

# The service

The business write and the offset write live inside the same `@Transactional` boundary. If `orderRepository.save()` throws, the offset never lands either, and the next poll re-delivers the message:

```kotlin
@Service
class TransactionalConsumerService(
    private val offsetRepository: KafkaOffsetRepository,
    private val orderRepository: OrderRepository,
) {
    @Transactional
    fun processMessage(record: ConsumerRecord<String, String>) {
        val order = parseOrder(record.value())
        orderRepository.save(order)

        val existing = offsetRepository.findByTopicAndPartitionAndConsumerGroup(
            record.topic(), record.partition(), "transactional-consumer",
        )
        val offset = existing?.copy(offsetValue = record.offset())
            ?: KafkaOffset(
                topic = record.topic(),
                partition = record.partition(),
                offsetValue = record.offset(),
                consumerGroup = "transactional-consumer",
            )
        offsetRepository.save(offset)
    }
}
```

# The listener

The listener is the only place that talks to Kafka directly. It only commits the offset back to the broker after `processMessage` returns successfully — that is, after the database transaction has committed:

```kotlin
@Component
class OrderConsumer(
    private val consumerService: TransactionalConsumerService,
    private val consumer: KafkaConsumer<String, String>,
) {
    @KafkaListener(topics = ["orders"], groupId = "transactional-consumer")
    fun listen() {
        while (true) {
            val records = consumer.poll(Duration.ofMillis(100))
            records.forEach { record ->
                try {
                    consumerService.processMessage(record)
                    consumer.commitSync(
                        mapOf(
                            TopicPartition(record.topic(), record.partition())
                                to OffsetAndMetadata(record.offset() + 1),
                        ),
                    )
                } catch (e: Exception) {
                    log.error("Failed to process message", e)
                }
            }
        }
    }
}
```

If `commitSync` itself fails, that's fine — the database is still authoritative. The next restart will reseek from the database row.

# Recovery on startup

The recovery step is what makes the database authoritative in practice. On startup, before the first `poll()`, we look up our stored position for every assigned partition and seek the consumer there:

```kotlin
@Component
class ConsumerRecoveryService(
    private val offsetRepository: KafkaOffsetRepository,
    private val consumer: KafkaConsumer<String, String>,
) {
    @PostConstruct
    fun recoverOffsets() {
        consumer.assignment().forEach { partition ->
            val stored = offsetRepository.findByTopicAndPartitionAndConsumerGroup(
                partition.topic(),
                partition.partition(),
                "transactional-consumer",
            )
            stored?.let {
                consumer.seek(partition, it.offsetValue + 1)
                log.info("Recovered offset ${it.offsetValue} for $partition")
            }
        }
    }
}
```

In a real deployment you'd hook this into the consumer rebalance listener so it also runs after rebalances, not just on startup.

# Idempotency is still your problem

Exactly-once *processing* is not the same as exactly-once *delivery*. Kafka can still hand you a message twice — typically across rebalances, where the previous owner committed the database transaction but never got to commit the offset. Your business logic has to cope. The cheapest defence is a unique key on the business row:

```kotlin
fun processOrder(order: Order) {
    val existing = orderRepository.findByOrderId(order.orderId)
    if (existing != null) {
        log.info("Order ${order.orderId} already processed, skipping")
        return
    }
    orderRepository.save(order)
}
```

If you can express the operation as an upsert, do that — it removes the read-then-write race entirely.

# Performance notes

A few things matter once this leaves the laptop:

- **Batch the loop.** Process a poll's worth of records inside a single transaction when ordering allows. Per-record transactions are correct but expensive.
- **Size the connection pool.** One in-flight transaction per consumer thread, plus headroom. Starvation here looks like consumer lag.
- **Partition for parallelism.** The pattern scales horizontally with partitions; the offset table key already accommodates that.
- **`READ_COMMITTED` is usually enough.** Stronger isolation buys you very little here and costs throughput.
- **Watch the right metrics.** Transaction duration, consumer lag, and the age of the most recent offset row tell you most of what you need to know.

# Testing

I test the whole pattern with Testcontainers — a real Kafka and a real PostgreSQL, no mocks. The failure modes this pattern protects against (crash between writes, rebalance mid-transaction) are the ones that *only* show up against the real systems.

```kotlin
@Testcontainers
class TransactionalConsumerTest {
    @Container
    val kafka = KafkaContainer(DockerImageName.parse("confluentinc/cp-kafka:7.4.0"))

    @Container
    val postgres = PostgreSQLContainer("postgres:15")

    @Test
    fun `should process message exactly once`() {
        // produce, kill mid-flight, restart, assert single row.
    }
}
```

The interesting test isn't the happy path — it's killing the consumer between the database commit and the Kafka offset commit, restarting, and asserting that the order didn't get inserted twice.

# When to use Kafka transactions instead

Kafka has had native transactions since 0.11, and Spring Kafka exposes them via `KafkaTransactionManager`. If your pipeline is Kafka-in, Kafka-out — read from one topic, transform, write to another — use those. Native transactions are simpler and more efficient than rolling your own offset table.

The transactional consumer pattern earns its place when one side of the pipeline is **not** Kafka. The moment you're committing to PostgreSQL (or any other database that isn't a Kafka topic), you need atomicity across two systems, and storing the offset on the database side is the cleanest way to get it.

# Wrapping up

The pattern boils down to four rules:

1. Disable auto-commit. Always.
2. Write the offset in the same transaction as the business data.
3. On startup (and rebalance), read the offset from the database, not from Kafka.
4. Make the business write idempotent anyway, because exactly-once delivery is not actually a thing.

It's a pattern with very few moving parts, and that's why I keep coming back to it.
