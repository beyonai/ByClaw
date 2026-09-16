package com.iwhalecloud.byai.state.domain.message.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.InputStream;
import java.util.Map;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.Test;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;

class FinalContentMapperTest {
    @Test
    void explicitReplacementClearsNullFinalButUnrelatedUpdatesLeaveItUntouched() throws Exception {
        String resource = "com/iwhalecloud/byai/manager/mapper/message/ByaiMessageMapper.xml";
        Configuration configuration = new Configuration();
        try (InputStream input = getClass().getClassLoader().getResourceAsStream(resource)) {
            new XMLMapperBuilder(input, configuration, resource, configuration.getSqlFragments()).parse();
        }
        ByaiMessageHotDto message = new ByaiMessageHotDto();
        message.setMessageId(1L);
        message.setMessageContent("regenerated");
        String statement = "com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper.updateByMessageId";
        assertThat(configuration.getMappedStatement(statement).getBoundSql(Map.of("item", message)).getSql())
            .doesNotContain("final_content =");
        message.setReplaceFinalContent(true);
        assertThat(configuration.getMappedStatement(statement).getBoundSql(Map.of("item", message)).getSql())
            .contains("final_content = ?");
        assertThat(message.getFinalContent()).isNull();
    }
}
