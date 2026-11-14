package com.iwhalecloud.byai.manager.mapper.groupchat;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/** Payloads retain immutable business snapshots; indexed columns fence ownership, queries and CAS writes. */
@Mapper
public interface GroupHumanTaskMapper {
    @Select("SELECT payload AS \"payload\",sender_type AS \"senderType\",sender_id AS \"senderId\" FROM byai_group_human_task_batch WHERE batch_id=#{id} AND enterprise_id=#{tenant}")
    Map<String,Object> batch(@Param("tenant") Long tenant, @Param("id") Long id);
    @Select("SELECT payload AS \"payload\",sender_type AS \"senderType\",sender_id AS \"senderId\" FROM byai_group_human_task_batch WHERE enterprise_id=#{tenant} AND initiator_user_id=#{actor} AND request_id=#{request}")
    Map<String,Object> proposalRequest(@Param("tenant") Long tenant, @Param("actor") Long actor, @Param("request") String request);
    /** Read every recorded identity so reused or corrupt source sessions cannot silently select another sender. */
    @Select("SELECT group_session_id AS \"groupSessionId\",source_message_id AS \"sourceMessageId\",initiator_user_id AS \"initiatorUserId\",target_agent_id AS \"targetAgentId\" FROM byai_group_chat_execution WHERE candidate_session_id=#{session} UNION ALL SELECT group_session_id AS \"groupSessionId\",source_message_id AS \"sourceMessageId\",initiator_user_id AS \"initiatorUserId\",target_agent_id AS \"targetAgentId\" FROM byai_group_chat_task WHERE task_session_id=#{session}")
    List<Map<String,Object>> creationSources(@Param("session") Long session);
    @Insert("INSERT INTO byai_group_human_task_batch(batch_id,enterprise_id,group_session_id,initiator_user_id,sender_type,sender_id,source_message_id,card_message_id,request_id,payload_hash,status,revision,payload,create_time,update_time) VALUES(#{id},#{tenant},#{group},#{actor},#{senderType},#{senderId},#{source},#{card},#{request},#{hash},#{status},#{revision},#{payload},CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
    int insertBatch(Map<String,Object> row);
    @Update("UPDATE byai_group_human_task_batch SET status=#{status},revision=#{revision},payload=#{payload},card_message_id=#{card},update_time=CURRENT_TIMESTAMP WHERE enterprise_id=#{tenant} AND batch_id=#{id} AND revision=#{expected} AND status='DRAFT'")
    int updateBatch(Map<String,Object> row);
    @Select("SELECT payload FROM byai_group_human_task WHERE enterprise_id=#{tenant} AND human_task_id=#{id}")
    String task(@Param("tenant") Long tenant,@Param("id") Long id);
    @Select("SELECT payload FROM byai_group_human_task WHERE enterprise_id=#{tenant} AND batch_id=#{id} ORDER BY human_task_id")
    List<String> batchTasks(@Param("tenant") Long tenant,@Param("id") Long id);
    @Insert("INSERT INTO byai_group_human_task(human_task_id,enterprise_id,group_session_id,batch_id,initiator_user_id,assignee_user_id,status,revision,latest_version,latest_submission_id,payload,create_time,update_time) VALUES(#{id},#{tenant},#{group},#{batch},#{actor},#{assignee},#{status},#{revision},#{version},#{submission},#{payload},CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
    int insertTask(Map<String,Object> row);
    @Update("UPDATE byai_group_human_task SET status=#{status},revision=#{revision},latest_version=#{version},latest_submission_id=#{submission},payload=#{payload},update_time=CURRENT_TIMESTAMP WHERE enterprise_id=#{tenant} AND human_task_id=#{id} AND revision=#{expected} AND status!='ACCEPTED'")
    int updateTask(Map<String,Object> row);
    /** Returns one page using the same ownership and status predicate as count. */
    List<String> list(Map<String,Object> query);
    /** Counts all matching tasks before pagination. */
    long count(Map<String,Object> query);
    /** Returns group tasks after the service has checked current membership and tenant ownership. */
    List<String> listGroup(Map<String, Object> query);
    /** Counts the same group filters before pagination. */
    long countGroup(Map<String, Object> query);
    /** Aggregates all homepage views in one query without reading task payloads. */
    Map<String,Object> counts(@Param("tenant") Long tenant, @Param("actor") Long actor,
        @Param("groupSessionId") Long groupSessionId);
    @Update("UPDATE byai_group_human_task SET revision=revision WHERE enterprise_id=#{tenant} AND human_task_id=#{id} AND status!='ACCEPTED'")
    int requireOpenForBinding(@Param("tenant") Long tenant,@Param("id") Long id);
    @Select("SELECT human_task_id AS \"humanTaskId\",task_session_id AS \"taskSessionId\",entry_type AS \"entryType\" FROM byai_group_human_task_session WHERE enterprise_id=#{tenant} AND task_session_id=#{id}")
    Map<String,Object> binding(@Param("tenant") Long tenant,@Param("id") Long id);
    @Insert("INSERT INTO byai_group_human_task_session(task_session_id,enterprise_id,human_task_id,entry_type,create_time) VALUES(#{session},#{tenant},#{task},#{type},CURRENT_TIMESTAMP) ON CONFLICT(task_session_id) DO NOTHING")
    int bind(Map<String,Object> row);
    @Select("SELECT payload FROM byai_group_human_task_submission WHERE enterprise_id=#{tenant} AND human_task_id=#{id} ORDER BY version_no DESC")
    List<String> submissions(@Param("tenant") Long tenant,@Param("id") Long id);
    @Select("SELECT payload FROM byai_group_human_task_review WHERE enterprise_id=#{tenant} AND human_task_id=#{id} ORDER BY review_id DESC")
    List<String> reviews(@Param("tenant") Long tenant,@Param("id") Long id);
    @Select("SELECT payload FROM byai_group_human_task_review WHERE enterprise_id=#{tenant} AND human_task_id=#{id} AND request_id=#{request}")
    String reviewRequest(@Param("tenant") Long tenant,@Param("id") Long id,@Param("request") String request);
    @Insert("INSERT INTO byai_group_human_task_submission(submission_id,enterprise_id,human_task_id,version_no,request_id,payload_hash,payload,create_time) VALUES(#{submission},#{tenant},#{id},#{version},#{request},#{hash},#{payload},CURRENT_TIMESTAMP)")
    int insertSubmission(Map<String,Object> row);
    @Insert("INSERT INTO byai_group_human_task_review(review_id,enterprise_id,human_task_id,submission_id,request_id,payload_hash,payload,create_time) VALUES(#{review},#{tenant},#{id},#{submission},#{request},#{hash},#{payload},CURRENT_TIMESTAMP)")
    int insertReview(Map<String,Object> row);
    @Select("SELECT COUNT(*) FROM byai_group_chat_direct_binding WHERE task_session_id=#{session}")
    int ordinaryPrivateBinding(@Param("session") Long session);
    @Delete("DELETE FROM byai_group_chat_pending_publication WHERE task_session_id=#{session} AND pending_publication_id=#{pending}")
    int consumePending(@Param("session") Long session,@Param("pending") Long pending);
    @Select("SELECT payload FROM byai_group_human_task_submit_request WHERE human_task_id=#{id} AND request_id=#{request}")
    String request(@Param("id") Long id,@Param("request") String request);
    @Select("SELECT payload, revision FROM byai_group_human_task_submit_request WHERE human_task_id=#{id} AND request_id=#{request}")
    Map<String,Object> requestState(@Param("id") Long id,@Param("request") String request);
    @Update("UPDATE byai_group_human_task_submit_request SET payload=#{payload},revision=revision+1,update_time=CURRENT_TIMESTAMP WHERE human_task_id=#{id} AND request_id=#{request} AND payload_hash=#{hash} AND revision=#{expected}")
    int checkpointRequest(Map<String,Object> row);
    @Insert("INSERT INTO byai_group_human_task_submit_request(human_task_id,request_id,payload_hash,payload,revision,create_time,update_time) VALUES(#{id},#{request},#{hash},#{payload},0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(human_task_id,request_id) DO NOTHING")
    int insertRequest(Map<String,Object> row);
    @Update("UPDATE byai_group_human_task_submit_request SET payload=#{payload},revision=revision+1,update_time=CURRENT_TIMESTAMP WHERE human_task_id=#{id} AND request_id=#{request} AND payload_hash=#{hash}")
    int updateRequest(Map<String,Object> row);
}
