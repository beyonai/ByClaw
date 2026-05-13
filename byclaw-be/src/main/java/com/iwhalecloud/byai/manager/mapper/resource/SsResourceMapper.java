package com.iwhalecloud.byai.manager.mapper.resource;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigEmployeeInfo;
import com.iwhalecloud.byai.manager.dto.digitemploy.SsResourceDTO;
import com.iwhalecloud.byai.manager.dto.ontology.ObjectDto;
import com.iwhalecloud.byai.manager.dto.resource.DigEmployeeDto;
import com.iwhalecloud.byai.manager.dto.resource.ResourceCountDto;
import com.iwhalecloud.byai.manager.dto.resource.ResourceDetailDto;
import com.iwhalecloud.byai.manager.dto.resource.ResourcePageDto;
import com.iwhalecloud.byai.manager.dto.resource.ResourceQueryRequest;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.source.SourceSystem;
import com.iwhalecloud.byai.manager.entity.source.SystemQo;
import com.iwhalecloud.byai.manager.qo.resource.DirAndFileQo;
import com.iwhalecloud.byai.manager.qo.resource.PrivListQo;
import com.iwhalecloud.byai.manager.vo.operations.DigEmployeeOperationsVO;
import com.iwhalecloud.byai.manager.vo.operations.RelResourceVO;
import com.iwhalecloud.byai.manager.vo.auth.ResourceAuthVo;
import com.iwhalecloud.byai.manager.vo.resource.DirAndFileVo;
import com.iwhalecloud.byai.manager.vo.resource.ShelfResourceVo;
import java.util.List;
import java.util.Map;
import java.util.Set;
import com.iwhalecloud.byai.state.domain.resource.qo.DatasetQo;
import com.iwhalecloud.byai.state.domain.resource.vo.DatasetDetailVo;
import com.iwhalecloud.byai.state.domain.resource.vo.DatasetVo;
import com.iwhalecloud.byai.manager.domain.resource.request.DigEmployeeRelResourceQo;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * 资源表Mapper接口
 */
@Mapper
public interface SsResourceMapper extends BaseMapper<SsResource> {

    List<ResourcePageDto> getResourceListByPage(Page<ResourcePageDto> page, @Param("query") ResourceQueryRequest query);

    List<SsResource> selectRelResourceList(@Param("resourceIdList") List<Long> resourceIdList);

    List<SsResourceDTO> selectRelResourceListByType(@Param("resourceIdList") List<Long> resourceIdList,
        @Param("type") String type);

    List<SsResourceDTO> selectRelResourceListByTypeIgnoreStatus(@Param("resourceIdList") List<Long> resourceIdList,
        @Param("type") String type);

    List<ShelfResourceVo> selectRelResourceListWithSourceType(@Param("resourceIdList") List<Long> resourceIdList,
        @Param("statusList") List<Integer> statusList);

    List<Map<Integer, Long>> getStatusNumStatics(@Param("query") ResourceQueryRequest query);

    /**
     * 查询资源关联详情
     *
     * @param resourceId 资源标识
     * @return List<ResourceDetailDto>
     */
    List<ResourceDetailDto> findRelResourceDetail(@Param("resourceId") Long resourceId);

    List<ResourcePageDto> getAllResourceListByPage(@Param("request") ResourceQueryRequest request);

    /**
     * 查询资源关联的其他资源列�?
     *
     * @param resourceId 资源标识
     * @return List<SsResource>
     */
    List<SsResourceDTO> findRelResource(@Param("resourceId") Long resourceId);

    List<DigEmployeeDto> selectAllPrivList(PrivListQo request);

    List<SourceSystem> getSourceSystemListByTypes(@Param("query") SystemQo query);

    DigEmployeeInfo queryBasicInfoById(@Param("resourceId") Long resourceId);

    List<ObjectDto> queryRelObjects(@Param("resourceIds") Set<Long> resourceIds);

    /**
     * 批量插入资源
     *
     * @param resourceList 资源列表
     * @return 插入数量
     */
    int insertBatch(@Param("list") List<SsResource> resourceList);

    /**
     * 查询数字员工基本信息（包含组织、用户、目录、岗位信息）
     *
     * @param resourceId 数字员工资源ID
     * @return 数字员工基本信息
     */
    DigEmployeeOperationsVO queryDigEmployeeBasicInfo(@Param("resourceId") Long resourceId);

    /**
     * 查询数字员工关联的资源列表（技能和知识库）
     *
     * @param resourceId 数字员工资源ID
     * @return 关联资源列表
     */
    List<RelResourceVO> queryDigEmployeeRelResources(@Param("resourceId") Long resourceId);

    /**
     * 分页查询数字员工关联的可展示资源列表。
     *
     * 仅返回前端当前需要展示的资源类型：
     * KG_DOC、KG_QA、OBJECT、VIEW、TOOLKIT、MCP、AGENT。
     */
    List<ResourceAuthVo> queryDigEmployeeRelResourceAuthList(DigEmployeeRelResourceQo qo);

    /**
     * 根据资源ID删除 resource_rule_enabled 表的数据 注意：resource_rule_enabled 表在 ConversationServer 模块中，如果表在同一个数据库中，可以通过此方法删除
     *
     * @param resourceId 资源ID
     * @return 删除的记录数
     */
    int deleteResourceRuleEnabledByResourceId(@Param("resourceId") Long resourceId);

    /**
     * 统计数字员工的知识和技能数量
     *
     * @param employeeIds 数字员工ID列表
     * @return 统计结果列表，每个元素包含employeeId, resourceBizType, count
     */
    List<ResourceCountDto> countEmployeeResourceStats(@Param("employeeIds") List<Long> employeeIds);

    SsResource selectByResourceCodeAndStatus(@Param("resourceCode") String resourceCode,
        @Param("resourceStatus") Integer resourceStatus);

    /*
     * 根据code 查询所有上架的资源
     */
    List<SsResource> selectListByResourceCodes(@Param("list") List<String> list);

    /**
     * 根据resource_biz_type、resource_name模糊查询和可选的resource_id列表查询resource_id
     *
     * @param resourceBizType resource_biz_type
     * @param resourceName resource_name
     * @param resourceIds resource_id列表，可为空
     * @return resource_id列表
     */
    List<String> findResourceIdsByBizTypeAndNameWithOptionalList(@Param("resourceBizType") String resourceBizType,
        @Param("resourceName") String resourceName, @Param("resourceIds") List<String> resourceIds);

    /**
     * 查询受限资源（publishPortal为指定值的资源）
     *
     * @param resourceIds resource_id列表
     * @param publishPortal publish_portal值
     * @return 受限资源列表
     */
    List<Map<String, Object>> findRestrictedResources(@Param("resourceIds") List<String> resourceIds,
        @Param("publishPortal") Integer publishPortal);

    SsResource selectByResourceId(@Param("resourceId") Long resourceId);

    List<DatasetVo> selectDatasetByQo(DatasetQo datasetQo);

    List<DirAndFileVo> queryDirAndFileByLevel(DirAndFileQo dirAndFileQo);

    DatasetDetailVo findDatasetDetailById(@Param("resourceId") Long resourceId);
}
