package com.iwhalecloud.byai.manager.application.service.superassist;

import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.manager.domain.superassist.service.SuasSuperassistService;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import java.util.List;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * @author he.duming
 * @date 2025-06-05 15:23:36
 * @description TODO
 */
@Service
public class SuasSuperassistApplicationService {

    private final Logger logger = LoggerFactory.getLogger(SuasSuperassistApplicationService.class);

    @Autowired
    private SuasSuperassistService suasSuperassistService;

    @Autowired
    private SsResourceService ssResourceService;

    @Autowired
    private SsResourceMapper ssResourceMapper;

    @Autowired
    private DatasetApplicationService datasetApplicationService;

    @Autowired
    private DigitalEmployeeApplicationService digitalEmployeeApplicationService;

    /**
     * 知识库系统来源；WHALE_AGENT 表示个人默认知识库由外部智能体体系承接。
     */
    @Value("${dataset.system:}")
    private String datasetSystem;


    /**
     * 初始化用户超级助手和知识库
     *
     * @param loginInfo 用户登陆信息
     * @return SuasSuperassist
     */
    public SuasSuperassist createDatasetIfNotExists(LoginInfo loginInfo) {

        try {

            SuasSuperassist suasSuperassist = this.createDefaultResourcesIfNotExists(loginInfo, false);
            loginInfo.setSessionDatasetId(suasSuperassist.getSessionDatasetId());
            loginInfo.setDefaultDigEmployeeId(suasSuperassist.getDefaultDigEmployeeId());
            return suasSuperassist;

        }
        catch (Exception e) {
            logger.error("初始化超级助手知识库失败:" + e.getMessage(), e);
            return new SuasSuperassist();
        }

    }

    /**
     * 初始化用户超级助手、默认个人知识库和默认超级助手数字员工。
     */
    public SuasSuperassist createDefaultResourcesIfNotExists(LoginInfo targetLoginInfo, boolean throwExceptions) {
        try {
            CurrentUserHolder.setLoginInfo(targetLoginInfo);
            return doCreateDefaultResourcesIfNotExists(targetLoginInfo.getUserId(), targetLoginInfo.getUserCode(),
                targetLoginInfo.getUserName(), targetLoginInfo.getAssistantId(), throwExceptions);
        }
        catch (Exception e) {
            if (throwExceptions) {
                throw e;
            }
            logger.error("初始化默认个人知识库/默认超级助手失败，userId={}, error={}", targetLoginInfo.getUserId(),
                e.getMessage(), e);
            return this.findOrCreateEmptySuperassist(targetLoginInfo.getUserId(), targetLoginInfo.getUserName(),
                targetLoginInfo.getAssistantId());
        }
    }

    private SuasSuperassist doCreateDefaultResourcesIfNotExists(Long userId, String userCode, String userName,
        Long assistantId, boolean throwExceptions) {
        Long effectiveAssistantId = assistantId != null ? assistantId : userId;
        SuasSuperassist suasSuperassist = suasSuperassistService.findById(effectiveAssistantId);
        if (suasSuperassist == null) {
            suasSuperassist = this.createSuasSuperassist(effectiveAssistantId, userName, null);
        }

        SsResource dataset = this.ensureDefaultDataset(suasSuperassist, userId, userCode, userName, throwExceptions);
        this.ensureDefaultSuperAssistant(suasSuperassist, userId, userCode, userName, dataset, throwExceptions);
        return suasSuperassist;
    }

    private SuasSuperassist createSuasSuperassist(Long superassistId, String userName, Long datasetId) {
        SuasSuperassist suasSuperassist = new SuasSuperassist();
        suasSuperassist.setSuperassistId(superassistId);
        suasSuperassist.setName(userName);
        suasSuperassist.setIntro("超级助手");
        suasSuperassist.setStatus("00");
        suasSuperassist.setSessionDatasetId(datasetId);
        suasSuperassistService.addSuasSuperassist(suasSuperassist);
        return suasSuperassist;
    }

    public Long resolveCurrentUserDefaultDigitalEmployeeId() {
        Long defaultDigEmployeeId = CurrentUserHolder.getDefaultDigEmployeeId();
        if (defaultDigEmployeeId != null) {
            return defaultDigEmployeeId;
        }
        Long assistantId = CurrentUserHolder.getAssistantId();
        if (assistantId == null || assistantId <= 0) {
            assistantId = CurrentUserHolder.getCurrentUserId();
        }
        if (assistantId == null) {
            return null;
        }
        SuasSuperassist suasSuperassist = suasSuperassistService.findById(assistantId);
        return suasSuperassist == null ? null : suasSuperassist.getDefaultDigEmployeeId();
    }

    private SsResource ensureDefaultDataset(SuasSuperassist suasSuperassist, Long userId, String userCode,
        String userName, boolean throwExceptions) {
        if (StringUtils.equalsIgnoreCase(datasetSystem, "WHALE_AGENT")) {
            logger.info("dataset.system=WHALE_AGENT，跳过默认个人知识库初始化，userId={}", userId);
            return null;
        }
        Long datasetId = suasSuperassist.getSessionDatasetId();
        SsResource dataset = datasetId == null ? null : ssResourceService.findById(datasetId);
        if (isValidDefaultDataset(dataset)) {
            return dataset;
        }

        // 兜底：和默认助理同理，按 createBy=userId 反查是否已有 owner_type=personal_default 的 KG_DOC，
        // 命中则直接复用，避免重复创建。
        SsResource existing = findExistingDefaultDataset(userId);
        if (isValidDefaultDataset(existing)) {
            suasSuperassist.setSessionDatasetId(existing.getResourceId());
            suasSuperassistService.updateById(suasSuperassist);
            return existing;
        }

        try {
            dataset = datasetApplicationService.createDefaultPersonalDataset(userId, userCode, userName);
            suasSuperassist.setSessionDatasetId(dataset.getResourceId());
            suasSuperassistService.updateById(suasSuperassist);
            return dataset;
        }
        catch (Exception e) {
            if (throwExceptions) {
                throw e;
            }
            logger.error("初始化默认个人知识库失败，userId={}, error={}", userId, e.getMessage(), e);
            return null;
        }
    }

    /**
     * 按 createBy=userId 反查该用户已存在的 owner_type=personal_default 知识库。
     *
     * @author qin.guoquan
     * @date 2026-05-08
     */
    private SsResource findExistingDefaultDataset(Long userId) {
        if (userId == null) {
            return null;
        }
        LambdaQueryWrapper<SsResource> qw = new LambdaQueryWrapper<>();
        qw.eq(SsResource::getResourceBizType, ResourceBizTypeEnum.KG_DOC.name())
            .eq(SsResource::getOwnerType, OwnerType.PERSONAL_DEFAULT)
            .eq(SsResource::getCreateBy, userId)
            .orderByAsc(SsResource::getResourceId)
            .last("limit 1");
        List<SsResource> list = ssResourceMapper.selectList(qw);
        return list == null || list.isEmpty() ? null : list.get(0);
    }

    private SsResource ensureDefaultSuperAssistant(SuasSuperassist suasSuperassist, Long userId,
        String userCode, String userName, SsResource dataset, boolean throwExceptions) {
        Long defaultDigEmployeeId = suasSuperassist.getDefaultDigEmployeeId();
        SsResource defaultAssistant = defaultDigEmployeeId == null ? null
            : ssResourceService.findById(defaultDigEmployeeId);
        if (isValidDefaultSuperAssistant(defaultAssistant, userCode, userId)) {
            return defaultAssistant;
        }
        boolean hasUserSelectedDefaultAssistant = isValidUserSelectedDefaultAssistant(defaultAssistant, userId);

        // 默认超级助手以 resource_code={userCode}_main 作为唯一锚点。
        // 如果用户已在左侧列表中选择其它数字员工做默认助理，这里只确保 _main 资源存在，不覆盖用户当前选择。
        SsResource existing = findExistingDefaultSuperAssistant(userCode, userId);
        if (hasUserSelectedDefaultAssistant && isValidDefaultSuperAssistant(existing, userCode, userId)) {
            return defaultAssistant;
        }
        if (isValidDefaultSuperAssistant(existing, userCode, userId)) {
            suasSuperassist.setDefaultDigEmployeeId(existing.getResourceId());
            suasSuperassistService.updateById(suasSuperassist);
            return existing;
        }

        try {
            SsResource createdSuperAssistant = digitalEmployeeApplicationService.saveDefaultSuperAssistant(userId, userCode, userName,
                dataset);
            if (hasUserSelectedDefaultAssistant) {
                return defaultAssistant;
            }
            suasSuperassist.setDefaultDigEmployeeId(createdSuperAssistant.getResourceId());
            suasSuperassistService.updateById(suasSuperassist);
            return createdSuperAssistant;
        }
        catch (Exception e) {
            if (throwExceptions) {
                throw e;
            }
            logger.error("初始化默认超级助手失败，userId={}, error={}", userId, e.getMessage(), e);
            return hasUserSelectedDefaultAssistant ? defaultAssistant : null;
        }
    }

    /**
     * 按 resource_code={userCode}_main 反查该用户已存在的超级助手。
     * 超级助手不再依赖 owner_type=personal_default，resource_code 后缀是唯一识别口径。
     *
     * @author qin.guoquan
     * @date 2026-05-09 150800
     */
    private SsResource findExistingDefaultSuperAssistant(String userCode, Long userId) {
        String resourceCode = DigitalEmployeeApplicationService.buildDefaultSuperAssistantResourceCode(userCode, userId);
        if (StringUtils.isBlank(resourceCode)) {
            return null;
        }
        LambdaQueryWrapper<SsResource> qw = new LambdaQueryWrapper<>();
        qw.eq(SsResource::getResourceBizType, ResourceBizTypeEnum.DIG_EMPLOYEE.name())
            .eq(SsResource::getResourceCode, resourceCode)
            .orderByAsc(SsResource::getResourceId)
            .last("limit 1");
        List<SsResource> list = ssResourceMapper.selectList(qw);
        return list == null || list.isEmpty() ? null : list.get(0);
    }

    private boolean isValidDefaultDataset(SsResource dataset) {
        return dataset != null && StringUtils.equals(dataset.getResourceBizType(), ResourceBizTypeEnum.KG_DOC.name())
            && StringUtils.equals(dataset.getOwnerType(), OwnerType.PERSONAL_DEFAULT);
    }

    private boolean isValidDefaultSuperAssistant(SsResource defaultAssistant, String userCode, Long userId) {
        String resourceCode = DigitalEmployeeApplicationService.buildDefaultSuperAssistantResourceCode(userCode, userId);
        return defaultAssistant != null
            && StringUtils.equals(defaultAssistant.getResourceBizType(), ResourceBizTypeEnum.DIG_EMPLOYEE.name())
            && StringUtils.equals(defaultAssistant.getResourceCode(), resourceCode);
    }

    /**
     * 用户手动设置的默认助理可能是左侧列表里的任意数字员工。
     * 登录初始化不能因为它不是 _main 超级助手，就把 default_dig_employee_id 覆盖回超级助手。
     */
    private boolean isValidUserSelectedDefaultAssistant(SsResource defaultAssistant, Long userId) {
        return defaultAssistant != null
            && StringUtils.equals(defaultAssistant.getResourceBizType(), ResourceBizTypeEnum.DIG_EMPLOYEE.name());
    }

    private SuasSuperassist findOrCreateEmptySuperassist(Long userId, String userName, Long assistantId) {
        Long effectiveAssistantId = assistantId != null ? assistantId : userId;
        SuasSuperassist suasSuperassist = suasSuperassistService.findById(effectiveAssistantId);
        if (suasSuperassist != null) {
            return suasSuperassist;
        }
        return this.createSuasSuperassist(effectiveAssistantId, userName, null);
    }

}
