# Validation Rules

## Spec Compliance Rules

### Resource Coverage

- [ ] Every resource in design.md has a corresponding Terraform resource
- [ ] Resource specifications match (instance type, size, version)
- [ ] Region/AZ placement matches design
- [ ] Network topology is correct (VPC, subnets, routing)
- [ ] Security groups implement the designed access rules
- [ ] No extra resources that weren't in the design

### Requirement Traceability

- [ ] Each design requirement maps to at least one resource
- [ ] High availability requirements are implemented (multi-AZ)
- [ ] Backup/DR requirements are configured
- [ ] Cost constraints are respected (instance sizing)

---

## Code Quality Rules

### Structure

- [ ] Provider version is pinned with `>=` constraint
- [ ] Required Terraform version specified
- [ ] Files are logically organized (main, variables, outputs)
- [ ] No circular dependencies

### Naming

- [ ] Resources use snake_case
- [ ] Resource names are descriptive and consistent
- [ ] Variables have descriptions
- [ ] Variables have appropriate types
- [ ] Outputs have descriptions

### Security

- [ ] No hardcoded credentials or secrets
- [ ] Sensitive variables marked with `sensitive = true`
- [ ] No open 0.0.0.0/0 for SSH (port 22) or RDP (port 3389)
- [ ] Encryption enabled where available (disk, RDS TDE, OSS SSE)
- [ ] Security group rules are specific (not overly permissive)
- [ ] RAM roles used instead of static keys

### Best Practices

- [ ] All resources are tagged with common tags
- [ ] Variables have sensible defaults where appropriate
- [ ] `count` or `for_each` used for repetitive resources
- [ ] Data sources used for dynamic values (zones, images)
- [ ] Outputs defined for important values (IDs, IPs, endpoints)
- [ ] No deprecated resource attributes

### Maintainability

- [ ] Complex expressions use locals for readability
- [ ] Comments explain non-obvious decisions
- [ ] Variable defaults don't contain environment-specific values
- [ ] Module boundaries are clean (if modules used)

---

## Remote Validation Rules

### IaC Service validate-module

- [ ] Terraform syntax is valid
- [ ] Provider schema validates all attributes
- [ ] Resource type names are correct
- [ ] Required arguments are present
- [ ] Data type constraints are satisfied

### Common Syntax Issues

- Missing required argument (e.g., `vswitch_id` for VPC resources)
- Invalid attribute name (typos, deprecated names)
- Type mismatch (string vs number)
- Missing provider configuration
- Circular reference between resources
