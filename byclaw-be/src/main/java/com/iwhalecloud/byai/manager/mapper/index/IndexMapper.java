package com.iwhalecloud.byai.manager.mapper.index;

import com.iwhalecloud.byai.manager.vo.index.AuthDigitEmployVo;
import com.iwhalecloud.byai.manager.vo.index.AuthResourceVo;
import com.iwhalecloud.byai.manager.vo.index.DepartmentRangeVo;
import com.iwhalecloud.byai.manager.vo.index.DigitEmployMarketExtVo;
import com.iwhalecloud.byai.manager.vo.index.DigitEmployMarketVo;
import com.iwhalecloud.byai.manager.vo.index.ManPrivVo;
import com.iwhalecloud.byai.manager.vo.index.SessionMemberResourceVo;
import com.iwhalecloud.byai.manager.qo.index.AuthResourceQo;
import com.iwhalecloud.byai.manager.qo.index.DiscoverQo;
import com.iwhalecloud.byai.manager.qo.index.MyAuthEmployQo;
import com.iwhalecloud.byai.manager.qo.index.MyCreatedQo;
import com.iwhalecloud.byai.manager.qo.index.MyUsualQo;
import com.iwhalecloud.byai.manager.qo.index.RecentlyAddedQo;
import org.apache.ibatis.annotations.Param;
import java.util.Collection;
import java.util.List;

/**
 * 数字员工索引查询Mapper
 *
 * @author he.duming
 * @date 2025-11-10 19:16:07
 */
public interface IndexMapper {

    /**
     * 查询当前用户有权限的数字员工列表。
     *
     * @param myAuthEmployQo 查询条件
     * @return 授权数字员工列表
     */
    List<AuthDigitEmployVo> selectAuthDigitEmploy(MyAuthEmployQo myAuthEmployQo);

    /**
     * 查询我的常用数字员工列表。 包含红名单授权且不在黑名单中的数字员工，按用户近 90 天使用频次降序排列
     *
     * @param myUsualQo 查询条件，包含用户ID和组织ID列表
     * @return 常用数字员工列表
     */
    List<AuthDigitEmployVo> queryMyUsual(MyUsualQo myUsualQo);

    /**
     * 查询最近新增的数字员工列表。 包含红名单授权且不在黑名单中的数字员工，按最新授权时间和创建时间倒序排序。
     *
     * @param recentlyAddedQo 查询条件，包含用户ID和组织ID列表
     * @return 最近新增的数字员工列表
     */
    List<AuthDigitEmployVo> queryRecentlyAdded(RecentlyAddedQo recentlyAddedQo);

    /**
     * 查询指定用户创建且已上架的数字员工。
     *
     * @param myCreatedQo 查询条件，包含用户ID
     * @return 数字员工列表
     */
    List<DigitEmployMarketVo> queryMyCreated(MyCreatedQo myCreatedQo);

    /**
     * 查询数字员工发现页列表。
     *
     * @param discoverQo 发现页查询条件
     * @return 数字员工列表
     */
    List<DigitEmployMarketExtVo> discover(DiscoverQo discoverQo);

    /**
     * 查询顶级组织ID列表。 获取所有父组织ID为-1的组织，即系统顶级组织。
     *
     * @return 顶级组织ID列表
     */
    List<Long> findTopOrgId();

    /**
     * 查询资源管理用户
     *
     * @param resourceIds 资源标识
     * @return List<ManPrivVo>
     */
    List<ManPrivVo> findManPrivVo(@Param("resourceIds") Collection<Long> resourceIds);

    /***
     * 查询当前部门组织
     * 
     * @param userId 用户标识
     * @return List<DepartmentRangeVo>
     */
    List<DepartmentRangeVo> findMyDepartmentRange(@Param("userId") Long userId);

    /**
     * 根据会话ID列表查询关联的资源信息
     *
     * @param sessionIds 会话ID列表
     * @return 会话资源信息列表
     */
    List<SessionMemberResourceVo> selectResourcesBySessionIds(@Param("sessionIds") List<Long> sessionIds);

    /**
     * 查询授权的文档
     *
     * @param authDocQo 文档授权查询对象
     * @return List<AuthResourceVo>
     */
    List<AuthResourceVo> queryAuthDoc(AuthResourceQo authDocQo);

    /**
     * 查询授权工具资源
     * 
     * @param authDocQo 查询对象
     * @return List<AuthResourceVo>
     */
    List<AuthResourceVo> queryAuthTools(AuthResourceQo authDocQo);
}
