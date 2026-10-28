package com.iwhalecloud.byai.manager.domain.tenant.integration;

import java.time.Duration;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Conditional updates own execution; no in-memory lock is an authority for command recovery. */
@Repository
public class TenantCommandStore {
    private final JdbcTemplate jdbc;
    public TenantCommandStore(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public void insert(long id,String source,String request,String hash,String type,long tenant,long owner,String snapshot) {
        jdbc.update("""
            INSERT INTO byai.internal_command(id,source_system,request_id,request_hash,type,enterprise_id,owner_user_id,
            request_snapshot,status,stage) VALUES (?,?,?,?,?,?,?,?,'PENDING','RESERVED')
            """,id,source,request,hash,type,tenant,owner,snapshot);
    }
    public Command find(long id) { return one("SELECT * FROM byai.internal_command WHERE id=?",id); }
    public Command latestProvision(long enterpriseId) {
        return one("SELECT id,source_system,request_id,request_hash,type,enterprise_id,status,stage,error_code,revision "
            + "FROM byai.internal_command WHERE enterprise_id=? AND type='PROVISION' ORDER BY created_at DESC,id DESC LIMIT 1",enterpriseId);
    }
    public Command byRequest(String source,String request) {
        return one("SELECT * FROM byai.internal_command WHERE source_system=? AND request_id=?",source,request);
    }
    /** Technical read leases may renew only after the resource command has released its operation slot. */
    public boolean canRenewTechnicalLease(long enterpriseId) {
        Integer idle = jdbc.queryForObject("SELECT count(*) FROM byai.tenant_runtime_operation "
            + "WHERE enterprise_id=? AND active_command_id IS NULL AND state='IDLE'", Integer.class, enterpriseId);
        return idle != null && idle == 1;
    }

    public String snapshot(long id) {
        return jdbc.queryForObject("SELECT request_snapshot FROM byai.internal_command WHERE id=?",String.class,id);
    }
    private Command one(String sql,Object... args) {
        var rows = jdbc.query(sql,(rs,n) -> new Command(Long.toString(rs.getLong("id")),rs.getString("source_system"),
            rs.getString("request_id"),rs.getString("request_hash"),rs.getString("type"),Long.toString(rs.getLong("enterprise_id")),
            rs.getString("status"),rs.getString("stage"),rs.getString("error_code"),rs.getLong("revision")),args);
        return rows.isEmpty() ? null : rows.getFirst();
    }
    public List<Long> candidates() {
        return jdbc.queryForList("""
            SELECT id FROM byai.internal_command WHERE
            (status IN ('PENDING','RETRY_WAIT') AND next_attempt_at<=CURRENT_TIMESTAMP)
            OR (status='RUNNING' AND lease_until<CURRENT_TIMESTAMP)
            ORDER BY created_at LIMIT 10
            """,Long.class);
    }
    public Lease claim(long id,String worker,Duration duration) {
        // The winner advances the fencing token atomically; old callers cannot save results even after expiry.
        int changed = jdbc.update("""
            UPDATE byai.internal_command SET status='RUNNING',lease_owner=?,lease_until=?,
            fencing_token=fencing_token+1,attempt=attempt+1,revision=revision+1,updated_at=CURRENT_TIMESTAMP
            WHERE id=? AND ((status IN ('PENDING','RETRY_WAIT') AND next_attempt_at<=CURRENT_TIMESTAMP)
            OR (status='RUNNING' AND lease_until<CURRENT_TIMESTAMP))
            """,worker,Timestamp.from(Instant.now().plus(duration)),id);
        if (changed == 0) return null;
        return jdbc.queryForObject("SELECT enterprise_id,fencing_token FROM byai.internal_command WHERE id=? AND lease_owner=?",
            (rs,n) -> new Lease(id,rs.getLong(1),worker,rs.getLong(2)),id,worker);
    }
    public void fence(Lease lease) {
        int changed = jdbc.update("""
            UPDATE byai.internal_command SET updated_at=CURRENT_TIMESTAMP
            WHERE id=? AND lease_owner=? AND fencing_token=? AND status='RUNNING' AND lease_until>CURRENT_TIMESTAMP
            """,lease.id(),lease.worker(),lease.fencingToken());
        if (changed != 1) throw new TenantCommandException(409,"STALE_COMMAND_LEASE");
    }
    @org.springframework.transaction.annotation.Transactional
    public void finish(Lease lease,String status,String stage,String error) {
        fence(lease);
        int changed = jdbc.update("""
            UPDATE byai.internal_command SET status=?,stage=?,error_code=?,revision=revision+1,lease_until=NULL,
            updated_at=CURRENT_TIMESTAMP WHERE id=? AND fencing_token=? AND lease_owner=?
            AND status='RUNNING' AND lease_until>CURRENT_TIMESTAMP
            """,status,stage,error,lease.id(),lease.fencingToken(),lease.worker());
        if (changed != 1) throw new TenantCommandException(409,"STALE_COMMAND_LEASE");
        // An indeterminate provider result keeps its slot, even though the worker no longer owns a lease.
        if ("SUCCEEDED".equals(status)) jdbc.update("""
            UPDATE byai.tenant_runtime_operation SET active_command_id=NULL,state='IDLE',revision=revision+1
            WHERE enterprise_id=? AND active_command_id=?
            """,lease.enterpriseId(),lease.id());
    }
    public record Lease(long id,long enterpriseId,String worker,long fencingToken) { }
    public record Command(String commandId,String sourceSystem,String requestId,String requestHash,String type,
                          String enterpriseId,String status,String stage,String errorCode,long revision) {
        public java.util.Map<String,Object> view() {
            var result = new java.util.LinkedHashMap<String,Object>();
            result.put("commandId",commandId); result.put("enterpriseId",enterpriseId);
            result.put("status",status); result.put("stage",stage); result.put("revision",Long.toString(revision));
            result.put("errorCode",errorCode); result.put("observedAt",Instant.now().toString());
            return result;
        }
    }
}
