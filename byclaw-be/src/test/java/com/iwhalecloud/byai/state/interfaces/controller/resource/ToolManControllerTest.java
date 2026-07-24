package com.iwhalecloud.byai.state.interfaces.controller.resource;

import static org.assertj.core.api.Assertions.assertThat;

import com.iwhalecloud.byai.state.domain.resource.qo.ThirdPartySkillInstallQo;
import org.junit.jupiter.api.Test;

class ToolManControllerTest {

    @Test
    void serializeThirdPartySkillInstallRequestKeepsCompleteParameters() {
        ThirdPartySkillInstallQo request = new ThirdPartySkillInstallQo();
        request.setDigId(10005856L);
        request.setDownloadUrl(
            "https://user:secret@example.com/skills/demo.zip?skillIds=123&token=secret#fragment");

        assertThat(ToolManController.serializeThirdPartySkillInstallRequest(request))
            .isEqualTo("{\"digId\":10005856,"
                + "\"downloadUrl\":\"https://user:secret@example.com/skills/demo.zip"
                + "?skillIds=123&token=secret#fragment\"}");
    }

    @Test
    void serializeThirdPartySkillInstallRequestHandlesNullRequest() {
        assertThat(ToolManController.serializeThirdPartySkillInstallRequest(null)).isEqualTo("null");
    }
}
