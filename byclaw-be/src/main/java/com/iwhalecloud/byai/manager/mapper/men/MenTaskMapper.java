package com.iwhalecloud.byai.manager.mapper.men;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.men.MenTask;
import com.iwhalecloud.byai.manager.qo.men.MenTaskQueryQo;
import com.iwhalecloud.byai.manager.vo.men.MenTaskVo;
import org.apache.ibatis.annotations.Param;
import java.util.List;
import java.util.Map;

/**
 * 待办任务表Mapper
 * 
 * @author system
 * @since 2024
 */
public interface MenTaskMapper extends BaseMapper<MenTask> {

    /**
     * 根据外部任务ID和系统编码查询任务详情
     * 
     * @param taskExtId 外部任务ID
     * @param systemNo 系统编码
     * @return 任务详情
     */
    MenTask selectByTaskExtIdAndSystemCode(@Param("taskExtId") String taskExtId, @Param("systemNo") String systemNo);

    /**
     * 根据资源ID查询任务（通过res_page字段中的资源ID）
     * 
     * @param resourceId 资源ID
     * @return 任务列表
     */
    List<MenTask> selectByResourceId(@Param("resourceId") String resourceId);

    /**
     * 根据资源ID查询任务（带状态过滤）
     * 
     * @param resourceId 资源ID
     * @param statusCodes 状态代码列表
     * @return 任务列表
     */
    List<MenTask> selectByResourceIdWithStatus(@Param("resourceId") String resourceId,
        @Param("statusCodes") List<String> statusCodes);

    /**
     * 分页条件查询待办任务列表 taskHandleType:待办列表要使用到的
     *
     * @param qo 查询参数
     * @param offset 偏移量
     * @param pageSize 每页条数
     * @return 任务列表
     */
    List<MenTaskVo> listTasksByPage(@Param("qo") MenTaskQueryQo qo, @Param("offset") int offset,
        @Param("pageSize") int pageSize);

    /**
     * 查询待办任务总数
     * 
     * @param qo 查询参数
     * @return 总数
     */
    int countTasks(@Param("qo") MenTaskQueryQo qo);

    /**
     * 空间成果根据父任务查询子任务。应为有查询接收人所以分开了sql
     */
    List<MenTaskVo> listTasksByPTask(@Param("qo") MenTaskQueryQo qo);

    /**
     * 根据任务查找
     *
     * @param resComId 组件标识
     * @return MenTask
     */
    MenTask findByResComId(@Param("resComId") Long resComId);

    // ========== 以下方法从 todolist.MenTaskMapper 迁移 ==========

    /**
     * 待办列表分页查询（含资源信息，供 todolist 使用）
     *
     * @param qo 查询参数
     * @return 任务列表
     */
    List<MenTaskVo> listTasksByPageForTodolist(@Param("qo") MenTaskQueryQo qo);

    /**
     * 根据任务ID查询任务详情（含资源信息，供 todolist 使用）
     *
     * @param qo 查询参数
     * @return 任务详情
     */
    MenTaskVo queryTaskInfoByTaskId(@Param("qo") MenTaskQueryQo qo);

    /**
     * 统计不同状态的任务数量
     *
     * @param qo 查询条件
     * @return 每条记录包含 status_cd 和 task_count
     */
    List<Map<String, Object>> countTasksByStatus(@Param("qo") MenTaskQueryQo qo);

    /**
     * 根据任务ID删除任务
     *
     * @param taskId 任务ID
     * @return 影响行数
     */
    int deleteByTaskId(@Param("taskId") Long taskId);

    /**
     * 根据资源ID查询任务
     *
     * @param resourceId 资源ID
     * @return 任务列表
     */
    List<MenTask> selectTaskByResourceId(@Param("resourceId") Long resourceId);

    /**
     * 根据任务ID删除接收对象
     *
     * @param taskId 任务ID
     * @return 影响行数
     */
    int deleteRecObjByResourceId(@Param("taskId") Long taskId);

    /**
     * 根据组件ID删除资源组件
     *
     * @param resComId 组件ID
     * @return 影响行数
     */
    int deleteResComByResourceId(@Param("resComId") Long resComId);
}