# Alibaba Cloud Best Practices

## Compute (ECS)

- Use VPC-type instances (not Classic Network)
- Enable auto-renewal for subscription instances to avoid unexpected termination
- Use instance families appropriate for workload: general-purpose (g-series), compute-optimized (c-series), memory-optimized (r-series)
- Place instances in multiple Availability Zones for HA
- Use launch templates for consistent configuration
- Enable Cloud Assistant for remote management
- Set appropriate instance metadata security (IMDSv2 preferred)

## Network (VPC)

- Plan CIDR blocks to avoid overlap with on-premises or peered VPCs
- Use at least 2 Availability Zones
- Separate public and private subnets (VSwitches)
- Use NAT Gateway for outbound internet from private subnets
- Enable VPC Flow Logs for audit
- Use Security Groups as primary network ACL (deny-all default)

## Storage (OSS/NAS)

- Enable versioning for critical buckets
- Configure lifecycle rules for cost optimization
- Use server-side encryption (SSE-KMS for sensitive data)
- Enable access logging
- Use appropriate storage class (Standard, IA, Archive)
- Configure cross-region replication for DR

## Database (RDS/PolarDB)

- Deploy in Multi-AZ for production workloads
- Enable automatic backup with appropriate retention
- Use Transparent Data Encryption (TDE)
- Configure appropriate instance specs based on connection count and IOPS needs
- Enable SQL audit for compliance
- Use read replicas for read-heavy workloads

## Security

- Follow principle of least privilege for RAM policies
- Use RAM Roles (not AK/SK) for service-to-service access
- Enable MFA for console access
- Rotate access keys regularly
- Use Security Center for vulnerability scanning
- Enable ActionTrail for audit logging
- Encrypt data at rest and in transit

## Cost Optimization

- Use Savings Plans or Reserved Instances for predictable workloads
- Use preemptible instances for fault-tolerant batch jobs
- Configure auto-scaling for variable workloads
- Use appropriate storage tiers
- Set budget alerts in BSS (Billing)
- Review idle resources regularly

## High Availability

- Deploy across multiple AZs within a region
- Use SLB/ALB for load distribution
- Configure health checks
- Implement auto-scaling policies
- Design for graceful degradation
- Test failover scenarios regularly

## Infrastructure as Code

- Use Terraform with alicloud provider for all infrastructure
- Store state remotely (OSS backend)
- Use modules for reusable components
- Tag all resources consistently
- Version control all IaC code
- Use workspaces or separate state files per environment
