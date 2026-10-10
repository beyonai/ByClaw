"""Adapt the Harbor OpenGauss entrypoint for isolated tenant databases.

The image creates a gaussdb role with the same password as the initialized
omm role. OpenGauss rejects password reuse during initialization. The upstream
SQL helper also prints the password.
"""

import os
import sys
from pathlib import Path


original = Path("/usr/local/bin/entrypoint.sh").read_text()
log_line = 'echo "Execute SQL: ${query_runner[@]} $@"'
default_user_sql = '''                        create user gaussdb with login password :"passwd" ;
                        grant all privileges to gaussdb;'''
tenant_grant_sql = '                        grant all privileges to :"user" ;'
if (original.count(log_line) != 1 or original.count(default_user_sql) != 1
        or original.count(tenant_grant_sql) != 1):
    raise SystemExit("Unsupported OpenGauss entrypoint version")

patched = original.replace(log_line, 'echo "Execute SQL: [redacted]"')
patched = patched.replace(default_user_sql, '                        -- Tenant role is created by docker_setup_user.')
patched = patched.replace(tenant_grant_sql, '''                        grant all privileges on database :"db" to :"user" ;
EOSQL
                GS_DB= docker_process_sql --dbname "$GS_DB" --set user="$GS_USERNAME" <<-'EOSQL'
                        GRANT USAGE, CREATE ON SCHEMA public TO :"user" ;''')
target = Path("/tmp/byclaw-tenant-entrypoint.sh")
target.write_text(patched)
target.chmod(0o755)
os.execv("/bin/bash", ["/bin/bash", str(target), *sys.argv[1:]])
