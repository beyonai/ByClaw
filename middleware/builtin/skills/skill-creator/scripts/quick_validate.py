#!/usr/bin/env python3
"""
Quick validation script for skills - minimal version
"""

import re
import sys
import json
from pathlib import Path

import yaml

MAX_SKILL_NAME_LENGTH = 64
RESOURCE_MATE_FILE = Path("references/resourceMate.json")
# Resource-backed script integrations.  Keep this scoped to executable scripts;
# mentioning these names in SKILL.md or references is documentation, not usage.
RESOURCE_MATE_RESOURCE_TOKENS = (
    "callcli", "kbcli", "kdcli", "toolcli", "toolset",
    "knowledgebase", "knowledge_base", "knowledge-base",
)


def resource_clients_used_by_scripts(skill_path):
    referenced = set()
    scripts = skill_path / "scripts"
    if not scripts.is_dir():
        return referenced
    for path in scripts.rglob("*"):
        if not path.is_file():
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for token in RESOURCE_MATE_RESOURCE_TOKENS:
            if re.search(rf"(?<![A-Za-z0-9_-]){re.escape(token)}(?![A-Za-z0-9_-])", content, re.IGNORECASE):
                referenced.add(token)
    return referenced


def resource_mate_resources(skill_path):
    path = skill_path / RESOURCE_MATE_FILE
    if not path.is_file():
        raise ValueError(
            f"{RESOURCE_MATE_FILE} is required when scripts use knowledge-base, tool, or toolset resources"
        )
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"{RESOURCE_MATE_FILE} must be valid JSON") from error
    resources = data.get("resources") if isinstance(data, dict) else None
    if not isinstance(resources, list):
        raise ValueError(f"{RESOURCE_MATE_FILE} must contain a resources array")
    resources = [
        resource
        for resource in resources
        if isinstance(resource, dict)
        and isinstance(resource.get("resourceId"), (str, int))
        and str(resource.get("resourceId")).strip() != ""
        and isinstance(resource.get("resourceType"), str)
        and resource.get("resourceType").strip() != ""
    ]
    return resources


def validate_resource_mate(skill_path):
    referenced = resource_clients_used_by_scripts(skill_path)
    if not referenced:
        return None
    try:
        declared = resource_mate_resources(skill_path)
    except ValueError as error:
        return str(error)
    if not declared:
        return f"{RESOURCE_MATE_FILE} must contain resourceId and resourceType for each resource"
    return None


def validate_skill(skill_path):
    """Basic validation of a skill"""
    skill_path = Path(skill_path)

    resource_mate_error = validate_resource_mate(skill_path)
    if resource_mate_error is not None:
        return False, resource_mate_error

    skill_md = skill_path / "SKILL.md"
    if not skill_md.exists():
        return False, "SKILL.md not found"

    content = skill_md.read_text()
    if not content.startswith("---"):
        return False, "No YAML frontmatter found"

    match = re.match(r"^---\n(.*?)\n---", content, re.DOTALL)
    if not match:
        return False, "Invalid frontmatter format"

    frontmatter_text = match.group(1)

    try:
        frontmatter = yaml.safe_load(frontmatter_text)
        if not isinstance(frontmatter, dict):
            return False, "Frontmatter must be a YAML dictionary"
    except yaml.YAMLError as e:
        return False, f"Invalid YAML in frontmatter: {e}"

    allowed_properties = {"name", "description", "license", "allowed-tools", "metadata"}

    unexpected_keys = set(frontmatter.keys()) - allowed_properties
    if unexpected_keys:
        allowed = ", ".join(sorted(allowed_properties))
        unexpected = ", ".join(sorted(unexpected_keys))
        return (
            False,
            f"Unexpected key(s) in SKILL.md frontmatter: {unexpected}. Allowed properties are: {allowed}",
        )

    if "name" not in frontmatter:
        return False, "Missing 'name' in frontmatter"
    if "description" not in frontmatter:
        return False, "Missing 'description' in frontmatter"

    name = frontmatter.get("name", "")
    if not isinstance(name, str):
        return False, f"Name must be a string, got {type(name).__name__}"
    name = name.strip()
    if name:
        if not re.match(r"^[a-z0-9-]+$", name):
            return (
                False,
                f"Name '{name}' should be hyphen-case (lowercase letters, digits, and hyphens only)",
            )
        if name.startswith("-") or name.endswith("-") or "--" in name:
            return (
                False,
                f"Name '{name}' cannot start/end with hyphen or contain consecutive hyphens",
            )
        if len(name) > MAX_SKILL_NAME_LENGTH:
            return (
                False,
                f"Name is too long ({len(name)} characters). "
                f"Maximum is {MAX_SKILL_NAME_LENGTH} characters.",
            )

    description = frontmatter.get("description", "")
    if not isinstance(description, str):
        return False, f"Description must be a string, got {type(description).__name__}"
    description = description.strip()
    if description:
        if "<" in description or ">" in description:
            return False, "Description cannot contain angle brackets (< or >)"
        if len(description) > 1024:
            return (
                False,
                f"Description is too long ({len(description)} characters). Maximum is 1024 characters.",
            )

    return True, "Skill is valid!"


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python quick_validate.py <skill_directory>")
        sys.exit(1)

    valid, message = validate_skill(sys.argv[1])
    print(message)
    sys.exit(0 if valid else 1)
