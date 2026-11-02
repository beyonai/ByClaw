# Alibaba Cloud Architecture Patterns

## Pattern 1: Web Application (Standard)

```
Internet → SLB/ALB → ECS (Auto Scaling Group) → RDS (Multi-AZ)
                                               → Redis (Tair)
                                               → OSS (Static Assets)
```

**Components:**

- SLB or ALB for load balancing
- ECS instances in Auto Scaling Group across 2+ AZs
- RDS MySQL/PostgreSQL with Multi-AZ deployment
- Tair (Redis) for caching and sessions
- OSS for static assets, CDN for delivery
- VPC with public and private subnets

**Use when:** Standard web application with moderate traffic

---

## Pattern 2: Microservices (Container)

```
Internet → ALB/Ingress → ACK Cluster → Service Mesh (ASM)
                                      → RDS/PolarDB
                                      → Redis/Tair
                                      → RocketMQ/Kafka
```

**Components:**

- ACK (Container Service for Kubernetes) managed cluster
- ALB Ingress Controller
- ASM (Service Mesh) for service-to-service communication
- PolarDB or RDS for databases
- RocketMQ or Kafka for async messaging
- ARMS for distributed tracing
- SLS for centralized logging

**Use when:** Complex applications with many services, team autonomy needed

---

## Pattern 3: Serverless

```
Internet → API Gateway → Function Compute → TableStore/RDS
                                           → OSS
                                           → MNS/EventBridge
```

**Components:**

- API Gateway for HTTP routing
- Function Compute (FC) for business logic
- TableStore or RDS Serverless for data
- OSS for file storage
- EventBridge for event-driven workflows
- SLS for logging

**Use when:** Variable traffic, cost-sensitive, event-driven workloads

---

## Pattern 4: Data Analytics

```
Sources → DataHub/Kafka → MaxCompute/Flink → DataWorks → QuickBI
                        → SLS (Real-time)
                        → Lindorm (Time-series)
```

**Components:**

- DataHub or Kafka for data ingestion
- MaxCompute for batch processing
- Flink (Realtime Compute) for stream processing
- DataWorks for orchestration
- Lindorm for time-series data
- QuickBI for visualization

**Use when:** Large-scale data processing, analytics, BI

---

## Pattern 5: AI/ML Application

```
Data → PAI-DSW (Development) → PAI-EAS (Serving)
     → Bailian (Model Studio) → API/Agent
     → AI Search → RAG Pipeline
```

**Components:**

- PAI-DSW for model development
- PAI-EAS for model serving
- Bailian (Model Studio) for LLM applications
- AI Search for vector search and RAG
- OSS for model artifacts and datasets
- GPU instances for training

**Use when:** Machine learning, AI applications, LLM-based services

---

## Pattern 6: Hybrid/Multi-Cloud

```
On-Premises ←→ Express Connect/VPN → VPC → Cloud Resources
                                          → CEN (Cross-region)
```

**Components:**

- Express Connect or VPN Gateway for hybrid connectivity
- CEN (Cloud Enterprise Network) for multi-region networking
- DNS for service discovery
- PrivateLink for secure service access
- SAG (Smart Access Gateway) for branch offices

**Use when:** Hybrid cloud, multi-region, branch office connectivity

---

## Cross-Cutting Concerns

### Tagging Strategy

```
Environment: production/staging/development
Project: {project-name}
Owner: {team-name}
CostCenter: {cost-center-id}
ManagedBy: terraform
```

### Naming Convention

```
{environment}-{region-short}-{project}-{resource-type}-{index}
Example: prod-cn-hz-webapp-ecs-001
```

### Environment Separation

- Separate VPCs per environment (not just Security Groups)
- Separate RAM accounts per environment
- Use Terraform workspaces or separate state files
- Tag everything for cost allocation
