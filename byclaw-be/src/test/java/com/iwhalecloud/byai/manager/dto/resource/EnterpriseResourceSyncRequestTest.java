package com.iwhalecloud.byai.manager.dto.resource;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;

import com.alibaba.fastjson.JSON;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class EnterpriseResourceSyncRequestTest extends I18nTestSupport {
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
    @Test
    void validationMessagesUseTheRequestLocaleAndKeepFieldNames() {
        String[][] cases = {
            {"{\"resourceBizType\":\"BAD\"}", "不支持的同步资源类型", "Unsupported resource type for synchronization"},
            {"{\"resourceBizType\":\"SKILL\",\"ownerType\":\"personal\"}", "同步资源必须归属企业", "Synchronized resources must belong to an enterprise"},
            {"{\"resourceBizType\":\"SKILL\",\"viewAuth\":true,\"authScope\":null}", "authScope 必须是对象且不能为 null", "authScope must be a non-null object"},
            {"{\"resourceBizType\":\"SKILL\",\"viewAuth\":true,\"authScope\":{\"other\":[]}}", "authScope 含未知字段", "authScope contains unknown fields"},
            {"{\"resourceBizType\":\"SKILL\",\"viewAuth\":true}", "开启查看或自动授权必须提供 authScope", "authScope is required when view access or automatic authorization is enabled"},
            {"{\"resourceBizType\":\"SKILL\",\"authScope\":{}}", "authScope 必须与授权开关一起传入", "authScope must be supplied with an authorization flag"},
            {"{\"resourceBizType\":\"SKILL\",\"viewAuth\":null}", "viewAuth 必须是 boolean 且不能为 null", "viewAuth must be a non-null boolean"},
            {"{\"resourceBizType\":\"SKILL\",\"viewAuth\":true,\"authScope\":{\"userIds\":null}}", "userIds 必须是数组且不能为 null", "userIds must be a non-null array"},
            {"{\"resourceBizType\":\"SKILL\",\"viewAuth\":true,\"authScope\":{\"userIds\":[\"invalid\"]}}", "userIds 含非法 ID", "userIds contains an invalid ID"},
            {"{\"resourceBizType\":\"SKILL\",\"viewAuth\":true,\"authScope\":{\"userIds\":[\"9223372036854775808\"]}}", "userIds 含超出范围的 ID", "userIds contains an out-of-range ID"}
        };
        for (int language = 0; language < 2; language++) {
            org.springframework.context.i18n.LocaleContextHolder.setLocale(
                language == 0 ? java.util.Locale.SIMPLIFIED_CHINESE : java.util.Locale.US);
            for (String[] example : cases) {
                assertThatThrownBy(() -> EnterpriseResourceSyncRequest.parse(JSON.parseObject(example[0])))
                    .isInstanceOf(IllegalArgumentException.class).hasMessage(example[language + 1]);
            }
        }
    }

}
