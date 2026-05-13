package com.iwhalecloud.byai.manager.domain.datacloud.service;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import cn.hutool.core.util.IdUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudScript;
import com.iwhalecloud.byai.manager.entity.datacloud.DatacloudScriptScenario;
import com.iwhalecloud.byai.manager.mapper.datacloud.DatacloudScriptMapper;
import com.iwhalecloud.byai.manager.mapper.datacloud.DatacloudScriptScenarioMapper;
import com.iwhalecloud.byai.manager.vo.datacloud.DatacloudScriptScenarioVo;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptBatchDeleteQO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptScenarioBatchDeleteQO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptScenarioDTO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptScenarioQueryDTO;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import org.apache.commons.collections.CollectionUtils;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.Date;
import java.util.List;

/**
 * 脚本场景管理服务
 * 
 * @author system
 * @date 2025-01-15
 */
@Service
public class DatacloudScriptScenarioService {

    private static final Logger logger = LoggerFactory.getLogger(DatacloudScriptScenarioService.class);


    @Autowired
    private DatacloudScriptScenarioMapper datacloudScriptScenarioMapper;

    @Autowired
    private DatacloudScriptMapper datacloudScriptMapper;

    @Autowired
    private DatacloudScriptService datacloudScriptService;

    /**
     * 分页查询脚本场景列表
     * 
     * @param query 查询条件
     * @return 分页结果
     */
    public ResponseUtil queryScenarioList(DatacloudScriptScenarioQueryDTO query) {
        try {
            Page<DatacloudScriptScenarioDTO> page = new Page<>(query.getPageNum(), query.getPageSize());
            List<DatacloudScriptScenarioDTO> list = datacloudScriptScenarioMapper.selectScenarioListByPage(page, query);
            page.setRecords(list);

            return ResponseUtil.success(PageHelperUtil.toPageInfo(page));
        }
        catch (Exception e) {
            logger.error("查询脚本场景列表失败", e);
            return ResponseUtil.fail("查询脚本场景列表失败：" + e.getMessage());
        }
    }

    /**
     * 查询脚本场景树形结构
     * 
     * @param enterpriseId 企业ID
     * @return 场景树形列表
     */
    public ResponseUtil queryScenarioTree(Long enterpriseId) {
        try {
            List<DatacloudScriptScenarioDTO> treeList = datacloudScriptScenarioMapper.selectScenarioTree(enterpriseId);
            return ResponseUtil.success(treeList);
        }
        catch (Exception e) {
            logger.error("查询脚本场景树形结构失败", e);
            return ResponseUtil.fail("查询脚本场景树形结构失败：" + e.getMessage());
        }
    }

    /**
     * 根据ID查询脚本场景详情
     * 
     * @param scenarioId 场景ID
     * @return 场景详情
     */
    public ResponseUtil queryScenarioById(Long scenarioId) {
        try {
            DatacloudScriptScenario scenario = datacloudScriptScenarioMapper.selectById(scenarioId);
            if (scenario == null) {
                return ResponseUtil.fail("脚本场景不存在");
            }

            DatacloudScriptScenarioDTO dto = new DatacloudScriptScenarioDTO();
            BeanUtils.copyProperties(scenario, dto);

            // 统计子场景和脚本数量
            int childCount = datacloudScriptScenarioMapper.countChildScenarios(scenarioId);
            int scriptCount = datacloudScriptScenarioMapper.countScriptsByScenario(scenarioId);
            dto.setChildCount(childCount);
            dto.setScriptCount(scriptCount);

            return ResponseUtil.success(dto);
        }
        catch (Exception e) {
            logger.error("查询脚本场景详情失败", e);
            return ResponseUtil.fail("查询脚本场景详情失败：" + e.getMessage());
        }
    }

    /**
     * 新增脚本场景
     * 
     * @param dto 场景信息
     * @return 操作结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil addScenario(DatacloudScriptScenarioDTO dto) {
        try {
            Long currentUserId = CurrentUserHolder.getCurrentUserId();
            Long enterpriseId = CurrentUserHolder.getEnterpriseId();
            dto.setCreatorId(currentUserId);
            dto.setEnterpriseId(enterpriseId);
            // 检查场景编码是否已存在
            int existsCount = datacloudScriptScenarioMapper.checkScenarioCodeExists(dto.getScenarioCode(),
                dto.getEnterpriseId(), null);
            if (existsCount > 0) {
                return ResponseUtil.fail("场景编码已存在");
            }

            DatacloudScriptScenario scenario = new DatacloudScriptScenario();
            BeanUtils.copyProperties(dto, scenario);

            // 设置主键ID
            scenario.setScenarioId(IdUtil.getSnowflakeNextId());
            scenario.setCreateTime(new Date());

            int result = datacloudScriptScenarioMapper.insert(scenario);
            if (result > 0) {
                logger.info("新增脚本场景成功，场景ID：{}", scenario.getScenarioId());
                DatacloudScriptScenarioVo scriptScenarioVo = DatacloudScriptScenarioVo.builder()
                    .scenarioId(scenario.getScenarioId()).build();
                return ResponseUtil.success(scriptScenarioVo);
            }
            else {
                return ResponseUtil.fail("新增脚本场景失败");
            }
        }
        catch (Exception e) {
            logger.error("新增脚本场景失败", e);
            return ResponseUtil.fail("新增脚本场景失败：" + e.getMessage());
        }
    }

    /**
     * 更新脚本场景
     * 
     * @param dto 场景信息
     * @return 操作结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil updateScenario(DatacloudScriptScenarioDTO dto) {
        try {
            Long currentUserId = CurrentUserHolder.getCurrentUserId();
            Long enterpriseId = CurrentUserHolder.getEnterpriseId();
            dto.setUpdateBy(currentUserId);
            dto.setEnterpriseId(enterpriseId);
            // 检查场景是否存在
            DatacloudScriptScenario existingScenario = datacloudScriptScenarioMapper.selectById(dto.getScenarioId());
            if (existingScenario == null) {
                return ResponseUtil.fail("脚本场景不存在");
            }

            // 检查场景编码是否已存在（排除当前记录）
            int existsCount = datacloudScriptScenarioMapper.checkScenarioCodeExists(dto.getScenarioCode(),
                dto.getEnterpriseId(), dto.getScenarioId());
            if (existsCount > 0) {
                return ResponseUtil.fail("场景编码已存在");
            }

            DatacloudScriptScenario scenario = new DatacloudScriptScenario();
            BeanUtils.copyProperties(dto, scenario);
            scenario.setUpdateTime(new Date());

            int result = datacloudScriptScenarioMapper.updateById(scenario);
            if (result > 0) {
                logger.info("更新脚本场景成功，场景ID：{}", scenario.getScenarioId());
                return ResponseUtil.success("更新脚本场景成功");
            }
            else {
                return ResponseUtil.fail("更新脚本场景失败");
            }
        }
        catch (Exception e) {
            logger.error("更新脚本场景失败", e);
            return ResponseUtil.fail("更新脚本场景失败：" + e.getMessage());
        }
    }

    /**
     * 删除脚本场景
     * 
     * @param scenarioId 场景ID
     * @return 操作结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil deleteScenario(Long scenarioId) {
        try {
            // 检查场景是否存在
            DatacloudScriptScenario scenario = datacloudScriptScenarioMapper.selectById(scenarioId);
            if (scenario == null) {
                return ResponseUtil.fail("脚本场景不存在");
            }

            // 检查是否有子场景
            int childCount = datacloudScriptScenarioMapper.countChildScenarios(scenarioId);
            if (childCount > 0) {
                return ResponseUtil.fail("该场景下存在子场景，无法删除");
            }

            // 检查是否有关联的脚本
            int scriptCount = datacloudScriptScenarioMapper.countScriptsByScenario(scenarioId);
            if (scriptCount > 0) {
                return ResponseUtil.fail("该场景下存在关联脚本，无法删除");
            }

            int result = datacloudScriptScenarioMapper.deleteById(scenarioId);
            if (result > 0) {
                logger.info("删除脚本场景成功，场景ID：{}", scenarioId);
                return ResponseUtil.success("删除脚本场景成功");
            }
            else {
                return ResponseUtil.fail("删除脚本场景失败");
            }
        }
        catch (Exception e) {
            logger.error("删除脚本场景失败", e);
            return ResponseUtil.fail("删除脚本场景失败：" + e.getMessage());
        }
    }

    /**
     * 批量删除脚本场景
     * 
     * @param qo 批量删除请求对象
     * @return 操作结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil batchDeleteScenarios(DatacloudScriptScenarioBatchDeleteQO qo) {
        try {
            List<Long> scenarioIds = qo.getScenarioIds();
            Long enterpriseId = CurrentUserHolder.getEnterpriseId();
            qo.setEnterpriseId(enterpriseId);

            if (scenarioIds == null || scenarioIds.isEmpty()) {
                return ResponseUtil.fail("请选择要删除的场景");
            }

            // 使用批量删除方法
            int result = datacloudScriptScenarioMapper.batchDeleteScenarios(scenarioIds, enterpriseId);
            // 同步删除关联的脚本场景
            LambdaQueryWrapper<DatacloudScript> wrapper = new LambdaQueryWrapper<>();
            wrapper.in(DatacloudScript::getScenarioId, scenarioIds);
            List<DatacloudScript> scriptList = datacloudScriptMapper.selectList(wrapper);
            if (CollectionUtils.isNotEmpty(scriptList)) {
                datacloudScriptService.batchDeleteScripts(new DatacloudScriptBatchDeleteQO() {
                    {
                        setScriptIds(scriptList.stream().map(DatacloudScript::getScriptId).toList());
                    }
                });
            }
            if (result > 0) {
                logger.info("批量删除脚本场景成功，共删除 {} 个场景", result);
                return ResponseUtil.success("批量删除成功，共删除 " + result + " 个场景");
            }
            else {
                return ResponseUtil.success(result);
            }
        }
        catch (Exception e) {
            logger.error("批量删除脚本场景失败", e);
            return ResponseUtil.fail("批量删除脚本场景失败：" + e.getMessage());
        }
    }
}
