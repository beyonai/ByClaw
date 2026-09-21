package com.iwhalecloud.byai.manager.mapper.message;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import com.alibaba.druid.wall.WallConfig;
import com.alibaba.druid.wall.spi.PGWallProvider;
import com.baomidou.mybatisplus.core.MybatisConfiguration;

/** 使用生产版本的 PostgreSQL Wall 解析器验证 MyBatis 实际生成的关键词查询。 */
class GroupChatSearchSqlTest {
    @ParameterizedTest
    @ValueSource(strings = { "报告", "100\\%", "file\\_name", "C:\\\\files", "O'Reilly" })
    void keywordSearchPassesPostgresWall(String keyword) {
        var configuration = new MybatisConfiguration();
        configuration.addMapper(ByaiMessageMapper.class);
        String sql = configuration.getMappedStatement(ByaiMessageMapper.class.getName() + ".searchVisibleGroupMessages")
            .getBoundSql(Map.of("sessionId", 10L, "keyword", keyword, "scope", "ALL", "senderType", "ALL",
                "userId", 7L, "limit", 20)).getSql();
        assertThat(new PGWallProvider(new WallConfig()).check(sql).getViolations()).isEmpty();
        assertThat(sql).contains("message.message_content IS NOT NULL");
        assertThat(sql).doesNotContain("TRIM(message.related_resources)");
    }
}
