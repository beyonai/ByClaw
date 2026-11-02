# Security Checklist for Alibaba Cloud Infrastructure

## Identity & Access Management (RAM)

- [ ] Use RAM roles instead of static AK/SK for services
- [ ] Apply least-privilege principle to all policies
- [ ] Enable MFA for all human users
- [ ] Separate admin and operational accounts
- [ ] Use RAM groups for team permission management
- [ ] Set password policy (complexity, rotation)
- [ ] Review and audit RAM policies regularly

## Network Security

- [ ] Use VPC (never Classic Network for new resources)
- [ ] Configure Security Groups with deny-all default
- [ ] Restrict SSH/RDP access to specific IPs
- [ ] Use internal endpoints where possible
- [ ] Enable DDoS protection (Anti-DDoS Basic is free)
- [ ] Use Web Application Firewall (WAF) for internet-facing apps
- [ ] Enable VPC Flow Logs

## Data Protection

- [ ] Enable encryption at rest for all storage (OSS SSE, RDS TDE, ECS disk encryption)
- [ ] Use HTTPS/TLS for all data in transit
- [ ] Use KMS for key management (not hardcoded keys)
- [ ] Enable versioning for critical data
- [ ] Configure backup policies with tested restore procedures
- [ ] Classify data sensitivity and apply appropriate controls

## Logging & Monitoring

- [ ] Enable ActionTrail for API audit
- [ ] Configure CloudMonitor alerts for critical metrics
- [ ] Enable SLS (Log Service) for application and system logs
- [ ] Set up Security Center for threat detection
- [ ] Configure access logs for SLB, OSS, and API Gateway
- [ ] Retain logs per compliance requirements

## Instance Security

- [ ] Use latest OS images with security patches
- [ ] Disable unnecessary services/ports
- [ ] Configure Cloud Assistant for patch management
- [ ] Use Security Center baseline checks
- [ ] Enable auto-update for security patches
- [ ] Use instance RAM roles (not stored credentials)

## Application Security

- [ ] Validate all input at system boundaries
- [ ] Use parameterized queries (prevent SQL injection)
- [ ] Configure CORS appropriately
- [ ] Implement rate limiting at API Gateway/SLB
- [ ] Use Alibaba Cloud Certificate Service for TLS
- [ ] Scan container images for vulnerabilities
