package com.iwhalecloud.byai.manager.domain.capability.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.manager.dto.capability.AgentCapabilityCompileInput;
import com.iwhalecloud.byai.manager.dto.capability.AgentCapabilityCompileResult;

/**
 * {@link AgentCapabilityCardService} 确定性裁剪逻辑的单元测试，使用桩草稿生成器避开真实大模型调用。
 *
 * @author tangs
 */
class AgentCapabilityCardServiceTest {

    private AgentCapabilityCardService service;

    private String stubDraft;

    @BeforeEach
    void setUp() {
        service = new AgentCapabilityCardService();
        stubDraft = """
            {
              "summary": "Handles customer support questions",
              "capabilities": ["c1", "c2", "c1", "c3", "c4", "c5", "c6", "c7"],
              "bestFor": ["b1", "b2"],
              "requires": ["r1"],
              "delivers": ["d1"],
              "limitations": [],
              "keywords": ["k1", "k2", "k3"],
              "missingInformation": ["m1"],
              "warnings": []
            }
            """;
        ReflectionTestUtils.setField(service, "generator", (AgentCapabilityDraftGenerator) in -> stubDraft);
    }

    @Test
    void compile_trimsDuplicatesCapsListAndProducesStableFingerprint() {
        AgentCapabilityCompileInput input = input("客服助手", "负责解答客户咨询");

        AgentCapabilityCompileResult result = service.compile(input);

        assertThat(result.getSchemaVersion()).isEqualTo(AgentCapabilityCardService.SCHEMA_VERSION);
        assertThat(result.getGeneratorVersion()).isEqualTo(AgentCapabilityCardService.GENERATOR_VERSION);
        // capabilities 先取前 6 项再去重（与 byclaw-super 一致）：前 6 项 [c1,c2,c1,c3,c4,c5] 去重得 5 个。
        assertThat(result.getCard().getCapabilities()).containsExactly("c1", "c2", "c3", "c4", "c5");
        assertThat(result.getCard().getKeywords()).containsExactly("k1", "k2", "k3");
        // 中文 locale 路由文本使用中文标签并以全角分号分隔。
        assertThat(result.getRoutingText()).startsWith("Handles customer support questions；擅长:");
        assertThat(result.getRoutingText().length()).isLessThanOrEqualTo(500);
        assertThat(result.getSourceFingerprint()).startsWith("sha256:");
        assertThat(result.getQuality().getConfidence()).isEqualTo("high");
    }

    @Test
    void compile_fingerprintIsStableForIdenticalInput() {
        AgentCapabilityCompileInput input = input("客服助手", "负责解答客户咨询");

        String first = service.compile(input).getSourceFingerprint();
        String second = service.compile(input).getSourceFingerprint();

        assertThat(first).isEqualTo(second);
    }

    @Test
    void compile_fingerprintChangesWhenEvidenceChanges() {
        AgentCapabilityCompileInput base = input("客服助手", "负责解答客户咨询");
        String before = service.compile(base).getSourceFingerprint();

        base.getAgent().setDescription("职责扩展为售前与售后");
        String after = service.compile(base).getSourceFingerprint();

        assertThat(after).isNotEqualTo(before);
    }

    @Test
    void compile_rejectsTooFewKeywords() {
        stubDraft = """
            {"summary":"s","capabilities":["c1"],"bestFor":["b1"],"delivers":["d1"],
             "keywords":["k1"]}
            """;
        AgentCapabilityCompileInput input = input("助手", "描述");
        assertThatThrownBy(() -> service.compile(input))
            .isInstanceOf(BaseException.class)
            .hasMessageContaining("too few keywords");
    }

    @Test
    void compile_requiresName() {
        AgentCapabilityCompileInput input = input("  ", "描述");
        assertThatThrownBy(() -> service.compile(input))
            .isInstanceOf(BaseException.class)
            .hasMessageContaining("name is required");
    }

    @Test
    void compile_requiresAtLeastOneEvidence() {
        AgentCapabilityCompileInput input = new AgentCapabilityCompileInput();
        AgentCapabilityCompileInput.Agent agent = new AgentCapabilityCompileInput.Agent();
        agent.setName("无来源助手");
        input.setAgent(agent);

        assertThatThrownBy(() -> service.compile(input))
            .isInstanceOf(BaseException.class)
            .hasMessageContaining("At least one capability source");
    }

    @Test
    void compile_rejectsInvalidModelJson() {
        // 含 JSON 对象定界但内容非法，走解析失败分支。
        ReflectionTestUtils.setField(service, "generator", (AgentCapabilityDraftGenerator) in -> "{not valid json}");
        AgentCapabilityCompileInput input = input("助手", "描述");

        assertThatThrownBy(() -> service.compile(input))
            .isInstanceOf(BaseException.class)
            .hasMessageContaining("invalid JSON");
    }

    @Test
    void compile_rejectsNonObjectModelOutput() {
        // 不含 JSON 对象定界，走 extractJsonObject 失败分支。
        ReflectionTestUtils.setField(service, "generator", (AgentCapabilityDraftGenerator) in -> "not a json object");
        AgentCapabilityCompileInput input = input("助手", "描述");

        assertThatThrownBy(() -> service.compile(input))
            .isInstanceOf(BaseException.class)
            .hasMessageContaining("No JSON object found");
    }

    private AgentCapabilityCompileInput input(String name, String description) {
        AgentCapabilityCompileInput input = new AgentCapabilityCompileInput();
        input.setLocale("zh-CN");
        AgentCapabilityCompileInput.Agent agent = new AgentCapabilityCompileInput.Agent();
        agent.setName(name);
        agent.setDescription(description);
        agent.setInstructions("遵循友好简洁的语调。");
        agent.setSkills(List.of(skill("s1")));
        agent.setTools(List.of());
        agent.setKnowledgeDomains(List.of("售后"));
        input.setAgent(agent);
        return input;
    }

    private AgentCapabilityCompileInput.SourceItem skill(String name) {
        AgentCapabilityCompileInput.SourceItem item = new AgentCapabilityCompileInput.SourceItem();
        item.setName(name);
        return item;
    }
}
