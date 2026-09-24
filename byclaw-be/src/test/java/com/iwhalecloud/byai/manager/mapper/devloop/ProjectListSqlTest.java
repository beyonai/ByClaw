package com.iwhalecloud.byai.manager.mapper.devloop;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.iwhalecloud.byai.manager.qo.devloop.ProjectQo;

class ProjectListSqlTest {

    @Test
    void excludesHacuProjectsBeforePagination() {
        MybatisConfiguration configuration = new MybatisConfiguration();
        configuration.addMapper(ProjectMapper.class);
        ProjectQo query = new ProjectQo();
        query.setCreateBy(7L);

        String sql = configuration.getMappedStatement(ProjectMapper.class.getName() + ".selectProjectsByQo")
            .getBoundSql(query).getSql();

        assertThat(sql).contains("a.project_type != 'hacu'");
    }
}
