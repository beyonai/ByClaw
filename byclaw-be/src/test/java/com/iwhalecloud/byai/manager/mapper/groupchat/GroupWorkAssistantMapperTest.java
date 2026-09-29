package com.iwhalecloud.byai.manager.mapper.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;

class GroupWorkAssistantMapperTest {
    @Test
    void matchesPlatformAssistantRegardlessOfOwningEnterprise() throws Exception {
        var config = new MybatisConfiguration(new Environment("sqlite", new JdbcTransactionFactory(),
            new UnpooledDataSource("org.sqlite.JDBC", "jdbc:sqlite::memory:", null, null)));
        config.addMapper(GroupWorkAssistantMapper.class);
        try (var session = new SqlSessionFactoryBuilder().build(config).openSession(true);
             var sql = session.getConnection().createStatement()) {
            sql.execute("ATTACH DATABASE ':memory:' AS byai");
            sql.execute("CREATE TABLE byai.ss_resource (resource_id BIGINT PRIMARY KEY, com_acct_id BIGINT, "
                + "owner_type TEXT, resource_biz_type TEXT, resource_status INTEGER, resource_name TEXT)");
            sql.execute("CREATE TABLE byai.ss_res_ext_dig_employee (resource_id BIGINT PRIMARY KEY, agent_type TEXT)");
            sql.execute("INSERT INTO byai.ss_resource VALUES "
                + "(1,20,'enterprise','DIG_EMPLOYEE',2,'群组工作助手'),"
                + "(2,21,'enterprise','DIG_EMPLOYEE',2,'其他助手'),"
                + "(3,20,'personal','DIG_EMPLOYEE',2,'群组工作助手'),"
                + "(4,20,'enterprise','DIG_EMPLOYEE',3,'群组工作助手'),"
                + "(5,20,'enterprise','SKILL',2,'群组工作助手'),"
                + "(6,20,'enterprise','DIG_EMPLOYEE',2,'群组工作助手副本'),"
                + "(7,20,'enterprise','DIG_EMPLOYEE',2,'群组工作助手'),"
                + "(8,20,'enterprise','DIG_EMPLOYEE',2,'Group Work Assistant')");
            sql.execute("INSERT INTO byai.ss_res_ext_dig_employee VALUES "
                + "(1,'001'),(2,'001'),(3,'001'),(4,'001'),(5,'001'),(6,'001'),(7,'017'),(8,'001')");
            var mapper = session.getMapper(GroupWorkAssistantMapper.class);
            assertThat(mapper.findCandidates("群组工作助手")).containsExactly(1L);
            assertThat(mapper.findCandidates("Group Work Assistant")).containsExactly(8L);
            assertThat(mapper.findCandidates("其他助手")).containsExactly(2L);
            assertThat(mapper.findCandidates("不存在的助手")).isEmpty();
            assertThat(mapper.findCandidates("' OR 1=1 --")).isEmpty();
            sql.execute("INSERT INTO byai.ss_resource VALUES (9,99,'enterprise','DIG_EMPLOYEE',2,'群组工作助手')");
            sql.execute("INSERT INTO byai.ss_res_ext_dig_employee VALUES (9,'001')");
            session.clearCache();
            assertThat(mapper.findCandidates("群组工作助手")).containsExactly(1L, 9L);
        }
    }
}
