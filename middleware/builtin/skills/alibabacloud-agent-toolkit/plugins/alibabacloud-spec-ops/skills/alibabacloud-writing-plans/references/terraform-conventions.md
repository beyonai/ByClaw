# Terraform Conventions for Alibaba Cloud

## Provider Configuration

```hcl
terraform {
  required_version = ">= 1.3.0"
  required_providers {
    alicloud = {
      source  = "aliyun/alicloud"
      version = ">= 1.200.0"
    }
  }
}

provider "alicloud" {
  region = var.region
}
```

## File Organization

| File | Contents |
|------|----------|
| `main.tf` | Provider config + primary resources |
| `variables.tf` | All input variables |
| `outputs.tf` | All output values |
| `data.tf` | Data sources (zones, images, etc.) |
| `locals.tf` | Local values and computed expressions |

For larger projects, split by resource group:

- `network.tf` — VPC, VSwitches, Security Groups
- `compute.tf` — ECS, ESS
- `database.tf` — RDS, Redis
- `storage.tf` — OSS, NAS
- `security.tf` — RAM, KMS

## Naming Conventions

### Resources

```hcl
resource "alicloud_instance" "web_server" {
  instance_name = "${var.project}-${var.environment}-web-${count.index + 1}"
  # ...
}
```

### Variables

```hcl
variable "instance_type" {
  description = "ECS instance type for web servers"
  type        = string
  default     = "ecs.g7.large"
}
```

### Tags

```hcl
locals {
  common_tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}
```

## Common Data Sources

```hcl
# Available zones
data "alicloud_zones" "default" {
  available_resource_creation = "VSwitch"
  available_instance_type     = var.instance_type
}

# Latest ECS image
data "alicloud_images" "default" {
  name_regex  = "^ubuntu_22"
  most_recent = true
  owners      = "system"
}

# Instance types
data "alicloud_instance_types" "default" {
  instance_type_family = "ecs.g7"
  cpu_core_count       = 2
  memory_size          = 8
}
```

## Resource Patterns

### VPC + VSwitch + Security Group (Baseline)

```hcl
resource "alicloud_vpc" "main" {
  vpc_name   = "${var.project}-${var.environment}-vpc"
  cidr_block = var.vpc_cidr
  tags       = local.common_tags
}

resource "alicloud_vswitch" "public" {
  count      = length(var.availability_zones)
  vpc_id     = alicloud_vpc.main.id
  cidr_block = cidrsubnet(var.vpc_cidr, 4, count.index)
  zone_id    = var.availability_zones[count.index]
  tags       = local.common_tags
}

resource "alicloud_security_group" "default" {
  name   = "${var.project}-${var.environment}-sg"
  vpc_id = alicloud_vpc.main.id
  tags   = local.common_tags
}
```

### ECS Instance

```hcl
resource "alicloud_instance" "web" {
  count                      = var.instance_count
  instance_name              = "${var.project}-${var.environment}-web-${count.index + 1}"
  instance_type              = var.instance_type
  image_id                   = data.alicloud_images.default.images[0].id
  vswitch_id                 = alicloud_vswitch.public[count.index % length(alicloud_vswitch.public)].id
  security_groups            = [alicloud_security_group.default.id]
  internet_max_bandwidth_out = var.public_access ? 10 : 0
  system_disk_category       = "cloud_essd"
  system_disk_size           = 40
  tags                       = local.common_tags
}
```

### RDS Instance

```hcl
resource "alicloud_db_instance" "main" {
  engine               = "MySQL"
  engine_version       = "8.0"
  instance_type        = var.db_instance_type
  instance_storage     = var.db_storage_size
  instance_name        = "${var.project}-${var.environment}-rds"
  vswitch_id           = alicloud_vswitch.public[0].id
  security_ips         = [var.vpc_cidr]
  zone_id              = var.availability_zones[0]
  zone_id_slave_a      = var.availability_zones[1]
  category             = "HighAvailability"
  tags                 = local.common_tags
}
```

## Security Best Practices in TF

- Never hardcode credentials — use variables with `sensitive = true`
- Use Security Group rules with specific CIDR ranges (never `0.0.0.0/0` for SSH)
- Enable encryption where available (`encrypted = true` for disks)
- Use RAM roles for cross-service access
- Output only non-sensitive values
