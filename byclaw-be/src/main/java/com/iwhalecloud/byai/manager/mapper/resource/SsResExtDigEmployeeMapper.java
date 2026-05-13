package com.iwhalecloud.byai.manager.mapper.resource;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtDigEmployeeDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.qo.resource.DigEmployeeExtQo;
import com.iwhalecloud.byai.manager.qo.resource.DigitalEmployeeQo;
import com.iwhalecloud.byai.manager.vo.resource.DigitalEmployeePageVo;
import com.iwhalecloud.byai.manager.vo.resource.DigitalEmployeeVo;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDetailsDTO;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import java.util.Collection;
import java.util.List;

/**
 * 数字员工扩展信息表Mapper接口
 */
@Mapper
public interface SsResExtDigEmployeeMapper extends BaseMapper<SsResExtDigEmployee> {

    /**
     * 分页查询数字员工
     *
     * @param digitalEmployeeQo 查询
     * @return List<DigitalEmployeeVo>
     */
    List<DigitalEmployeePageVo> selectDigitalEmployeeByQo(DigitalEmployeeQo digitalEmployeeQo);

    /**
     * 查询个人归属数字员工列表。
     *
     * 口径：
     * 1. 仅查询 owner_type = personal 的数字员工；
     * 2. 覆盖“我创建的 / 我管理的 / 我使用的”三类资源；
     * 3. 返回结构与通用数字员工列表一致。
     *
     * @param digitalEmployeeQo 查询对象
     * @return List<DigitalEmployeeVo>
     */
    List<DigitalEmployeeVo> selectPersonalDigitalEmployeeByQo(DigitalEmployeeQo digitalEmployeeQo);

    /**
     * 查询数字员工详情
     *
     * @param resourceId 资源管理
     * @return DigitalEmployeeDTO
     */
    DigitalEmployeeDetailsDTO findDetailsById(@Param("resourceId") Long resourceId);

    /**
     * 根据资源标识查询数字员工信息
     *
     * @param resourceIds 资源标识集合
     * @return 数字员工资源扩展信息列表
     */
    List<ResourceExtDigEmployeeDto> findExtDigEmployeeByIds(@Param("resourceIds") Collection<Long> resourceIds);

    /**
     * 查询所有已上架的数字员工及其扩展信息
     *
     * @param machineChannel 机器渠道，可空
     * @return 数字员工资源扩展信息列表
     */
    List<ResourceExtDigEmployeeDto> findOnlineResourceExtDigEmployees(@Param("machineChannel") String machineChannel);

    /**
     * 根据条件查询数字员工包含数字员工扩展信息
     *
     * @param digEmployeeExtQo
     * @return ResourceExtDigEmployeeDto
     */
    ResourceExtDigEmployeeDto findExtDigEmployeeByQo(DigEmployeeExtQo digEmployeeExtQo);

    /**
     * 开放接口：根据数字员工类型和名称模糊查询已上架的数字员工列表
     *
     * @param agentType    数字员工类型（001-助手、005-问答、006-问数），可空
     * @param resourceName 数字员工名称（模糊查询），可空
     * @return 数字员工详情列表
     */
    List<DigitalEmployeeDetailsDTO> findDigEmployeeListForOpenApi(
            @Param("agentType") String agentType,
            @Param("resourceName") String resourceName);
}
