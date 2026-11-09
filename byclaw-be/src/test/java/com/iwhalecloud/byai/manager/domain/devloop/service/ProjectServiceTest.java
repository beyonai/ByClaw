package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.iwhalecloud.byai.common.constants.devloop.DeleteFlag;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectMapper;
import java.util.List;
import java.util.Set;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 验证运营项目名称查询的企业隔离及历史记录兼容性。 */
class ProjectServiceTest {
    @ParameterizedTest
    @ValueSource(longs = {1L, 42L})
    void projectNamesAreScopedToTheEnterprise(long enterpriseId) {
        if (TableInfoHelper.getTableInfo(Project.class) == null) {
            TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), Project.class);
        }
        ProjectMapper projectMapper = mock(ProjectMapper.class);
        ProjectService projectService = new ProjectService();
        ReflectionTestUtils.setField(projectService, "projectMapper", projectMapper);
        when(projectMapper.selectList(any())).thenAnswer(invocation -> {
            LambdaQueryWrapper<Project> query = invocation.getArgument(0);
            assertThat(query.getSqlSelect()).isEqualTo("project_id,project_name");
            String sql = query.getSqlSegment();
            assertThat(sql).contains("project_id IN", "enterprise_id =", "delete_flag <>", "delete_flag IS NULL");
            if (enterpriseId == 1L) {
                assertThat(sql).contains("OR enterprise_id IS NULL");
            } else {
                assertThat(sql).doesNotContain("enterprise_id IS NULL");
            }
            assertThat(query.getParamNameValuePairs().values())
                .containsExactlyInAnyOrder(71L, enterpriseId, DeleteFlag.DELETED);
            return List.of();
        });

        projectService.findNamesByIds(enterpriseId, Set.of(71L));

        verify(projectMapper).selectList(any());
    }
}
