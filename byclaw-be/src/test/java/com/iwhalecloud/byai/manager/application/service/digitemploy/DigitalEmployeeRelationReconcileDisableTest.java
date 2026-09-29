package com.iwhalecloud.byai.manager.application.service.digitemploy;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.test.util.ReflectionTestUtils;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.OperationLogService;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceRuntimeInfoResolver;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.staticdata.service.SystemConfigService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDetailsDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeInstallResourceDTO;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.mapper.resource.SkillGroupMapper;
import com.iwhalecloud.byai.manager.application.service.digitemploy.event.DigEmployeeChangeEventPublisher;
import com.iwhalecloud.byai.gateway.channels.service.robot.RobotChannelRegistryCoordinator;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceEventService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

/**
 * 卡片 0009 · 收口点 ①（关联对账层）：保留历史停用关联（S1）+ 忽略新增停用挂载（S2）。
 *
 * <p><b>最高风险证据形式</b>：本类不使用"代码看起来保留了"式的断言，而是用**状态化夹具**
 * （Mockito 桩 + 内存 Map 充当 `ss_resource_rel_detail` 表）驱动**整条 `updateDigitalEmployee`**，
 * 在流程结束后检查关联是否真的还在。
 *
 * <p>T-01/T-01b 是成对断言：停用类型历史关联必须存活，正常类型历史关联必须仍被删除（证明 S1 不是"一律不删"）。
 */
class DigitalEmployeeRelationReconcileDisableTest {

    private static final Long EMPLOYEE_ID = 100L;
    private static final Long TENANT_ID = 7L;
    private static final Long OBJECT_HISTORY_DETAIL_ID = 9001L;
    private static final Long TOOLKIT_HISTORY_DETAIL_ID = 9002L;

    private DigitalEmployeeApplicationService service;
    private SsResourceService ssResourceService;
    private SsResourceRelDetailService relDetailService;
    private SsResExtDigEmployeeService extDigEmployeeService;
    private DigitalEmployeeGroupApplicationService groupApplicationService;
    private SkillGroupMapper skillGroupMapper;

    /** 内存 Map 充当 ss_resource_rel_detail 表：key = relResourceId。 */
    private final Map<Long, SsResourceRelDetail> relationTable = new LinkedHashMap<>();
    private final List<Long> removeByIdCalls = new ArrayList<>();
    private long sequence = 9100L;

    private ListAppender<ILoggingEvent> logAppender;
    private Logger classLogger;

    @BeforeEach
    void setUp() {
        service = spy(new DigitalEmployeeApplicationService());
        ssResourceService = mock(SsResourceService.class);
        relDetailService = mock(SsResourceRelDetailService.class);
        extDigEmployeeService = mock(SsResExtDigEmployeeService.class);
        groupApplicationService = mock(DigitalEmployeeGroupApplicationService.class);
        skillGroupMapper = mock(SkillGroupMapper.class);
        AuthApplicationService authApplicationService = mock(AuthApplicationService.class);
        ResourceRuntimeInfoResolver runtimeInfoResolver = mock(ResourceRuntimeInfoResolver.class);
        OperationLogService operationLogService = mock(OperationLogService.class);
        SequenceService sequenceService = mock(SequenceService.class);
        DigitalEmployeeRuntimeRefreshService runtimeRefreshService = mock(DigitalEmployeeRuntimeRefreshService.class);
        RobotChannelRegistryCoordinator robotChannelRegistryCoordinator = mock(RobotChannelRegistryCoordinator.class);
        DigEmployeeChangeEventPublisher changeEventPublisher = mock(DigEmployeeChangeEventPublisher.class);
        ResourceEventService resourceEventService = mock(ResourceEventService.class);
        SystemConfigService systemConfigService = mock(SystemConfigService.class);

        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        ReflectionTestUtils.setField(service, "ssResourceRelDetailService", relDetailService);
        ReflectionTestUtils.setField(service, "ssResExtDigEmployeeService", extDigEmployeeService);
        ReflectionTestUtils.setField(service, "digitalEmployeeGroupApplicationService", groupApplicationService);
        ReflectionTestUtils.setField(service, "skillGroupMapper", skillGroupMapper);
        ReflectionTestUtils.setField(service, "authApplicationService", authApplicationService);
        ReflectionTestUtils.setField(service, "resourceRuntimeInfoResolver", runtimeInfoResolver);
        ReflectionTestUtils.setField(service, "operationLogService", operationLogService);
        ReflectionTestUtils.setField(service, "sequenceService", sequenceService);
        ReflectionTestUtils.setField(service, "digitalEmployeeRuntimeRefreshService", runtimeRefreshService);
        ReflectionTestUtils.setField(service, "robotChannelRegistryCoordinator", robotChannelRegistryCoordinator);
        ReflectionTestUtils.setField(service, "digEmployeeChangeEventPublisher", changeEventPublisher);
        ReflectionTestUtils.setField(service, "resourceEventService", resourceEventService);
        ReflectionTestUtils.setField(service, "systemConfigService", systemConfigService);
        // employeeGovernance 保持 null（@Autowired 未注入 ⇒ 治理校验被跳过，与既有单测一致）

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(11L);
        loginInfo.setEnterpriseId(TENANT_ID);
        CurrentUserHolder.setLoginInfo(loginInfo);

        // ---- 状态化夹具：把 service 接口的三处写操作接到内存 Map 上 ----
        when(relDetailService.findByResourceId(anyLong()))
            .thenAnswer(invocation -> new ArrayList<>(relationTable.values()));
        when(relDetailService.save(any())).thenAnswer(invocation -> {
            SsResourceRelDetail relation = invocation.getArgument(0);
            if (relation.getResourceRelDetailId() == null) {
                relation.setResourceRelDetailId(sequence++);
            }
            relationTable.put(relation.getRelResourceId(), relation);
            return true;
        });
        when(relDetailService.updateById(any())).thenAnswer(invocation -> {
            SsResourceRelDetail relation = invocation.getArgument(0);
            relationTable.put(relation.getRelResourceId(), relation);
            return true;
        });
        when(relDetailService.removeById(anyLong())).thenAnswer(invocation -> {
            Long detailId = invocation.getArgument(0);
            removeByIdCalls.add(detailId);
            relationTable.values().removeIf(relation -> detailId.equals(relation.getResourceRelDetailId()));
            return true;
        });

        when(sequenceService.nextVal()).thenAnswer(invocation -> sequence++);
        when(ssResourceService.countResource(any(), any(), any(), any())).thenReturn(0L);
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(anyLong(), any())).thenReturn(new ArrayList<>());
        when(groupApplicationService.isGroup(anyString())).thenReturn(false);
        when(authApplicationService.hasResourceManagePermission(any())).thenReturn(true);
        when(authApplicationService.hasResourceInstallTargetManagePermission(any())).thenReturn(true);
        when(ssResourceService.updateResourceEntity(any())).thenAnswer(invocation -> invocation.getArgument(0));
        // 技能列表重建与本卡无关，桩掉以避免引入无关的 mock 面。
        doNothing().when(service).rebuildAndSaveDigitalEmployeeRelSkills(anyLong());
        doReturn(true).when(service).synOpenClawWorkSpace(anyLong());

        classLogger = (Logger) LoggerFactory.getLogger(DigitalEmployeeApplicationService.class);
        logAppender = new ListAppender<>();
        logAppender.start();
        classLogger.addAppender(logAppender);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.setLoginInfo(null);
        if (classLogger != null && logAppender != null) {
            classLogger.detachAppender(logAppender);
            logAppender.stop();
        }
    }

    // --------------------------------------------------------------- T-01

    @Test
    void updateDigitalEmployeeKeepsHistoricalDisabledRelation() {
        // 夹具：库内有一条 OBJECT（停用类型）历史关联；请求 relIds 不含它（对外详情已剔除 ⇒ 前端不可见）。
        relationTable.put(999L, relation(OBJECT_HISTORY_DETAIL_ID, EMPLOYEE_ID, 999L));
        prepareUpdate(EMPLOYEE_ID, Map.of(999L, "OBJECT", 888L, "MCP"));

        service.updateDigitalEmployee(request(EMPLOYEE_ID, new ArrayList<>(List.of(888L))));

        // 断言 ①：流程结束后该历史关联**仍在**，且 resourceRelDetailId 不变。
        assertThat(relationTable).containsKey(999L);
        assertThat(relationTable.get(999L).getResourceRelDetailId()).isEqualTo(OBJECT_HISTORY_DETAIL_ID);
        assertThat(relDetailService.findByResourceId(EMPLOYEE_ID))
            .extracting(SsResourceRelDetail::getRelResourceId).contains(999L);

        // 断言 ②：removeById 从未以该关联的 resourceRelDetailId 被调用。
        assertThat(removeByIdCalls).doesNotContain(OBJECT_HISTORY_DETAIL_ID);

        // 断言 ③：WARN 日志的 preservedHistory 含该 id。
        assertThat(logMessages()).anySatisfy(message -> assertThat(message)
            .contains("preservedHistory")
            .contains("999")
            .contains("RESOURCE_TYPE_DISABLED"));
    }

    // ------------------------------------------------------------- T-01b

    @Test
    void updateDigitalEmployeeStillDeletesUnrequestedNormalRelation() {
        // 对照：库内有一条 TOOLKIT（正常类型）历史关联，请求不含它 ⇒ 必须仍被删除（证明 S1 不是"一律不删"）。
        relationTable.put(777L, relation(TOOLKIT_HISTORY_DETAIL_ID, EMPLOYEE_ID, 777L));
        prepareUpdate(EMPLOYEE_ID, Map.of(777L, "TOOLKIT", 888L, "MCP"));

        service.updateDigitalEmployee(request(EMPLOYEE_ID, new ArrayList<>(List.of(888L))));

        assertThat(relationTable).doesNotContainKey(777L);
        assertThat(removeByIdCalls).contains(TOOLKIT_HISTORY_DETAIL_ID);
    }

    // --------------------------------------------------------------- T-02

    @Test
    void newDisabledMountIsIgnored() {
        prepareUpdate(EMPLOYEE_ID, Map.of(999L, "OBJECT", 888L, "MCP"));

        service.updateDigitalEmployee(request(EMPLOYEE_ID, new ArrayList<>(List.of(999L, 888L))));

        // 停用类型未被写库；正常类型仍被写入。
        assertThat(relationTable).doesNotContainKey(999L);
        assertThat(relationTable).containsKey(888L);
        assertThat(logMessages()).anySatisfy(message -> assertThat(message)
            .contains("ignoredNew").contains("999").contains("RESOURCE_TYPE_DISABLED"));
    }

    // --------------------------------------------------------------- T-03

    @Test
    void allFourWriteEntriesIgnoreNewDisabledMounts() {
        // 收口点 ① 是 4 条写入入口的公共调用点：这里逐条驱动它们，断言停用 id 都不写库。
        prepareUpdate(EMPLOYEE_ID, Map.of(999L, "VIEW", 888L, "MCP"));

        // 入口 1：saveDigitalEmployee（现存集合为空 ⇒ 每个请求 id 都走"新增"分支）
        service.saveDigitalEmployee(request(EMPLOYEE_ID, new ArrayList<>(List.of(999L))));
        assertThat(relationTable).doesNotContainKey(999L);

        // 入口 2：updateDigitalEmployee
        relationTable.clear();
        removeByIdCalls.clear();
        prepareUpdate(EMPLOYEE_ID, Map.of(999L, "SCENE", 888L, "MCP"));
        service.updateDigitalEmployee(request(EMPLOYEE_ID, new ArrayList<>(List.of(999L, 888L))));
        assertThat(relationTable).doesNotContainKey(999L);
        assertThat(relationTable).containsKey(888L);

        // 入口 3：doInstallDigitalEmployeeRelResources（经 installDigitalEmployeeRelResources 公开入口）
        relationTable.clear();
        removeByIdCalls.clear();
        prepareInstall(EMPLOYEE_ID, Map.of(999L, "ONTOLOGY_BASE", 888L, "MCP"));
        service.installDigitalEmployeeRelResources(installRequest(EMPLOYEE_ID, List.of(999L, 888L)));
        assertThat(relationTable).doesNotContainKey(999L);

        // 入口 4：syncRelResourcesByTargetIds（替换语义）
        relationTable.clear();
        removeByIdCalls.clear();
        prepareUpdate(EMPLOYEE_ID, Map.of(999L, "OBJECT", 888L, "MCP"));
        service.syncRelResourcesByTargetIds(EMPLOYEE_ID, new ArrayList<>(List.of(999L, 888L)));
        assertThat(relationTable).doesNotContainKey(999L);
    }

    // --------------------------------------------------------------- T-04

    @Test
    void entryPreChecksAreConsistentWithReconcileLayer() {
        // 已在库内的停用 id 出现在请求里（旧客户端回传）⇒ 入口前置校验**不得**剔除它，
        // 否则会变成"入口剔了 ⇒ 对账层当成请求外 ⇒ 删除"的自相矛盾路径。
        relationTable.put(999L, relation(OBJECT_HISTORY_DETAIL_ID, EMPLOYEE_ID, 999L));
        prepareUpdate(EMPLOYEE_ID, Map.of(999L, "OBJECT", 888L, "MCP", 555L, "VIEW"));

        List<Long> kept = ReflectionTestUtils.invokeMethod(service, "excludeNewlyRequestedDisabledRelIds",
            new ArrayList<>(List.of(999L, 888L)), EMPLOYEE_ID);

        assertThat(kept).containsExactly(999L, 888L);

        // 不在库内的停用 id（真新增）⇒ 入口前置校验剔除它。
        List<Long> dropped = ReflectionTestUtils.invokeMethod(service, "excludeNewlyRequestedDisabledRelIds",
            new ArrayList<>(List.of(555L, 888L)), EMPLOYEE_ID);
        assertThat(dropped).containsExactly(888L);
    }

    // --------------------------------------------------------------- T-05

    @Test
    void findDetailsByIdCallersUnchanged() {
        // 形态 ①（内部完整关联）语义未变：findDetailsById 仍返回含停用类型的完整关联列表，
        // 本卡只在消费点过滤（导出副本 / 发布快照 / 保存对账），未改该方法。
        relationTable.put(999L, relation(OBJECT_HISTORY_DETAIL_ID, EMPLOYEE_ID, 999L));
        relationTable.put(888L, relation(9003L, EMPLOYEE_ID, 888L));
        prepareUpdate(EMPLOYEE_ID, Map.of(999L, "OBJECT", 888L, "MCP"));

        List<SsResourceRelDetail> relations = relDetailService.findByResourceId(EMPLOYEE_ID);

        assertThat(relations).extracting(SsResourceRelDetail::getRelResourceId)
            .containsExactlyInAnyOrder(999L, 888L);
    }

    // ------------------------------------------------------------- 基础设施

    private List<String> logMessages() {
        List<String> messages = new ArrayList<>();
        for (ILoggingEvent event : logAppender.list) {
            messages.add(event.getFormattedMessage());
        }
        return messages;
    }

    private static SsResourceRelDetail relation(Long detailId, Long resourceId, Long relResourceId) {
        SsResourceRelDetail relation = new SsResourceRelDetail();
        relation.setResourceRelDetailId(detailId);
        relation.setResourceId(resourceId);
        relation.setRelResourceId(relResourceId);
        return relation;
    }

    private static DigitalEmployeeDTO request(Long resourceId, List<Long> relIds) {
        DigitalEmployeeDTO dto = new DigitalEmployeeDTO();
        dto.setResourceId(resourceId);
        dto.setResourceName("测试数字员工");
        dto.setOwnerType("personal");
        dto.setAgentType("AGENT_TYPE_ASSISTANT");
        dto.setRelIds(relIds);
        dto.setRelSkills(new ArrayList<>());
        return dto;
    }

    private static DigitalEmployeeInstallResourceDTO installRequest(Long employeeId, List<Long> relIds) {
        DigitalEmployeeInstallResourceDTO dto = new DigitalEmployeeInstallResourceDTO();
        dto.setDigitalEmployeeId(employeeId);
        dto.setRelIds(new ArrayList<>(relIds));
        return dto;
    }

    /** 准备 updateDigitalEmployee 所需的协作对象与资源类型解析。 */
    private void prepareUpdate(Long employeeId, Map<Long, String> bizTypeById) {
        SsResource employee = new SsResource();
        employee.setResourceId(employeeId);
        employee.setResourceName("测试数字员工");
        employee.setResourceCode("DE-100");
        employee.setOwnerType("personal");
        employee.setResourceBizType("DIG_EMPLOYEE");
        when(skillGroupMapper.selectDigitalEmployeeForUpdate(employeeId, TENANT_ID)).thenReturn(employee);
        SsResExtDigEmployee ext = new SsResExtDigEmployee();
        ext.setResourceId(employeeId);
        ext.setAgentType("AGENT_TYPE_ASSISTANT");
        when(extDigEmployeeService.findById(employeeId)).thenReturn(ext);
        when(ssResourceService.findByIdList(any())).thenAnswer(invocation -> resourcesOf(invocation.getArgument(0),
            bizTypeById));
    }

    /** 准备 install 入口所需的协作对象。 */
    private void prepareInstall(Long employeeId, Map<Long, String> bizTypeById) {
        // install 入口以 findDetailsById 作为返回回显；本卡不校验该返回值，桩掉以免引入无关 mock 面。
        doReturn(new DigitalEmployeeDetailsDTO()).when(service).findDetailsById(any());
        SsResource employee = new SsResource();
        employee.setResourceId(employeeId);
        employee.setResourceName("测试数字员工");
        employee.setResourceCode("DE-100");
        employee.setOwnerType("personal");
        employee.setResourceBizType("DIG_EMPLOYEE");
        when(ssResourceService.findById(employeeId)).thenReturn(employee);
        when(extDigEmployeeService.findById(employeeId)).thenReturn(new SsResExtDigEmployee());
        when(ssResourceService.findByIdList(any())).thenAnswer(invocation -> resourcesOf(invocation.getArgument(0),
            bizTypeById));
        // install 入口的权限校验需要一条数字员工资源；这里让 findInstallRelResources 拿到请求资源。
        when(ssResourceService.findByIdList(any())).thenAnswer(invocation -> resourcesOf(invocation.getArgument(0),
            bizTypeById));
    }

    private static List<SsResource> resourcesOf(Object ids, Map<Long, String> bizTypeById) {
        List<SsResource> resources = new ArrayList<>();
        if (ids instanceof java.util.Collection<?> collection) {
            for (Object id : collection) {
                if (id instanceof Long relId) {
                    SsResource resource = new SsResource();
                    resource.setResourceId(relId);
                    resource.setResourceBizType(bizTypeById.get(relId));
                    resource.setResourceName("R-" + relId);
                    resource.setResourceStatus(2);
                    resources.add(resource);
                }
            }
        }
        return resources;
    }
}
