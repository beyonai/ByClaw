package com.iwhalecloud.byai.state.domain.groupchat.forward;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import com.iwhalecloud.byai.state.domain.groupchat.forward.application.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.manager.domain.tenant.TenantGroupForwardService;

/** Public detail reads authorize the target and return ordinary upload descriptors. */
class GroupChatForwardQueryServiceTest {
    GroupChatForwardCommitTest fixture;
    GroupChatForwardQueryService query;
    long message;
    final ForwardActor actor=new ForwardActor(30,1);
    @BeforeEach void setup() throws Exception {
        fixture=new GroupChatForwardCommitTest();fixture.setup();
        var ready=fixture.ready();message=fixture.commits.commit(ready).messageIds().getFirst();
        query=new GroupChatForwardQueryService(fixture.fixture.db,new DataSourceTransactionManager(fixture.fixture.db.getDataSource()),fixture.json,
            mock(TenantGroupForwardService.class),mock(ForwardPlatformPolicy.class));
    }
    @Test void ordinaryFileDescriptorsAreReturnedWithoutAForwardDownloadRoute() {
        String files="[{\"fileId\":\"700\",\"fileName\":\"a(1).txt\",\"filePath\":\"/.sessions/20/a(1).txt\",\"fileUrl\":\"/commonFile/preview?filePath=target\",\"size\":3}]";
        fixture.fixture.db.update("UPDATE byai.byai_group_chat_forward_item SET attachments_json=? WHERE bound_message_id=?",files,message);
        var page=query.items(actor,20,message,20,null);
        assertThat(page.items()).hasSize(1);
        assertThat(page.items().getFirst().attachments().getFirst().fileId()).isEqualTo("700");
        assertThat(page.items().getFirst().attachments().getFirst().fileUrl()).startsWith("/commonFile/preview?");
    }
    @Test void readDoesNotRequireSourceMembershipButDoesRequireTargetMembership() {
        fixture.fixture.db.update("DELETE FROM byai.byai_session_member WHERE session_id=10");
        assertThat(query.items(actor,20,message,20,null).items()).hasSize(1);
        fixture.fixture.db.update("DELETE FROM byai.byai_session_member WHERE session_id=20");
        assertThatThrownBy(()->query.items(actor,20,message,20,null)).hasMessage("RESOURCE_NOT_ACCESSIBLE");
    }
    @Test void recalledTargetCannotExposeDetail() {
        fixture.fixture.db.update("UPDATE byai.byai_message SET recalled_at=CURRENT_TIMESTAMP WHERE message_id=?",message);
        assertThatThrownBy(()->query.items(actor,20,message,20,null)).hasMessage("RESOURCE_NOT_ACCESSIBLE");
    }
}
