#!/usr/bin/env python3
"""Opt-in SQL acceptance against a newly initialized, disposable PostgreSQL cluster.

Requires initdb, pg_ctl and psql; PG_BIN may name their directory. No Python packages,
existing database, TCP listener, persistent credentials or production fixtures are used.
"""
import concurrent.futures
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading


def main():
    root = Path(__file__).resolve().parents[2]
    default_bin = "/usr/local/opt/postgresql@17/bin"
    binary_dir = os.environ.get("PG_BIN", default_bin if Path(default_bin).is_dir() else "")

    def binary(name):
        candidate = str(Path(binary_dir) / name) if binary_dir else shutil.which(name)
        if not candidate or not Path(candidate).is_file():
            raise RuntimeError(f"Required PostgreSQL binary unavailable: {name}")
        return candidate

    pg_ctl, psql, initdb = map(binary, ("pg_ctl", "psql", "initdb"))
    # The private socket directory isolates this instance even if other servers use the same port.
    with tempfile.TemporaryDirectory(prefix="byclaw-tenant-pg-", dir="/private/tmp") as temporary:
        base = Path(temporary)
        data, socket = base / "data", base / "socket"
        socket.mkdir(mode=0o700)
        env = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
        env.update(PGHOST=str(socket), PGPORT="55439", PGUSER="integration_check", PGDATABASE="postgres")

        def run(arguments, **kwargs):
            return subprocess.run(arguments, env=env, text=True, capture_output=True, timeout=30, **kwargs)

        def sql(statement, expected_error=None):
            result = run([psql, "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", statement])
            if expected_error:
                assert result.returncode != 0 and expected_error in result.stderr, result.stderr
            elif result.returncode:
                raise AssertionError(result.stderr)
            return result.stdout.strip()

        started = False
        try:
            result = run([initdb, "-D", str(data), "-U", "integration_check", "--auth-local=trust", "--auth-host=reject", "--no-locale"])
            assert result.returncode == 0, result.stderr
            result = run([pg_ctl, "-D", str(data), "-l", str(base / "postgres.log"), "-w", "start", "-o",
                          f"-k {socket} -p 55439 -c listen_addresses='' -c max_connections=10"])
            assert result.returncode == 0, result.stderr
            started = True
            print(sql("SELECT version()"))
            sql("""CREATE SCHEMA byai;
                CREATE TABLE byai.tenant_config (
                    enterprise_id bigint NOT NULL, params_code varchar(64) NOT NULL,
                    params_value text NOT NULL, params_version bigint DEFAULT 0,
                    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY(enterprise_id,params_code));
                CREATE TABLE byai.tenant_user_membership (
                    membership_id bigint PRIMARY KEY,enterprise_id bigint NOT NULL,
                    user_id bigint NOT NULL,role varchar(16) NOT NULL,status varchar(16) NOT NULL,
                    UNIQUE(enterprise_id,user_id));""")
            for name in ("internal-commands", "integration-events", "execution-policy"):
                path = root / "deploy/migrations/versions/V0.6.0" / f"V0.6.0-{name}__ddl.sql"
                result = run([psql, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", str(path)])
                assert result.returncode == 0, result.stderr
                print(f"PASS migration {path.name}")

            sql("""INSERT INTO byai.tenant_config VALUES
                (42,'COMMERCIAL_MANAGED','true',0,CURRENT_TIMESTAMP),
                (42,'PACKAGE_CONTENT_SNAPSHOT','{"memberLimit":1}',0,CURRENT_TIMESTAMP);
                INSERT INTO byai.tenant_user_membership VALUES (1,42,1,'OWNER','ACTIVE');""")
            sql("INSERT INTO byai.tenant_user_membership VALUES (2,42,2,'MEMBER','ACTIVE')", "COMMERCIAL_MEMBER_LIMIT_EXCEEDED")
            assert sql("SELECT count(*) FROM byai.tenant_user_membership WHERE enterprise_id=42 AND status='ACTIVE'") == "1"
            print("PASS OWNER admission at limit one; second active member rejected")

            sql("UPDATE byai.tenant_config SET params_value='{\"memberLimit\":2}' WHERE enterprise_id=42 AND params_code='PACKAGE_CONTENT_SNAPSHOT'")
            barrier = threading.Barrier(2)

            def final_seat(member):
                barrier.wait(timeout=10)
                return run([psql, "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c",
                            "BEGIN; INSERT INTO byai.tenant_user_membership VALUES "
                            f"({member},42,{member},'MEMBER','ACTIVE'); SELECT pg_sleep(0.5); COMMIT;"])

            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(final_seat, (3, 4)))
            assert sum(result.returncode == 0 for result in results) == 1, [r.stderr for r in results]
            assert all(r.returncode == 0 or "COMMERCIAL_MEMBER_LIMIT_EXCEEDED" in r.stderr for r in results)
            assert sql("SELECT count(*) FROM byai.tenant_user_membership WHERE enterprise_id=42 AND status='ACTIVE'") == "2"
            print("PASS concurrent final-seat inserts: exactly one commits")

            sql("INSERT INTO byai.tenant_user_membership VALUES (5,42,5,'MEMBER','INACTIVE')")
            sql("UPDATE byai.tenant_user_membership SET status='ACTIVE' WHERE membership_id=5", "COMMERCIAL_MEMBER_LIMIT_EXCEEDED")
            sql("UPDATE byai.tenant_user_membership SET status='INACTIVE' WHERE membership_id IN (3,4)")
            sql("BEGIN; UPDATE byai.tenant_user_membership SET status='ACTIVE' WHERE membership_id=5; ROLLBACK")
            assert sql("SELECT status FROM byai.tenant_user_membership WHERE membership_id=5") == "INACTIVE"
            sql("UPDATE byai.tenant_user_membership SET status='ACTIVE' WHERE membership_id=5")
            print("PASS activation respects capacity; rollback preserves inactive state and available seat")

            outbox_insert = """INSERT INTO byai.integration_outbox VALUES
                ('event-rollback','tenant.created',1,'42','1','1','command-1',CAST('{"data":{"enterpriseId":"42"}}' AS jsonb),CURRENT_TIMESTAMP)"""
            sql("BEGIN; UPDATE byai.tenant_config SET params_version=params_version+100 WHERE enterprise_id=42; "
                + outbox_insert + "; INSERT INTO byai.integration_delivery(event_id,subscription_id,status,attempt,next_attempt_at,fencing_token) VALUES "
                "('event-rollback','first','PENDING',0,CURRENT_TIMESTAMP,0),('event-rollback','second','PENDING',0,CURRENT_TIMESTAMP,0); ROLLBACK")
            assert sql("SELECT count(*) FROM byai.integration_outbox") == "0"
            assert sql("SELECT count(*) FROM byai.integration_delivery") == "0"
            assert sql("SELECT count(*) FROM byai.tenant_config WHERE params_version>=100") == "0"
            print("PASS business mutation, outbox and both subscription deliveries rollback together")

            sql(outbox_insert.replace("event-rollback", "event-fence"))
            sql("INSERT INTO byai.integration_delivery(event_id,subscription_id,status,attempt,next_attempt_at,fencing_token) VALUES "
                "('event-fence','first','PENDING',0,CURRENT_TIMESTAMP,0),('event-fence','second','PENDING',0,CURRENT_TIMESTAMP,0)")
            claim = """WITH claimed AS (UPDATE byai.integration_delivery SET status='PROCESSING',attempt=attempt+1,
                fencing_token=fencing_token+1,lease_until=CURRENT_TIMESTAMP + INTERVAL '120' SECOND
                WHERE event_id='event-fence' AND subscription_id='first' AND fencing_token={fence} AND
                ((status IN ('PENDING','RETRY') AND next_attempt_at<=CURRENT_TIMESTAMP)
                OR (status='PROCESSING' AND lease_until<CURRENT_TIMESTAMP)) RETURNING 1) SELECT count(*) FROM claimed"""
            assert sql(claim.format(fence=0)) == "1"
            assert sql(claim.format(fence=0)) == "0"
            sql("UPDATE byai.integration_delivery SET lease_until=CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE subscription_id='first'")
            acknowledge = """WITH completed AS (UPDATE byai.integration_delivery SET status='DELIVERED',lease_until=NULL
                WHERE event_id='event-fence' AND subscription_id='first' AND status='PROCESSING'
                AND fencing_token={fence} AND lease_until>CURRENT_TIMESTAMP RETURNING 1) SELECT count(*) FROM completed"""
            assert sql(acknowledge.format(fence=1)) == "0"
            assert sql(claim.format(fence=1)) == "1"
            assert sql(acknowledge.format(fence=1)) == "0"
            assert sql(acknowledge.format(fence=2)) == "1"
            assert sql("SELECT status FROM byai.integration_delivery WHERE subscription_id='second'") == "PENDING"
            print("PASS actual delivery claim/lease SQL, stale fence rejection and subscription independence")

            sql("INSERT INTO byai.internal_command(id,source_system,request_id,request_hash,type,enterprise_id,owner_user_id,request_snapshot,status,stage,lease_owner,lease_until,fencing_token) "
                "VALUES (7,'test','request-7','hash','PROVISION',42,1,'{}','RUNNING','DB_CREATE','new-worker',CURRENT_TIMESTAMP+INTERVAL '120 seconds',2)")
            sql("UPDATE byai.internal_command SET lease_until=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE id=7")
            assert sql("WITH done AS (UPDATE byai.internal_command SET status='SUCCEEDED' WHERE id=7 "
                       "AND lease_owner='new-worker' AND fencing_token=2 AND status='RUNNING' "
                       "AND lease_until>CURRENT_TIMESTAMP RETURNING 1) SELECT count(*) FROM done") == "0"
            sql("UPDATE byai.internal_command SET lease_until=CURRENT_TIMESTAMP+INTERVAL '120 seconds' WHERE id=7")
            for token, expected in ((1, "0"), (2, "1")):
                assert sql("WITH done AS (UPDATE byai.internal_command SET status='SUCCEEDED' WHERE id=7 "
                           f"AND lease_owner='new-worker' AND fencing_token={token} AND status='RUNNING' "
                           "AND lease_until>CURRENT_TIMESTAMP RETURNING 1) SELECT count(*) FROM done") == expected
            print("PASS command final completion requires current fencing token and active lease")
            print("ALL CHECKS PASSED; temporary cluster will be stopped and removed")
        finally:
            if started or (data / "postmaster.pid").exists():
                result = run([pg_ctl, "-D", str(data), "-m", "immediate", "-w", "stop"])
                if result.returncode:
                    raise RuntimeError(f"Could not stop own temporary PostgreSQL cluster: {result.stderr}")


if __name__ == "__main__":
    main()
