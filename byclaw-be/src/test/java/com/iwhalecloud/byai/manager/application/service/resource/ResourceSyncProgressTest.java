package com.iwhalecloud.byai.manager.application.service.resource;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.auth.AuthorizationSubject;
import com.iwhalecloud.byai.manager.entity.resource.ResourceSyncJob;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.auth.AuthorizationSubjectMapper;
import com.iwhalecloud.byai.manager.mapper.resource.ResourceSyncJobMapper;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.test.util.ReflectionTestUtils;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class ResourceSyncProgressTest {
    private ResourceSyncJob job;
    private SsResource resource;
    private ResourceSyncJobMapper jobs;
    private ResourceSyncProgressService progress;
    private AuthApplicationService auth;
    @BeforeEach void setup() {
        LoginInfo user = new LoginInfo(); user.setUserId(7L); user.setEnterpriseId(1L); CurrentUserHolder.setLoginInfo(user);
        job = new ResourceSyncJob(); job.setSyncJobId(100L); job.setResourceId(10L); job.setSyncRevision(2L); job.setOperatorUserId(9L);
        job.setStatus(ResourceSyncJob.RUNNING); job.setRetryCount(1);
        job.setAuthorizationIntent("{\"autoAuthorize\":true,\"useScope\":{\"userIds\":[7],\"orgIds\":[],\"postIds\":[]}}");
        job.setResultSummary("{\"phase\":\"AUTHORIZING\",\"totalUsers\":10000,\"completedUsers\":500,\"authorizationApplied\":false,\"_completedEmployeeIds\":[123],\"pendingEmployeeIds\":[456]}");
        resource = new SsResource(); resource.setResourceId(10L); resource.setThirdSyncRevision(2L); resource.setResourceStatus(2);
        jobs = mock(ResourceSyncJobMapper.class); when(jobs.selectById(100L)).thenReturn(job); when(jobs.latest(10L)).thenReturn(job);
        when(jobs.latestBatch(List.of(10L))).thenReturn(List.of(job));
        var resources = mock(SsResourceService.class); when(resources.findById(10L)).thenReturn(resource);
        auth = mock(AuthApplicationService.class);
        progress = new ResourceSyncProgressService(); ReflectionTestUtils.setField(progress,"jobs",jobs);
        ReflectionTestUtils.setField(progress,"resources",resources); ReflectionTestUtils.setField(progress,"auth",auth);
    }
    @AfterEach void cleanup() { CurrentUserHolder.setLoginInfo(null); }

    @Test void unknownOrUnauthorizedTaskNeverLeaksScopeOrProgress() {
        assertThatThrownBy(()->progress.query(100L)).isInstanceOf(IllegalArgumentException.class);
        assertThat(progress.queryBatch(List.of(10L))).isEmpty();
        assertThatThrownBy(()->progress.query(999L)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(()->progress.retry(100L)).isInstanceOf(IllegalArgumentException.class);
    }
    @Test void normalViewerSeesStateButNotOtherRecipientsOrCounts() {
        when(auth.hasResourceViewPermission(resource)).thenReturn(true);
        String response = JSON.toJSONString(progress.query(100L));
        assertThat(response).contains("AUTHORIZING", "jobId", "queryResourceSyncJob").doesNotContain("10000","123","456","autoAuthorize","totalUsers");
    }
    @Test void managerSeesCountsAndExternalPollingContractButNeverInternalCheckpoints() {
        when(auth.hasResourceManagePermission(resource)).thenReturn(true);
        String response = JSON.toJSONString(progress.query(100L));
        assertThat(response).contains("10000","500","queryResourceSyncJob","pollAfterMs").doesNotContain("123","456","useScope","_completed");
    }
    @Test void pendingReplacementOnlyRestrictsExistingUseAndNeverReturnsEarlySuccess() {
        var guard = new ResourceSyncAuthorizationGuard(); ReflectionTestUtils.setField(guard,"jobs",jobs);
        var subjects = mock(AuthorizationSubjectMapper.class); ReflectionTestUtils.setField(guard,"subjects",subjects);
        assertThat(guard.allows(resource,7L,false)).isTrue();
        assertThat(guard.allows(resource,8L,false)).isFalse();
        assertThat(job.associationResult()).containsEntry("effective",false);
        job.setResultSummary("{\"authorizationApplied\":true}");
        assertThat(guard.allows(resource,8L,false)).isTrue(); // Finished replacement is evaluated by the normal grant check.
    }
    @Test void pendingOrgAndPostScopesMatchMembershipWithoutExpandingTheWholeOrganization() {
        var guard = new ResourceSyncAuthorizationGuard(); ReflectionTestUtils.setField(guard,"jobs",jobs);
        var subjects = mock(AuthorizationSubjectMapper.class); ReflectionTestUtils.setField(guard,"subjects",subjects);
        job.setAuthorizationIntent("{\"viewAuth\":true,\"viewScope\":{\"orgIds\":[20],\"postIds\":[30]}}");
        var org = new AuthorizationSubject(); org.setUserId(7L); org.setSubjectType("ORG"); org.setSubjectId(21L); org.setSubjectPath("1.20.21");
        var post = new AuthorizationSubject(); post.setUserId(8L); post.setSubjectType("POST"); post.setSubjectId(30L);
        when(subjects.memberships(List.of(7L))).thenReturn(List.of(org)); when(subjects.memberships(List.of(8L))).thenReturn(List.of(post));
        assertThat(guard.allows(resource,7L,true)).isTrue(); assertThat(guard.allows(resource,8L,true)).isTrue();
        job.setAuthorizationIntent("{\"viewAuth\":false}"); assertThat(guard.allows(resource,7L,true)).isFalse();
    }
}
