# Aegis — AWS Enterprise Deployment

> **Status:** Planned for Phase 4.

AWS serverless deployment using Lambda + DynamoDB + Aurora Serverless v2.
Suitable for enterprise deployments requiring AWS-native infrastructure,
VPC isolation, KMS key management, or existing AWS spend commitments.

## Planned Stack

- **API Gateway** → **Lambda** (Fastify on Lambda via `@fastify/aws-lambda`)
- **DynamoDB** — trust score cache (TTL), provider registry, audit log
- **Aurora Serverless v2** — identity graph, vouch graph (Louvain analysis)
- **EventBridge** — scheduled fraud detection (quarterly Louvain), trust decay (daily), provider health (60s)
- **KMS** — EAS attestation signing (private key never in application memory)
- **Secrets Manager** — provider API keys
- **SST Ion** — infrastructure-as-code (TypeScript, OpenTofu/Pulumi)

## Timeline

Targeted for Phase 4 alongside governance launch and x402 payment integration.
See [SPEC.md §16 Roadmap](../../docs/SPEC.md#16-roadmap).

## Contributing

If you need AWS deployment before Phase 4, open an issue — community PRs welcome.
