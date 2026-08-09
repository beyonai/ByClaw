package com.iwhalecloud.byai.manager.application.service.devloop;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.constants.devloop.DeleteFlag;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectRepo;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;

@ExtendWith(MockitoExtension.class)
class ProjectApplicationServiceRepoListTest {

    @Mock
    private ProjectService projectService;

    @Mock
    private ProjectRepoMapper projectRepoMapper;

    @Test
    void listsReposForExistingProject() {
        ProjectApplicationService service = service();
        Project project = new Project();
        project.setProjectId(7L);
        project.setDeleteFlag(DeleteFlag.NORMAL);
        ProjectRepo repo = new ProjectRepo();
        repo.setProjectId(7L);
        when(projectService.findById(7L)).thenReturn(project);
        when(projectRepoMapper.selectList(any())).thenReturn(List.of(repo));

        List<ProjectRepo> result = service.listProjectRepos(7L);

        assertThat(result).containsExactly(repo);
        verify(projectRepoMapper).selectList(any());
    }

    @Test
    void rejectsMissingProjectId() {
        ProjectApplicationService service = service();

        assertThatThrownBy(() -> service.listProjectRepos(null))
            .isInstanceOf(BaseException.class);
    }

    private ProjectApplicationService service() {
        ProjectApplicationService service = new ProjectApplicationService();
        ReflectionTestUtils.setField(service, "projectService", projectService);
        ReflectionTestUtils.setField(service, "projectRepoMapper", projectRepoMapper);
        return service;
    }
}
