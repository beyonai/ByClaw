package com.iwhalecloud.byai.manager.domain.datacloud.service;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;
import com.iwhalecloud.byai.common.feign.request.knowledge.AgtResource;
import com.iwhalecloud.byai.common.feign.request.knowledge.AgtResourceDelete;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.domain.staticdata.service.SystemConfigService;
import com.iwhalecloud.byai.manager.dto.datacloud.DataCloudScriptViewQueryDTO;
import com.iwhalecloud.byai.manager.dto.datacloud.DataCloudViewScriptDTO;
import com.iwhalecloud.byai.manager.dto.datacloud.DatacloudScriptQueryDTO;
import com.iwhalecloud.byai.manager.entity.datacloud.DataCloudScriptView;
import com.iwhalecloud.byai.manager.mapper.datacloud.DataCloudScriptViewMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.constants.Constants;
import cn.hutool.core.util.IdUtil;

/**
 * @author cxf
 * @description: TODO
 * @date 2025/10/11 17:29
 */
@Service
public class DataCloudScriptViewService {

    private static final Logger logger = LoggerFactory.getLogger(DataCloudScriptViewService.class);


    @Autowired
    private DataCloudScriptViewMapper dataCloudScriptViewMapper;

    @Autowired
    private SystemConfigService systemConfigService;

    /**
     * 分页查询脚本列表
     *
     * @param query 查询条件
     * @return 分页结果
     */
    public ResponseUtil queryViewList(DatacloudScriptQueryDTO query) {
        try {
            Page<DataCloudScriptView> page = new Page<>(query.getPageNum(), query.getPageSize());
            LambdaQueryWrapper<DataCloudScriptView> wrapper = new LambdaQueryWrapper<>();
            wrapper.eq(DataCloudScriptView::getEnterpriseId, CurrentUserHolder.getEnterpriseId());
            wrapper.eq(DataCloudScriptView::getCreatorId, CurrentUserHolder.getCurrentUserId());
            if (query.getResourceProjectId() != null) {
                wrapper.eq(DataCloudScriptView::getResourceProjectId, query.getResourceProjectId());
            }
            if (StringUtils.isNotBlank(query.getKeyword())) {
                wrapper.and(t -> t.like(DataCloudScriptView::getViewName, query.getKeyword()).or()
                    .like(DataCloudScriptView::getViewDescription, query.getKeyword()));
            }
            // 使用分页查询方法
            Page<DataCloudScriptView> resultPage = dataCloudScriptViewMapper.selectPage(page, wrapper);
            return ResponseUtil.success(PageHelperUtil.toPageInfo(resultPage));
        }
        catch (Exception e) {
            logger.error("查询视图列表失败", e);
            return ResponseUtil.fail("查询视图列表失败：" + e.getMessage());
        }
    }

    /**
     * 分页查询视图脚本列表
     *
     * @param query 查询条件
     * @return 分页结果
     */
    public ResponseUtil queryViewScriptListByPage(DataCloudScriptViewQueryDTO query) {
        try {
            Page<DataCloudViewScriptDTO> page = new Page<>(query.getPageNum(), query.getPageSize());
            List<DataCloudViewScriptDTO> list = dataCloudScriptViewMapper.selectScriptListByPage(page, query);
            page.setRecords(list);

            return ResponseUtil.success(PageHelperUtil.toPageInfo(page));
        }
        catch (Exception e) {
            logger.error("查询视图脚本列表失败", e);
            return ResponseUtil.fail("查询视图脚本列表失败：" + e.getMessage());
        }
    }

    /**
     * 保存视图
     *
     * @param view 查询条件
     * @return 分页结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil addScriptView(DataCloudScriptView view) {
        try {
            view.setViewId(IdUtil.getSnowflakeNextId());
            view.setCreateTime(new Date());
            view.setCreatorId(CurrentUserHolder.getCurrentUserId());
            view.setEnterpriseId(CurrentUserHolder.getEnterpriseId());
            dataCloudScriptViewMapper.insert(view);
            return ResponseUtil.success(view);
        }
        catch (Exception e) {
            logger.error("保存视图失败", e);
            return ResponseUtil.fail("保存视图失败：" + e.getMessage());
        }
    }

    /**
     * 更新视图
     *
     * @param view 视图信息
     * @return 更新结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil updateScriptView(DataCloudScriptView view) {
        try {
            DataCloudScriptView dataCloudScriptView = dataCloudScriptViewMapper.selectById(view.getViewId());
            if (dataCloudScriptView == null) {
                logger.error("更新视图失败：视图不存在，viewId={}", view.getViewId());
                return ResponseUtil.fail("视图不存在");
            }

            // 权限校验：只能更新自己创建的视图
            if (!dataCloudScriptView.getCreatorId().equals(CurrentUserHolder.getCurrentUserId())) {
                logger.error("更新视图失败：无权限操作，viewId={}, 当前用户={}, 创建者={}", view.getViewId(),
                    CurrentUserHolder.getCurrentUserId(), dataCloudScriptView.getCreatorId());
                return ResponseUtil.fail("无权限操作此视图");
            }

            dataCloudScriptView.setViewName(view.getViewName());
            dataCloudScriptView.setViewDescription(view.getViewDescription());
            dataCloudScriptView.setUpdateBy(CurrentUserHolder.getCurrentUserId());
            dataCloudScriptView.setUpdateTime(new Date());
            dataCloudScriptViewMapper.updateById(dataCloudScriptView);

            return ResponseUtil.success(dataCloudScriptView);
        }
        catch (Exception e) {
            logger.error("更新视图失败", e);
            return ResponseUtil.fail("更新视图失败：" + e.getMessage());
        }
    }

    /**
     * 批量删除视图
     *
     * @param dataCloudScriptViewQueryDTO 查询条件
     * @return 删除结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil batchDeleteViewList(DataCloudScriptViewQueryDTO dataCloudScriptViewQueryDTO) {
        try {
            dataCloudScriptViewMapper.deleteBatchIds(dataCloudScriptViewQueryDTO.getViewIdList());
            return ResponseUtil.success(dataCloudScriptViewQueryDTO.getViewIdList());
        }
        catch (Exception e) {
            logger.error("批量删除视图失败", e);
            return ResponseUtil.fail("批量删除视图失败：" + e.getMessage());
        }
    }

    /**
     * 发布视图 将视图发布为MCP服务,并将返回的resourceId绑定到视图对象上
     *
     * @param dataCloudScriptViewQueryDTO 查询条件，包含viewIdList
     * @return 响应结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil publish(DataCloudScriptViewQueryDTO dataCloudScriptViewQueryDTO) {
        try {
            // 参数校验
            List<Long> viewIdList = dataCloudScriptViewQueryDTO.getViewIdList();
            if (viewIdList == null || viewIdList.isEmpty()) {
                logger.error("发布视图失败：视图ID列表不能为空");
                return ResponseUtil.fail("视图ID列表不能为空");
            }

            // 1. 根据入参的viewIdList查询相关的视图信息列表
            List<DataCloudScriptView> viewList = dataCloudScriptViewMapper.selectBatchIds(viewIdList);
            if (viewList == null || viewList.isEmpty()) {
                logger.error("发布视图失败：未找到对应的视图信息");
                return ResponseUtil.fail("未找到对应的视图信息");
            }

            // 从系统参数中获取MCP服务URL
            String mcpServerUrl = systemConfigService.getStringParamValueByCode(Constants.UI_DATA_CLOUD_MCP);
            if (StringUtils.isBlank(mcpServerUrl)) {
                logger.error("发布视图失败：未配置数据云MCP服务URL，请检查系统参数 UI_DATA_CLOUD_MCP");
                return ResponseUtil.fail("未配置数据云MCP服务URL，请联系管理员");
            }

            // 存储发布成功的视图ID列表
            List<Long> successViewIds = new ArrayList<>();
            List<String> errorMessages = new ArrayList<>();

            // 2. 遍历视图列表，为每个视图创建MCP服务
            for (DataCloudScriptView view : viewList) {
                try {
                    Long resourceProjectId = view.getResourceProjectId();
                    Long bindResourceId = view.getResourceId();
                    Integer publishStatus = view.getPublishStatus();

                    if (bindResourceId != null && resourceProjectId != null && publishStatus.equals(1)) {
                        continue;
                    }

                    // 构建AgtResource对象
                    AgtResource agtResource = new AgtResource();

                    // 设置MCP服务基本信息
                    agtResource.setMcpServerName(view.getViewName());
                    agtResource.setMcpComments(view.getViewDescription());
                    agtResource.setHostingType("001"); // 托管类型
                    agtResource.setMcpType("mcp");
                    agtResource.setMcpServerUrl(mcpServerUrl);

                    // 设置MCP内容和请求头
                    agtResource.setMcpContent(view.getViewDescription());
                    agtResource.setMcpHeader("viewId=" + view.getViewId());

                    // 设置资源基本信息
                    agtResource.setResourceType("6"); // MCP服务资源类型为6
                    agtResource.setResourceName(view.getViewName());
                    agtResource.setImpoType(1);

                    // 设置项目ID（可选，根据需要设置）
                    agtResource.setResourceProjectId(dataCloudScriptViewQueryDTO.getResourceProjectId());

                    // 3. 调用createMcpService方法创建MCP服务
                    ResponseUtil createResult = createMcpService(agtResource);

                    if (!createResult.isSuccess()) {
                        String errorMsg = "视图[" + view.getViewName() + "]发布失败：" + createResult.getMsg();
                        logger.error(errorMsg);
                        errorMessages.add(errorMsg);
                        continue;
                    }

                    // 4. 从返回结果中获取resourceId
                    Long resourceId = null;
                    Long objId = null;
                    if (createResult.getData() != null) {
                        try {
                            Map<String, Object> resultData = (Map<String, Object>) createResult.getData();
                            resourceId = MapParamUtil.getLongValue(resultData, "resourceId", null);
                            objId = MapParamUtil.getLongValue(resultData, "objId", null);
                            if (resourceId == null) {
                                logger.info("视图[{}]发布成功，但未返回resourceId", view.getViewName());
                            }
                        }
                        catch (ClassCastException e) {
                            logger.error("解析resourceId失败，返回数据格式异常：{}", createResult.getData(), e);
                        }
                    }

                    // 5. 绑定resourceId到视图对象并更新
                    view.setResourceId(resourceId);
                    view.setRelObjId(objId);
                    view.setResourceProjectId(dataCloudScriptViewQueryDTO.getResourceProjectId());
                    // 设置未已发布状态
                    view.setPublishStatus(1);
                    view.setUpdateBy(CurrentUserHolder.getCurrentUserId());
                    view.setUpdateTime(new Date());
                    dataCloudScriptViewMapper.updateById(view);

                    successViewIds.add(view.getViewId());
                    logger.info("视图[{}]发布成功，resourceId={}", view.getViewName(), resourceId);
                }
                catch (Exception e) {
                    String errorMsg = "视图[" + view.getViewName() + "]发布失败：" + e.getMessage();
                    logger.error(errorMsg, e);
                    errorMessages.add(errorMsg);
                }
            }

            return ResponseUtil.success(viewIdList);
        }
        catch (Exception e) {
            logger.error("发布视图失败", e);
            return ResponseUtil.fail("发布视图失败：" + e.getMessage());
        }
    }

    /**
     * 取消发布视图 删除对应的MCP服务，并将视图的publishStatus更新为0
     *
     * @param dataCloudScriptViewQueryDTO 查询条件，包含viewIdList
     * @return 取消发布结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil unPublish(DataCloudScriptViewQueryDTO dataCloudScriptViewQueryDTO) {
        try {
            // 参数校验
            List<Long> viewIdList = dataCloudScriptViewQueryDTO.getViewIdList();
            if (viewIdList == null || viewIdList.isEmpty()) {
                logger.error("取消发布视图失败：视图ID列表不能为空");
                return ResponseUtil.fail("视图ID列表不能为空");
            }

            // 1. 根据入参的viewIdList查询相关的视图信息列表
            List<DataCloudScriptView> viewList = dataCloudScriptViewMapper.selectBatchIds(viewIdList);
            if (viewList == null || viewList.isEmpty()) {
                logger.error("取消发布视图失败：未找到对应的视图信息");
                return ResponseUtil.fail("未找到对应的视图信息");
            }

            // 存储取消发布成功的视图ID列表
            List<Long> successViewIds = new ArrayList<>();
            List<String> errorMessages = new ArrayList<>();

            // 2. 遍历视图列表，删除MCP服务并更新状态
            for (DataCloudScriptView view : viewList) {
                try {
                    // 如果视图有关联的resourceId，则删除对应的MCP服务
                    if (view.getResourceId() != null) {
                        try {
                            // 构建删除参数
                            AgtResourceDelete agtResourceDelete = new AgtResourceDelete();
                            agtResourceDelete.setResourceId(view.getResourceId());
                            agtResourceDelete.setObjId(view.getRelObjId());
                            agtResourceDelete.setResourceProjectId(view.getResourceProjectId());
                            agtResourceDelete.setResourceProjectId(view.getResourceProjectId());

                            // 调用deleteMcpService方法删除MCP服务
                            ResponseUtil deleteResult = deleteMcpService(agtResourceDelete);

                            if (!deleteResult.isSuccess()) {
                                String errorMsg = "视图[" + view.getViewName() + "]的MCP服务删除失败：" + deleteResult.getMsg();
                                logger.error(errorMsg);
                                errorMessages.add(errorMsg);
                                // 即使删除MCP服务失败，也继续更新视图状态
                            }
                            else {
                                logger.info("视图[{}]的MCP服务删除成功，resourceId={}", view.getViewName(),
                                    view.getResourceId());
                            }
                        }
                        catch (Exception e) {
                            String errorMsg = "视图[" + view.getViewName() + "]的MCP服务删除失败：" + e.getMessage();
                            logger.error(errorMsg, e);
                            errorMessages.add(errorMsg);
                            // 即使删除MCP服务失败，也继续更新视图状态
                        }
                    }

                    // 3. 更新视图状态：将publishStatus设置为0（未发布）
                    view.setPublishStatus(0);
                    view.setUpdateBy(CurrentUserHolder.getCurrentUserId());
                    view.setUpdateTime(new Date());
                    dataCloudScriptViewMapper.updateById(view);

                    successViewIds.add(view.getViewId());
                    logger.info("视图[{}]取消发布成功", view.getViewName());
                }
                catch (Exception e) {
                    String errorMsg = "视图[" + view.getViewName() + "]取消发布失败：" + e.getMessage();
                    logger.error(errorMsg, e);
                    errorMessages.add(errorMsg);
                }
            }

            return ResponseUtil.success(successViewIds);
        }
        catch (Exception e) {
            logger.error("取消发布视图失败", e);
            return ResponseUtil.fail("取消发布视图失败：" + e.getMessage());
        }
    }

    /**
     * 创建MCP服务
     *
     * @param agtResource MCP服务资源对象
     * @return 响应结果，包含resourceId用于绑定视图
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil createMcpService(AgtResource agtResource) {
        return ResponseUtil.successResponse();
    }

    /**
     * 删除MCP服务
     *
     * @param agtResourceDelete 删除参数对象
     * @return 响应结果
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil deleteMcpService(AgtResourceDelete agtResourceDelete) {
        return ResponseUtil.successResponse();
    }

}
