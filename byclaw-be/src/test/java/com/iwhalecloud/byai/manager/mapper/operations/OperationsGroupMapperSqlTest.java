package com.iwhalecloud.byai.manager.mapper.operations;

import java.io.InputStream;
import java.util.Map;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.io.Resources;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class OperationsGroupMapperSqlTest {
    @Test
    void optionalFiltersAreOnlyIncludedWhenPresent() throws Exception {
        String resource = "com/iwhalecloud/byai/manager/mapper/operations/OperationsGroupMapper.xml";
        Configuration configuration = new Configuration();
        try (InputStream input = Resources.getResourceAsStream(resource)) {
            new XMLMapperBuilder(input, configuration, resource, configuration.getSqlFragments()).parse();
        }
        var statement = configuration.getMappedStatement(OperationsGroupMapper.class.getName() + ".groups");
        String unfiltered = statement.getBoundSql(Map.of("enterpriseId", 1L, "keyword", "", "status", "")).getSql();
        assertThat(unfiltered).doesNotContain("POSITION(").doesNotContain("COALESCE(g.state, 'ACTIVE') = ?");
        String filtered = statement.getBoundSql(Map.of("enterpriseId", 1L, "keyword", "test", "status", "ACTIVE")).getSql();
        assertThat(filtered).contains("POSITION(").contains("COALESCE(g.state, 'ACTIVE') = ?");
    }
}
