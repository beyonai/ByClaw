package com.iwhalecloud.byai.manager.interfaces.controller.memory;

import com.iwhalecloud.byai.manager.domain.memory.service.MemoryLibraryService;
import com.iwhalecloud.byai.manager.entity.memory.MemoryLibrary;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 记忆库控制器
 * 
 * @author system
 * @date 2025-01-XX
 */
@Api(tags = "记忆库管理")
@RestController
@RequestMapping("/memoryLibrary")
public class MemoryLibraryController {

    @Autowired
    private MemoryLibraryService memoryLibraryService;

    /**
     * 查询记忆库ID
     * 
     * @param params 查询参数（userId, agentId, libraryType）
     * @return ResponseUtil 返回记忆库ID
     */
    @ApiOperation("查询记忆库ID")
    @PostMapping("/getMemoryLibraryId")
    public ResponseUtil<?> getMemoryLibraryId(@RequestBody Map<String, Object> params) {
        try {
            Long userId = CurrentUserHolder.getCurrentUserId();
            Long agentId = parseLongFromMap(params, "agentId");
            String libraryType = params.get("libraryType") != null ? params.get("libraryType").toString() : null;

            if (libraryType == null) {
                return ResponseUtil.fail("类型不能为空");
            }

            // 如果是超级助手，agentId就是userId
            if ("SUPER_ASSISTANT".equals(libraryType)) {
                agentId = userId;
            }

            if (agentId == null) {
                return ResponseUtil.fail("数字员工ID不能为空");
            }

            MemoryLibrary memoryLibrary = memoryLibraryService.findByUserIdAndAgentId(agentId, libraryType);
            if (memoryLibrary == null || memoryLibrary.getMemLibraryId() == null) {
                return ResponseUtil.fail("未找到记忆库");
            }

            return ResponseUtil.successResponse(memoryLibrary.getMemLibraryId());
        } catch (Exception e) {
            return ResponseUtil.fail("查询记忆库ID失败：" + e.getMessage());
        }
    }

    /**
     * 从Map中解析Long类型的值
     * 
     * @param params 参数Map
     * @param key 键名
     * @return Long值，如果解析失败或为null则返回null
     */
    private Long parseLongFromMap(Map<String, Object> params, String key) {
        Object value = params.get(key);
        if (value == null) {
            return null;
        }
        
        if (value instanceof Long) {
            return (Long) value;
        } else if (value instanceof Number) {
            return ((Number) value).longValue();
        } else if (value instanceof String) {
            try {
                return Long.parseLong((String) value);
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }
}

