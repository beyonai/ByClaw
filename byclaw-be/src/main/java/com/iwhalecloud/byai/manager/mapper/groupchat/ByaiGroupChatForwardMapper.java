package com.iwhalecloud.byai.manager.mapper.groupchat;

import com.iwhalecloud.byai.manager.entity.groupchat.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.TargetLease;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.RequestLease;
import java.util.List;
import org.apache.ibatis.annotations.*;

/** Row primitives only: the caller owns the short transaction and group/target lock order. */
@Mapper
public interface ByaiGroupChatForwardMapper {
    /** Renewal preserves ownership/data revision, ignores submitted deadlines, and cannot reacquire expiry. */
    int renewTarget(@Param("lease") TargetLease lease, @Param("leaseMillis") long leaseMillis);
    int renewRequest(@Param("lease") RequestLease lease, @Param("leaseMillis") long leaseMillis);
    int insertRequest(ByaiGroupChatForwardRequest row);
    int insertTarget(ByaiGroupChatForwardTarget row);
    int insertItem(ByaiGroupChatForwardItem row);
    ByaiGroupChatForwardRequest request(@Param("enterpriseId") Long enterpriseId, @Param("requestId") Long requestId);
    ByaiGroupChatForwardRequest requestByKey(
            @Param("enterpriseId") Long enterpriseId,
            @Param("actorUserId") Long actorUserId,
            @Param("clientRequestId") String clientRequestId);
    ByaiGroupChatForwardTarget target(@Param("enterpriseId") Long enterpriseId, @Param("targetId") Long targetId);
    List<ByaiGroupChatForwardTarget> targets(@Param("enterpriseId") Long enterpriseId, @Param("requestId") Long requestId);
    List<ByaiGroupChatForwardItem> items(@Param("enterpriseId") Long enterpriseId, @Param("targetId") Long targetId);
    /** Initial deadlines are calculated by the owning DB from positive milliseconds, never an adapter clock. */
    int claimRequest(
            @Param("enterpriseId") Long enterpriseId,
            @Param("requestId") Long requestId,
            @Param("owner") String owner,
            @Param("leaseMillis") long leaseMillis);
    int freezeSources(
            @Param("enterpriseId") Long enterpriseId,
            @Param("requestId") Long requestId,
            @Param("owner") String owner,
            @Param("version") long version,
            @Param("sourceManifestJson") String sourceManifestJson);
    int claimTarget(
            @Param("enterpriseId") Long enterpriseId,
            @Param("targetId") Long targetId,
            @Param("owner") String owner,
            @Param("leaseMillis") long leaseMillis);
    /** Every successful write consumes the fence; stale or expired workers affect zero rows. */
    int checkpoint(
            @Param("enterpriseId") Long enterpriseId,
            @Param("targetId") Long targetId,
            @Param("owner") String owner,
            @Param("version") long version,
            @Param("checkpointJson") String checkpointJson,
            @Param("state") String state);
    /** Use only inside final message-insert transaction after both group locks and lease validation. */
    int succeedTarget(
            @Param("enterpriseId") Long enterpriseId,
            @Param("targetId") Long targetId,
            @Param("owner") String owner,
            @Param("version") long version,
            @Param("messageIdsJson") String messageIdsJson);
    int failTarget(
            @Param("enterpriseId") Long enterpriseId,
            @Param("targetId") Long targetId,
            @Param("owner") String owner,
            @Param("version") long version,
            @Param("errorCode") String errorCode,
            @Param("retryable") boolean retryable);
    int resetFailedTarget(@Param("enterpriseId") Long enterpriseId, @Param("targetId") Long targetId);
    int updateRequestState(@Param("enterpriseId") Long enterpriseId, @Param("requestId") Long requestId, @Param("state") String state);
    int markDelivered(@Param("enterpriseId") Long enterpriseId, @Param("targetId") Long targetId);
    List<ByaiGroupChatForwardTarget> pendingDeliveries(@Param("enterpriseId") Long enterpriseId, @Param("limit") int limit);
    List<ByaiGroupChatForwardTarget> recoverableTargets(@Param("enterpriseId") Long enterpriseId, @Param("limit") int limit);
    int bindItem(
            @Param("enterpriseId") Long enterpriseId,
            @Param("targetId") Long targetId,
            @Param("itemId") Long itemId,
            @Param("owner") String owner,
            @Param("version") long version,
            @Param("messageId") Long messageId,
            @Param("attachmentsJson") String attachmentsJson);
}
