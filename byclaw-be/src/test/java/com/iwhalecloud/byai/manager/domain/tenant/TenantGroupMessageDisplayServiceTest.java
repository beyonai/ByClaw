package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class TenantGroupMessageDisplayServiceTest extends I18nTestSupport {
    private final UserService users = mock(UserService.class);
    private final TenantGroupMessageDisplayService service = new TenantGroupMessageDisplayService(users);
    private final ObjectMapper json = new ObjectMapper();

    @Test
    void fillsCurrentUserNamesForMessagesAndRepliesWithoutTouchingForwardSnapshots() {
        Users sender = user(9007199254740993L, "当前用户名");
        Users quoted = user(21L, "引用人用户名");
        when(users.findByIds(anyCollection())).thenReturn(List.of(sender, quoted));
        Map<String, Object> snapshot = Map.of("speaker", Map.of("type", "user", "displayName", "原发言人"),
            "creatorId", "21", "preview", List.of(Map.of("speakerName", "原发言人")));
        Map<String, Object> message = Map.of("creatorId", "9007199254740993", "creatorName", "9007199254740993",
            "speaker", Map.of("type", "user"), "replyTo", Map.of("creatorId", "21",
                "speaker", Map.of("type", "user", "displayName", " \t")), "forward", snapshot);
        var response = Map.of("messages", List.of(message, Map.of("creatorId", "9007199254740993",
            "speaker", Map.of("type", "user"))));

        var result = json.valueToTree(service.resolve(response));

        assertThat(result.path("messages").get(0).path("speaker").path("displayName").asText())
            .isEqualTo("当前用户名");
        assertThat(result.path("messages").get(0).path("replyTo").path("speaker").path("displayName").asText())
            .isEqualTo("引用人用户名");
        assertThat(result.path("messages").get(1).path("speaker").path("displayName").asText())
            .isEqualTo("当前用户名");
        assertThat(result.path("messages").get(0).path("forward")).isEqualTo(json.valueToTree(snapshot));
        assertThat(message.get("speaker")).isEqualTo(Map.of("type", "user"));
        ArgumentCaptor<java.util.Collection<Long>> ids = ArgumentCaptor.forClass(java.util.Collection.class);
        verify(users).findByIds(ids.capture());
        assertThat(ids.getValue()).containsExactlyInAnyOrder(9007199254740993L, 21L);

        sender.setUserName("修改后的用户名");
        assertThat(json.valueToTree(service.resolve(response)).path("messages").get(0).path("speaker")
            .path("displayName").asText()).isEqualTo("修改后的用户名");
    }

    @Test
    void usesLocalizedPlaceholderWhenTheUserProfileIsMissingWithoutExposingStoredIds() {
        when(users.findByIds(anyCollection())).thenReturn(List.of());
        var response = Map.of("messages", List.of(
            Map.of("creatorId", "21", "creatorName", "21", "speaker", Map.of("type", "user")),
            Map.of("creatorId", "invalid", "speaker", Map.of("type", "user")),
            Map.of("speaker", Map.of("type", "user"))));

        var result = json.valueToTree(service.resolve(response)).path("messages");

        for (var message : result) assertThat(message.path("speaker").path("displayName").asText()).isEqualTo("群成员");
        verify(users).findByIds(List.of(21L));
    }

    @Test
    void preservesCurrentNicknamesAndAgentAndSystemNames() {
        var response = Map.of("messages", List.of(
            Map.of("creatorId", "20", "speaker", Map.of("type", "user", "displayName", "当前群昵称")),
            Map.of("creatorId", "20", "speaker", Map.of("type", "agent", "agentName", "员工名称")),
            Map.of("creatorId", "20", "speaker", Map.of("type", "system", "displayName", "系统"))));

        assertThat(service.resolve(response)).isEqualTo(response);
        verifyNoInteractions(users);
    }

    @Test
    void fillsTopicRootAndLastMessageUsingTheSameUserNames() {
        when(users.findByIds(anyCollection())).thenReturn(List.of(user(20L, "当前用户名")));
        var message = Map.of("creatorId", "20", "speaker", Map.of("type", "user"));
        var response = Map.of("items", List.of(Map.of("rootMessage", message, "lastMessage", message)));

        var result = json.valueToTree(service.resolve(response)).path("items").get(0);

        assertThat(result.path("rootMessage").path("speaker").path("displayName").asText()).isEqualTo("当前用户名");
        assertThat(result.path("lastMessage").path("speaker").path("displayName").asText()).isEqualTo("当前用户名");
        verify(users).findByIds(anyCollection());
    }

    private Users user(Long id, String name) {
        Users user = new Users();
        user.setUserId(id);
        user.setUserName(name);
        return user;
    }
}
