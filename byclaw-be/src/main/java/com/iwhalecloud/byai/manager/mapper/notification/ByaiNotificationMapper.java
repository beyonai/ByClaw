package com.iwhalecloud.byai.manager.mapper.notification;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.dto.notification.NotificationQueryDto;
import com.iwhalecloud.byai.manager.entity.notification.ByaiNotification;
import com.iwhalecloud.byai.manager.vo.notification.NotificationVO;
import org.apache.ibatis.annotations.Param;
import java.util.List;

/**
 * 通知表Mapper
 */
public interface ByaiNotificationMapper extends BaseMapper<ByaiNotification> {

    /**
     * 批量插入通知 注意：不同数据库对批量插入的语法支持不同，此处走XML实现
     */
    int batchInsert(@Param("list") List<ByaiNotification> list);

    /**
     * 分页查询通知列表
     * 
     * @param page 分页对象
     * @param queryDto 查询条件
     * @return 分页结果
     */
    Page<NotificationVO> selectNotificationPage(Page<NotificationVO> page,
        @Param("query") NotificationQueryDto queryDto);

    /**
     * 批量设置通知已读
     *
     * @param idList 通知ID列表
     * @param targetId 接收者ID
     * @return 更新的记录数
     */
    int batchSetNotificationRead(@Param("idList") List<String> idList, @Param("targetId") Long targetId);

    /**
     * 设置当前用户所有通知为已读
     *
     * @param targetId 接收者ID
     * @return 更新的记录数
     */
    int setAllNotificationRead(@Param("targetId") Long targetId);

}
