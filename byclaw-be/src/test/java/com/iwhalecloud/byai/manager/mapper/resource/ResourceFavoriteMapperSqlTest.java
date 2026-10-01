package com.iwhalecloud.byai.manager.mapper.resource;

import static org.assertj.core.api.Assertions.assertThat;

import com.iwhalecloud.byai.manager.domain.resource.request.ResourceUseAuthQo;
import com.iwhalecloud.byai.manager.qo.index.DiscoverQo;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import org.apache.ibatis.scripting.xmltags.XMLLanguageDriver;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.Test;

class ResourceFavoriteMapperSqlTest {
    @Test
    void ordinaryListsDoNotJoinOrSortByFavorites() throws Exception {
        for (String[] query : queries()) {
            String sql = sql(query[0], query[1], Map.of("userId", 11L));
            assertThat(sql).doesNotContain("byai_resource_favorite", "fc.", "uf.");
            assertThat(sql).contains("order by case when a.resource_status = 3");
        }
    }

    @Test
    void favoriteFilteringAndCountOrderingOccurInsideBothPagedQueries() throws Exception {
        for (String[] query : queries()) {
            Map<String, Object> params = new HashMap<>();
            params.put("userId", 11L);
            params.put("favoriteTenantId", 22L);
            params.put("includeFavorites", true);
            params.put("favoritesOnly", true);
            params.put("employeeGroupFirst", true);
            params.put("includeEmployeeGroup", true);
            String sql = sql(query[0], query[1], params);
            assertThat(sql).contains("fc.com_acct_id = ? and fc.resource_id = a.resource_id")
                .contains("uf.user_id = ? and uf.resource_id = a.resource_id")
                .contains("a.com_acct_id = ?")
                .contains("a.owner_type = 'enterprise' and a.resource_status = 2")
                .contains("and uf.resource_id is not null")
                .contains("order by coalesce(fc.favorite_count, 0) desc")
                .contains("a.resource_id desc")
                .doesNotContain("order by case when b.agent_type = '017'");
        }
    }

    @Test
    void clientCannotSupplyFavoriteTenant() throws Exception {
        var objectMapper = new com.fasterxml.jackson.databind.ObjectMapper();
        String json = "{\"includeFavorites\":true,\"favoriteTenantId\":999}";
        assertThat(objectMapper.readValue(json, DiscoverQo.class).getFavoriteTenantId()).isNull();
        assertThat(objectMapper.readValue(json, ResourceUseAuthQo.class).getFavoriteTenantId()).isNull();
    }

    @Test
    void officialRecommendationsDoNotGainAResourceTenantFilter() throws Exception {
        for (String[] query : queries()) {
            String sql = sql(query[0], query[1], Map.of(
                "userId", 11L, "favoriteTenantId", 22L, "includeFavorites", true,
                "ownerType", "enterprise", "includeAllEnterpriseOwnerType", true));
            assertThat(sql).contains("fc.com_acct_id = ?", "uf.com_acct_id = ?")
                .doesNotContain("a.com_acct_id = ?");
        }
    }

    @Test
    void mutationSqlUsesUniqueKeysAndLocksOnlyCountRow() throws Exception {
        String xml = read("resource/ResourceFavoriteMapper.xml");
        assertThat(xml).contains("on conflict (com_acct_id, user_id, resource_id) do nothing")
            .contains("for update")
            .contains("set favorite_count = favorite_count + #{delta}")
            .doesNotContain("update ss_resource", "update_time", "au_privilege_grant");
    }

    private String[][] queries() {
        return new String[][] {{"index/IndexMapper.xml", "discover"}, {"auth/PrivilegeGrantMapper.xml", "listResourceAuth"}};
    }

    private String sql(String file, String id, Map<String, Object> params) throws Exception {
        String xml = read(file);
        int start = xml.indexOf("<select id=\"" + id + "\"");
        String body = xml.substring(xml.indexOf('>', start) + 1, xml.indexOf("</select>", start));
        var source = new XMLLanguageDriver().createSqlSource(new Configuration(), "<script>" + body + "</script>", Map.class);
        return source.getBoundSql(params).getSql().replaceAll("\\s+", " ");
    }

    private String read(String file) throws Exception {
        try (var input = getClass().getResourceAsStream("/com/iwhalecloud/byai/manager/mapper/" + file)) {
            assertThat(input).isNotNull();
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
