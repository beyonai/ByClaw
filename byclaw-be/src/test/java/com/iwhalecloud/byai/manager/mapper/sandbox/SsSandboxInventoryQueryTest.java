package com.iwhalecloud.byai.manager.mapper.sandbox;

import java.util.*;
import java.util.stream.Collectors;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.session.*;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.assertj.core.api.Assertions.*;

class SsSandboxInventoryQueryTest {
    @Test void onlyLiveIdsParticipateInSearchCountAndPagingAndSwitchingRestoresTheOtherEngine() throws Exception {
        var ds = new DriverManagerDataSource("jdbc:h2:mem:inventory-" + UUID.randomUUID() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1", "sa", "");
        Configuration config = new Configuration(new Environment("test", new JdbcTransactionFactory(), ds));
        String resource = "com/iwhalecloud/byai/manager/mapper/sandbox/SsSandboxRecordMapper.xml";
        try (var input = getClass().getClassLoader().getResourceAsStream(resource)) {
            new XMLMapperBuilder(input, config, resource, config.getSqlFragments()).parse();
        }
        String columns = config.getResultMap(SsSandboxRecordMapper.class.getName() + ".BaseResultMap")
            .getResultMappings().stream().map(m -> m.getColumn() + " " + m.getJdbcType().name()).collect(Collectors.joining(","));
        JdbcTemplate jdbc = new JdbcTemplate(ds);
        jdbc.execute("CREATE TABLE ss_sandbox_record (" + columns + ")");
        jdbc.update("INSERT INTO ss_sandbox_record (id,sandbox_id,owner_scope,user_code,status) VALUES "
            + "(1,'open-id','TENANT','owner','RUNNING'),(2,'acs-one','USER','a','RUNNING'),"
            + "(3,'acs-two','USER','b','FAILED'),(4,'acs-two','USER','b','RUNNING'),"
            + "(5,'deleted-id','USER','a','RUNNING')");
        try (SqlSession session = new SqlSessionFactoryBuilder().build(config).openSession()) {
            var mapper = session.getMapper(SsSandboxRecordMapper.class);
            Map<String, Object> query = new HashMap<>();
            query.put("sandboxIds", List.of("acs-one", "acs-two"));
            query.put("ownerScope", "TENANT"); query.put("pageSize", 1); query.put("offset", 0);
            assertThat(mapper.countInventory(query)).isZero();
            assertThat(mapper.selectInventoryPage(query)).isEmpty();
            query.put("sandboxIds", List.of("open-id"));
            assertThat(mapper.countInventory(query)).isEqualTo(1);
            assertThat(mapper.selectInventoryPage(query).get(0).getSandboxId()).isEqualTo("open-id");
            query.put("sandboxIds", List.of("acs-one", "acs-two")); query.put("ownerScope", "USER");
            assertThat(mapper.countInventory(query)).isEqualTo(2);
            assertThat(mapper.selectInventoryPage(query).get(0).getId()).isEqualTo(4L);
            query.put("offset", 1);
            assertThat(mapper.selectInventoryPage(query).get(0).getId()).isEqualTo(2L);
            query.put("keyword", "a"); query.put("offset", 0);
            assertThat(mapper.countInventory(query)).isEqualTo(1);
            query.put("sandboxIds", List.of());
            assertThat(mapper.countInventory(query)).isZero();
            assertThat(mapper.selectInventoryPage(query)).isEmpty();
        }
    }
}
