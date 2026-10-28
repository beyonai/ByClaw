package com.iwhalecloud.byai.state.domain.groupchat.forward;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.tenant.TenantGroupForwardService;
import com.iwhalecloud.byai.state.domain.groupchat.forward.application.ForwardPlatformPolicy;
import com.iwhalecloud.byai.state.domain.groupchat.forward.application.GroupChatForwardQueryService;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.ForwardActor;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;

/** Public detail reads authorize the target and return ordinary upload descriptors. */
class GroupChatForwardQueryServiceTest {
    JdbcTemplate db;
    GroupChatForwardQueryService query;
    final long message = 500L;
    final ForwardActor actor = new ForwardActor(30, 1);

    @BeforeEach
    void setup() throws Exception {
        var source = new DriverManagerDataSource(
            "jdbc:h2:mem:forward-query-" + UUID.randomUUID() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1", "sa", "");
        db = new JdbcTemplate(source);
        db.execute("CREATE SCHEMA byai");
        db.execute("CREATE TABLE byai.byai_session(session_id BIGINT PRIMARY KEY, enterprise_id BIGINT, session_type VARCHAR, state VARCHAR)");
        db.execute("CREATE TABLE byai.byai_session_member(byai_session_member_id BIGINT PRIMARY KEY, session_id BIGINT, mem_obj_type VARCHAR, mem_obj_id BIGINT)");
        db.execute("CREATE TABLE byai.byai_message(message_id BIGINT PRIMARY KEY, session_id BIGINT, usage INT, recalled_at TIMESTAMP, archived_at TIMESTAMP)");
        db.execute(Files.readString(Path.of("../deploy/migrations/versions/V0.6.0/V0.6.0__ddl.sql"))
            .replace("SET search_path TO byai;", "SET SCHEMA byai;"));

        // 查询用例直接准备已提交快照，避免通过转发创建和提交用例间接启动 Redis。
        // 保留真实 JDBC、转发表结构及查询 SQL，继续验证目标群授权和快照读取边界。
        db.update("INSERT INTO byai.byai_session VALUES (10,1,'hs_as','ACTIVE'),(20,1,'hs_as','ACTIVE')");
        db.update("INSERT INTO byai.byai_session_member(byai_session_member_id,session_id,mem_obj_type,mem_obj_id) VALUES (1,10,'USER',30),(2,20,'USER',30)");
        db.update("INSERT INTO byai.byai_message(message_id,session_id,usage) VALUES (?,20,1)", message);
        db.update("""
            INSERT INTO byai.byai_group_chat_forward_request
                (request_id,enterprise_id,actor_user_id,backend,source_session_id,client_request_id,
                 mode,request_hash,state,snapshot_version,frozen_json,sources_frozen)
            VALUES (100,1,30,'LEGACY',10,'query','SINGLE',?,'SUCCEEDED',1,'[]',TRUE)
            """, "a".repeat(64));
        db.update("""
            INSERT INTO byai.byai_group_chat_forward_target
                (target_id,enterprise_id,request_id,target_session_id,state,message_ids_json)
            VALUES (200,1,100,20,'SUCCEEDED',?)
            """, "[\"" + message + "\"]");
        db.update("""
            INSERT INTO byai.byai_group_chat_forward_item
                (item_id,enterprise_id,request_id,target_id,ordinal,selected_message_id,
                 selected_merged_card,source_message_id,content,speaker_json,source_created_at,bound_message_id)
            VALUES (300,1,100,200,0,101,FALSE,101,'earlier',
                '{"type":"USER","id":"30","name":"sender"}',TIMESTAMP '2026-10-16 00:00:00',?)
            """, message);
        query = new GroupChatForwardQueryService(db, new DataSourceTransactionManager(source),
            new ObjectMapper().findAndRegisterModules(), mock(TenantGroupForwardService.class), mock(ForwardPlatformPolicy.class));
    }
    @AfterEach
    void closeDatabase() {
        if (db != null) db.execute("SHUTDOWN");
    }

    @Test
    void ordinaryFileDescriptorsAreReturnedWithoutAForwardDownloadRoute() {
        String files="[{\"fileId\":\"700\",\"fileName\":\"a(1).txt\",\"filePath\":\"/.sessions/20/a(1).txt\",\"fileUrl\":\"/commonFile/preview?filePath=target\",\"size\":3}]";
        db.update("UPDATE byai.byai_group_chat_forward_item SET attachments_json=? WHERE bound_message_id=?",files,message);
        var page=query.items(actor,20,message,20,null);
        assertThat(page.items()).hasSize(1);
        assertThat(page.items().getFirst().attachments().getFirst().fileId()).isEqualTo("700");
        assertThat(page.items().getFirst().attachments().getFirst().fileUrl()).startsWith("/commonFile/preview?");
    }

    @Test
    void readDoesNotRequireSourceMembershipButDoesRequireTargetMembership() {
        db.update("DELETE FROM byai.byai_session_member WHERE session_id=10");
        assertThat(query.items(actor,20,message,20,null).items()).hasSize(1);
        db.update("DELETE FROM byai.byai_session_member WHERE session_id=20");
        assertThatThrownBy(()->query.items(actor,20,message,20,null)).hasMessage("RESOURCE_NOT_ACCESSIBLE");
    }

    @Test
    void recalledTargetCannotExposeDetail() {
        db.update("UPDATE byai.byai_message SET recalled_at=CURRENT_TIMESTAMP WHERE message_id=?",message);
        assertThatThrownBy(()->query.items(actor,20,message,20,null)).hasMessage("RESOURCE_NOT_ACCESSIBLE");
    }
}
