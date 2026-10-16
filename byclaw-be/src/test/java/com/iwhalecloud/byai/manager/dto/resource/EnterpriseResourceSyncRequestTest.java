package com.iwhalecloud.byai.manager.dto.resource;

import com.alibaba.fastjson.JSON;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class EnterpriseResourceSyncRequestTest {
    @Test void absentFlagsPreserveLegacyBehaviorAndNormalizeEnterpriseOwner() {
        var json = JSON.parseObject("{\"resourceBizType\":\"TOOLKIT\"}");
        var request = EnterpriseResourceSyncRequest.parse(json);
        assertThat(request.viewAuth()).isNull();
        assertThat(request.autoAuthorize()).isNull();
        assertThat(request.scope()).isNull();
        assertThat(json.getString("ownerType")).isEqualTo("enterprise");
    }

    @Test void explicitFalseAndEmptyScopeRemainDistinctFromAbsent() {
        var request = EnterpriseResourceSyncRequest.parse(JSON.parseObject(
            "{\"resourceBizType\":\"SKILL\",\"viewAuth\":false,\"autoAuthorize\":false,\"authScope\":{}}"));
        assertThat(request.viewAuth()).isFalse();
        assertThat(request.autoAuthorize()).isFalse();
        assertThat(request.scope().userIds()).isEmpty();
    }

    @Test void idsAreExactAndDeduplicatedAcrossTheirOwnSubjectType() {
        var request = EnterpriseResourceSyncRequest.parse(JSON.parseObject(
            "{\"resourceBizType\":\"MCP\",\"viewAuth\":true,\"authScope\":{\"userIds\":[\"9007199254740993\",\"9007199254740993\"],\"orgIds\":[12],\"postIds\":[\"12\"]}}"));
        assertThat(request.scope().userIds()).containsExactly(9007199254740993L);
        assertThat(request.scope().orgIds()).containsExactly(12L);
        assertThat(request.scope().postIds()).containsExactly(12L);
    }

    @Test void malformedScopesCannotSilentlyClearAuthorization() {
        for (String fields : new String[]{"\"viewAuth\":null", "\"autoAuthorize\":\"true\"",
            "\"viewAuth\":true", "\"authScope\":{}", "\"viewAuth\":true,\"authScope\":null",
            "\"viewAuth\":true,\"authScope\":{\"userIds\":null}",
            "\"viewAuth\":true,\"authScope\":{\"userIds\":[1.5]}",
            "\"viewAuth\":true,\"authScope\":{\"userIds\":[\"9223372036854775808\"]}",
            "\"viewAuth\":true,\"authScope\":{\"userIds\":[0]}",
            "\"viewAuth\":true,\"authScope\":{\"digitalPostIds\":[1]}"}) {
            assertThatThrownBy(() -> EnterpriseResourceSyncRequest.parse(JSON.parseObject(
                "{\"resourceBizType\":\"KG_DOC\"," + fields + "}"))).isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test void personalResourcesCloudAndEmployeeGroupsAreOutsideThisProtocol() {
        for (String body : new String[]{"{\"resourceBizType\":\"SKILL\",\"ownerType\":\"personal\"}",
            "{\"resourceBizType\":\"KG_CLOUD\"}", "{\"resourceBizType\":\"DIG_EMPLOYEE\"}",
            "{\"resourceBizType\":\"SKILL_GROUP\"}"}) {
            assertThatThrownBy(() -> EnterpriseResourceSyncRequest.parse(JSON.parseObject(body)))
                .isInstanceOf(IllegalArgumentException.class);
        }
    }
}
