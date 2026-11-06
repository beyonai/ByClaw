package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.staticdata.service.SystemConfigService;
import com.iwhalecloud.byai.manager.dto.digitemploy.*;
import com.iwhalecloud.byai.manager.entity.resource.*;
import com.iwhalecloud.byai.manager.mapper.resource.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.test.util.ReflectionTestUtils;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class EmployeeVersionCommandsTest {
    SsResourceMapper resources = mock(SsResourceMapper.class);
    DigitalEmployeePublicationMapper locks = mock(DigitalEmployeePublicationMapper.class);
    EmployeeVersionAccess access = mock(EmployeeVersionAccess.class);
    EmployeeVersionStore store = mock(EmployeeVersionStore.class);
    DigitalEmployeeApplicationService employees = mock(DigitalEmployeeApplicationService.class);
    EmployeePublicationApplicationService publications = mock(EmployeePublicationApplicationService.class);
    EmployeeVersionSync sync = mock(EmployeeVersionSync.class);
    EmployeeVersionLock mutex = mock(EmployeeVersionLock.class);
    TransactionTemplate transaction = mock(TransactionTemplate.class);
    EmployeeVersionCommands commands = new EmployeeVersionCommands(resources, locks, access, store, employees, publications, sync, mutex, transaction);
    SsResource resource; DigitalEmployeeDTO config; SsResourceVersion version;
    @BeforeEach void setup() {
        when(transaction.execute(any())).thenAnswer(call -> ((TransactionCallback<?>) call.getArgument(0)).doInTransaction(null));
        resource = new SsResource(); resource.setResourceId(10L); resource.setComAcctId(1L); resource.setResourceBizType("DIG_EMPLOYEE");
        resource.setOwnerType("personal"); resource.setConfigRevision(2L); resource.setResourceRVerid(11L);
        config = new DigitalEmployeeDTO(); config.setAgentType("001"); config.setResourceName("测试"); config.setResourceId(10L);
        version = new SsResourceVersion(); version.setResourceVersionId(12L); version.setVersionSeq(2L); version.setSavedRevision(3L);
        version.setExtInfo(EmployeeVersionSnapshot.encode(config));
        when(resources.selectById(10L)).thenReturn(resource); when(locks.lockResource(eq(10L), any())).thenReturn(resource);
        when(store.current(10L)).thenReturn(config); when(store.requireVersion(resource, 12L)).thenReturn(version);
    }
    private EmployeeVersionRequest request() {
        var request = new EmployeeVersionRequest(); request.setResourceId(10L); request.setExpectedRevision(2L);
        request.setRequestId("request-1"); request.setEmployee(config); request.setVersionId(12L); return request;
    }
    @Test void saveOnlyNeverMutatesLiveEmployeeOrRuntimeOrSubmitsPublication() {
        var request = request(); request.setActivate(false);
        when(store.append(eq(resource), eq(config), any(), eq("EDIT_SAVED"), any(), eq("request-1"), any())).thenReturn(version);
        var result = commands.save(request);
        assertEquals("SAVED", result.status()); verify(store).checkRevision(resource, 2L);
        verify(employees, never()).updateDigitalEmployee(any()); verifyNoInteractions(sync, publications);
    }

    @ParameterizedTest
    @CsvSource(value = {
        "true|weather|''", "false|weather|''",
        "true|weather,calendar|calendar", "false|weather,calendar|calendar",
        "true|weather|calendar", "false|weather|calendar",
        "true|''|weather", "false|''|weather"
    }, delimiter = '|')
    void savedAndHistoricalVersionsReplaceCurrentSkills(boolean saveAndActivate, String currentCodes, String targetCodes) {
        config.setOwnerType("personal");
        config.setRelSkills(skills(currentCodes));
        config.setSkills(JSON.toJSONString(config.getRelSkills()));
        var target = JSON.parseObject(JSON.toJSONString(config), DigitalEmployeeDTO.class);
        target.setRelSkills(skills(targetCodes)); target.setSkills(JSON.toJSONString(target.getRelSkills()));
        version.setExtInfo(EmployeeVersionSnapshot.encode(target));
        // 执行真实保存归一化，覆盖 skills 字符串优先于 relSkills 的兼容逻辑。
        ReflectionTestUtils.setField(employees, "ssResourceService", mock(SsResourceService.class));
        ReflectionTestUtils.setField(employees, "systemConfigService", mock(SystemConfigService.class));
        ReflectionTestUtils.setField(employees, "digitalEmployeeGroupApplicationService", mock(DigitalEmployeeGroupApplicationService.class));
        doCallRealMethod().when(employees).validateVersionConfiguration(any());
        when(store.append(eq(resource), eq(target), any(), eq("EDIT_ACTIVATE"), any(), eq("request-1"), any()))
            .thenAnswer(call -> {
                version.setExtInfo(EmployeeVersionSnapshot.encode(call.getArgument(1)));
                return version;
            });
        var request = request(); request.setActivate(true);
        request.setEmployee(saveAndActivate ? target : null);

        var result = saveAndActivate ? commands.save(request) : commands.activate(request);

        assertEquals("ACTIVE", result.status());
        var applied = org.mockito.ArgumentCaptor.forClass(DigitalEmployeeDTO.class);
        verify(employees).updateDigitalEmployee(applied.capture());
        var actualSkills = JSON.parseArray(applied.getValue().getSkills());
        assertEquals(JSON.toJSON(applied.getValue().getRelSkills()), actualSkills);
        assertEquals(skills(targetCodes), actualSkills.stream()
            .map(skill -> Map.of("skillCode", ((Map<?, ?>) skill).get("skillCode"))).toList());
        assertEquals(skills(currentCodes), config.getRelSkills());
        assertEquals(JSON.toJSONString(skills(currentCodes)), config.getSkills());
        verify(sync).refresh(10L); verifyNoInteractions(publications);
    }

    private static List<Object> skills(String codes) {
        return codes.isEmpty() ? List.of() : Arrays.stream(codes.split(","))
            .map(code -> (Object) Map.of("skillCode", code)).toList();
    }

    @Test void staleSaveFailsBeforeWritingSnapshot() {
        var request = request(); request.setActivate(false);
        doThrow(new IllegalStateException("conflict")).when(store).checkRevision(resource, 2L);
        assertThrows(IllegalStateException.class, () -> commands.save(request));
        verify(store, never()).append(any(), any(), any(), any(), any(), any(), any());
        verify(employees, never()).updateDigitalEmployee(any());
    }
    @Test void officialActivationCreatesReviewDraftAndCannotDirectlyUpdateEmployee() {
        resource.setOwnerType("enterprise"); resource.setPublicationSourceId(99L);
        var publication = new DigitalEmployeePublication(); publication.setRequestId(1000L);
        var detail = new EmployeePublicationApplicationService.Detail(publication, null, null, false, true, false, true, false, null, null, false);
        when(publications.prepareVersionUpdate(10L, 12L, 2L, config)).thenReturn(detail);
        var result = commands.activate(request());
        assertEquals("REVIEW_REQUIRED", result.status()); assertEquals("1000", result.publicationId());
        verify(employees, never()).updateDigitalEmployee(any()); verifyNoInteractions(sync);
    }
    @Test void alreadyEffectiveOfficialVersionDoesNotCreateAnotherApproval() {
        resource.setOwnerType("enterprise"); resource.setPublicationSourceId(99L); resource.setResourceRVerid(12L);
        var result = commands.activate(request());
        assertEquals("ACTIVE", result.status()); verify(store).requireVersion(resource, 12L);
        verifyNoInteractions(publications, sync); verify(employees, never()).updateDigitalEmployee(any());
    }
    @Test void repeatedActivationDoesNotOverrideAConfigSavedAfterThatRequest() {
        var prior = new EmployeeVersionActivation(); prior.setToVersionId(12L);
        when(store.activationRequest(resource, "request-1")).thenReturn(prior);
        var result = commands.activate(request());
        assertEquals("SUPERSEDED", result.status()); verify(employees, never()).updateDigitalEmployee(any());
        verifyNoInteractions(sync);
    }
    @Test void idempotencyKeyCannotBeReusedForDifferentConfiguration() {
        version.setContentHash("other-content"); when(store.savedRequest(resource, "request-1")).thenReturn(version);
        assertThrows(RuntimeException.class, () -> commands.save(request()));
        verify(store, never()).append(any(), any(), any(), any(), any(), any(), any());
    }
    @Test void externallySyncedEmployeesCannotBeLocallyRolledBack() {
        resource.setThirdSyncRevision(9L);
        assertThrows(RuntimeException.class, () -> commands.activate(request()));
        verify(employees, never()).updateDigitalEmployee(any()); verifyNoInteractions(publications, sync);
    }
}
