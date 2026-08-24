package com.iwhalecloud.byai.manager.application.service.devloop;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import com.iwhalecloud.byai.manager.entity.devloop.ScanSource;

/**
 * 锁定「定时对话」自动化的 config 契约：config 存的就是 /chat 输入框的入参（提示词 + @ 资源清单）。
 * 承接员工没有独立字段，只能由 resourceList 里最后一次 @ 的数字员工推出，与前端 mention.ts 同规则；
 * 推不出来必须解析成 null 让调度跳过并记日志，而不是带着空 agentId 去建会话——那会在异步 chat 线程里炸。
 */
class DevloopApplicationServiceChatAutomationTest {

    private final DevloopApplicationService service = new DevloopApplicationService();

    private Object parseConfig(String config) {
        return ReflectionTestUtils.invokeMethod(service, "parseChatAutomationConfig", config);
    }

    private String configWith(String chatContent, String resourceListJson) {
        return "{\"chatContent\":\"" + chatContent + "\",\"resourceList\":" + resourceListJson + "}";
    }

    private String employee(long agentId, String name) {
        return "{\"id\":\"DIG_EMPLOYEE_" + agentId + "\",\"resourceId\":\"" + agentId + "\",\"resourceName\":\"" + name
            + "\",\"resourceType\":\"DIG_EMPLOYEE\"}";
    }

    @SuppressWarnings("unchecked")
    private List<ResourceVo> resourceListOf(Object parsed) {
        return (List<ResourceVo>) ReflectionTestUtils.invokeGetterMethod(parsed, "resourceList");
    }

    @Test
    void parsesPromptAndResourceListFromConfig() {
        Object parsed = parseConfig(configWith("汇总今天的告警", "[" + employee(915, "运维助手") + "]"));

        assertThat(parsed).isNotNull();
        assertThat(ReflectionTestUtils.invokeGetterMethod(parsed, "chatContent")).isEqualTo("汇总今天的告警");
        assertThat(ReflectionTestUtils.invokeGetterMethod(parsed, "agentId")).isEqualTo(915L);
        List<ResourceVo> resourceList = resourceListOf(parsed);
        assertThat(resourceList).hasSize(1);
        assertThat(resourceList.get(0).getResourceName()).isEqualTo("运维助手");
    }

    @Test
    void resolvesAgentFromLastMentionedEmployee() {
        // 用户可能 @ 了多个员工又改主意，最后一个才是承接人；顺序规则与前端 getLastMentionedDigitalEmployeeId 一致。
        Object parsed = parseConfig(
            configWith("先问 A 再问 B", "[" + employee(915, "员工A") + "," + employee(916, "员工B") + "]"));

        assertThat(parsed).isNotNull();
        assertThat(ReflectionTestUtils.invokeGetterMethod(parsed, "agentId")).isEqualTo(916L);
    }

    @Test
    void ignoresNonEmployeeResourcesWhenResolvingAgent() {
        // 知识库、技能等资源也在同一个 resourceList 里，不能被当成承接员工。
        String mixed = "[{\"resourceId\":\"777\",\"resourceType\":\"KG_DOC\"}," + employee(915, "运维助手")
            + ",{\"resourceId\":\"888\",\"resourceType\":\"SKILL\"}]";
        Object parsed = parseConfig(configWith("带上知识库回答", mixed));

        assertThat(parsed).isNotNull();
        assertThat(ReflectionTestUtils.invokeGetterMethod(parsed, "agentId")).isEqualTo(915L);
        // 非员工资源仍要原样带给模型，@ 引用才不会丢。
        assertThat(resourceListOf(parsed)).hasSize(3);
    }

    @Test
    void rejectsConfigWithoutPromptOrWithoutMentionedEmployee() {
        assertThat(parseConfig(configWith("   ", "[" + employee(915, "运维助手") + "]"))).isNull();
        assertThat(parseConfig(configWith("没有 @ 任何人", "[]"))).isNull();
        assertThat(parseConfig("{\"chatContent\":\"根本没有 resourceList\"}")).isNull();
        // @ 了员工但 resourceId 不是数字，同样推不出承接人。
        assertThat(parseConfig(configWith("坏的员工项", "[{\"resourceId\":\"abc\",\"resourceType\":\"DIG_EMPLOYEE\"}]")))
            .isNull();
    }

    @Test
    void rejectsBlankOrBrokenConfigInsteadOfThrowing() {
        // 历史数据或手改坏的 JSON 不能打断整轮调度，只能跳过这一条。
        assertThat(parseConfig(null)).isNull();
        assertThat(parseConfig("")).isNull();
        assertThat(parseConfig("{ 这不是 json")).isNull();
    }

    @Test
    void sessionNameUsesAutomationNameWhileModelStillGetsThePrompt() {
        Object parsed = parseConfig(configWith("汇总今天的告警", "[" + employee(915, "运维助手") + "]"));
        ScanSource source = new ScanSource();
        source.setSourceName("每日告警汇总");

        AssistantChatDto dto = ReflectionTestUtils.invokeMethod(service, "buildChatDtoFromConfig", parsed, source);

        assertThat(dto).isNotNull();
        assertThat(dto.getAgentId()).isEqualTo(915L);
        // 自动化是应用级的，不挂项目：projectId 为空必须能一路传到 DTO，不能被兜成 0 或抛异常。
        assertThat(dto.getProjectId()).isNull();
        // 建会话阶段用自动化名称，会话列表里才能对上是哪条自动化；提示词由调用方在建完会话后覆盖。
        assertThat(dto.getChatContent()).isEqualTo("每日告警汇总");
        assertThat(dto.getSessionId()).isNull();
        assertThat(dto.getAccessTerminal()).isEqualTo("DevLoop");
        // resourceList 必须跟到 DTO，否则提示词里的 @ 引用到模型侧就没了。
        assertThat(dto.getResourceList()).hasSize(1);
    }

    @Test
    void fallsBackToPromptWhenAutomationHasNoName() {
        Object parsed = parseConfig(configWith("汇总今天的告警", "[" + employee(915, "运维助手") + "]"));
        ScanSource source = new ScanSource();

        AssistantChatDto dto = ReflectionTestUtils.invokeMethod(service, "buildChatDtoFromConfig", parsed, source);

        assertThat(dto).isNotNull();
        assertThat(dto.getChatContent()).isEqualTo("汇总今天的告警");
    }
}
