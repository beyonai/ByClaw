package com.iwhalecloud.byai.manager.application.service.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.storage.KnowledgeResourceFS;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.application.service.fs.FsOperationApplicationService;

class ProjectCloudReadPermissionTest {
    private final ProjectService projects = mock(ProjectService.class);
    private final ProjectMemberService members = mock(ProjectMemberService.class);
    private final AuthApplicationService auth = new AuthApplicationService();
    private final SsResource cloud = new SsResource();

    @BeforeEach
    void setUp() {
        LoginInfo login = new LoginInfo();
        login.setUserId(88L);
        login.setUserCode("member");
        CurrentUserHolder.setLoginInfo(login);
        ReflectionTestUtils.setField(auth, "projectService", projects);
        ReflectionTestUtils.setField(auth, "projectMemberService", members);
        cloud.setResourceId(9001L);
        cloud.setResourceBizType("KG_CLOUD");
    }

    @AfterEach
    void clearLogin() {
        CurrentUserHolder.clearLoginInfo();
    }

    // 覆盖成员、创建者、非成员、软删除和两类默认项目，防止默认类型意外放开私人云盘。
    @ParameterizedTest
    @CsvSource({"7,normal,99,0,true,true", "7,normal,88,0,false,true",
        "7,normal,99,0,false,false", "7,normal,88,1,true,false",
        "-7,default,99,0,false,true", "7,default,99,0,false,false"})
    void readsOnlyVisibleProjectCloud(long id, String type, long owner, String deleted,
                                      boolean member, boolean allowed) {
        bindProject(id, type, owner, deleted, member);
        assertThat(auth.hasResourceAccessPermission(cloud)).isEqualTo(allowed);
    }

    @Test
    void rejectsUnboundAndAnonymousResources() {
        when(projects.findByCloudResourceId(9001L)).thenReturn(List.of());
        assertThat(auth.hasResourceAccessPermission(cloud)).isFalse();
        bindProject(-7L, "default", 99L, "0", false);
        CurrentUserHolder.clearLoginInfo();
        assertThat(auth.hasResourceAccessPermission(cloud)).isFalse();
    }

    @Test
    void qaStorageReadUsesSameProjectPermissionAndRevocation() throws Exception {
        bindProject(7L, "normal", 99L, "0", true);
        SsResourceService resources = mock(SsResourceService.class);
        KnowledgeResourceFS storage = mock(KnowledgeResourceFS.class);
        FsOperationApplicationService fs = new FsOperationApplicationService();
        ReflectionTestUtils.setField(fs, "authApplicationService", auth);
        ReflectionTestUtils.setField(fs, "ssResourceService", resources);
        ReflectionTestUtils.setField(fs, "knowledgeResourceFS", storage);
        when(resources.findById(9001L)).thenReturn(cloud);
        String path = "/resource/kg_doc/KG_DOC_9001/.bykc/KB/raw/origin/file.md";
        when(storage.read(path)).thenReturn(new ByteArrayInputStream(new byte[] { 42 }));
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        fs.downloadFile("RESOURCE", 9001L, path).getBody().writeTo(output);
        assertThat(output.toByteArray()).containsExactly((byte) 42);
        when(members.isMember(7L, 88L)).thenReturn(false);
        assertThatThrownBy(() -> fs.downloadFile("RESOURCE", 9001L, path))
            .isInstanceOf(BaseException.class);
    }

    @ParameterizedTest
    @CsvSource({"88,0,true", "99,0,false", "88,1,false"})
    void onlyProjectCreatorCanManageAllItems(long owner, String deleted, boolean allowed) {
        bindProject(7L, "normal", owner, deleted, true);
        assertThat(auth.canManageAllProjectCloudItems(cloud)).isEqualTo(allowed);
    }

    @Test
    void adminVipCanManageAllCloudItems() {
        LoginInfo login = new LoginInfo();
        login.setUserId(88L);
        login.setUserCode("adminvip");
        CurrentUserHolder.setLoginInfo(login);
        assertThat(auth.canManageAllProjectCloudItems(cloud)).isTrue();
    }

    private void bindProject(long id, String type, long owner, String deleted, boolean member) {
        Project project = new Project();
        project.setProjectId(id);
        project.setProjectType(type);
        project.setCreateBy(owner);
        project.setDeleteFlag(deleted);
        project.setCloudResourceId(9001L);
        when(projects.findByCloudResourceId(9001L)).thenReturn(List.of(project));
        when(members.isMember(id, 88L)).thenReturn(member);
    }
}
