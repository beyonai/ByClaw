package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectMapper;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ProjectServiceNameTest {

    private ProjectMapper mapper;
    private ProjectService service;

    @Test
    void isolatesNameChecksToTheSelectedTenant() {
        when(mapper.selectCount(any())).thenReturn(0L);

        service.existsProjectName("workspace", 88L, 10L, null);

        LambdaQueryWrapper<Project> query = capturedQuery();
        assertThat(query.getSqlSegment()).contains("enterprise_id =");
        assertThat(query.getParamNameValuePairs().values()).contains(10L);
    }

    @BeforeEach
    void setUp() {
        if (TableInfoHelper.getTableInfo(Project.class) == null) {
            TableInfoHelper.initTableInfo(
                new MapperBuilderAssistant(new MybatisConfiguration(), ""), Project.class);
        }
        mapper = mock(ProjectMapper.class);
        service = new ProjectService();
        ReflectionTestUtils.setField(service, "projectMapper", mapper);
    }

    @Test
    void checksOnlyUndeletedProjectsOfTheCreator() {
        when(mapper.selectCount(any())).thenReturn(1L);

        assertThat(service.existsProjectName("workspace", 88L, 1L, null)).isTrue();

        LambdaQueryWrapper<Project> query = capturedQuery();
        assertThat(query.getSqlSegment()).contains("create_by =", "project_name =", "delete_flag =")
            .doesNotContain("project_id <>");
        assertThat(query.getParamNameValuePairs().values())
            .containsExactlyInAnyOrder("0", 88L, "workspace", 1L);
    }

    @Test
    void excludesTheEditedProjectWithinItsCreatorScope() {
        when(mapper.selectCount(any())).thenReturn(0L);

        assertThat(service.existsProjectName("workspace", 88L, 1L, 1001L)).isFalse();

        LambdaQueryWrapper<Project> query = capturedQuery();
        assertThat(query.getSqlSegment()).contains("create_by =", "project_id <>");
        assertThat(query.getParamNameValuePairs().values())
            .containsExactlyInAnyOrder("0", 88L, "workspace", 1L, 1001L);
    }

    @SuppressWarnings("unchecked")
    private LambdaQueryWrapper<Project> capturedQuery() {
        ArgumentCaptor<LambdaQueryWrapper<Project>> captor = ArgumentCaptor.forClass(LambdaQueryWrapper.class);
        verify(mapper).selectCount(captor.capture());
        return captor.getValue();
    }
}
