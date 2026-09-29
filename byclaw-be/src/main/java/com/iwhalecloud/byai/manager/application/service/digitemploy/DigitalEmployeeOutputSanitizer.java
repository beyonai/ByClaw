package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.iwhalecloud.byai.common.constants.resource.DisabledResourceBizTypes;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDetailsDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.SsResourceDTO;

import java.util.List;

/**
 * 数字员工详情对外输出的安全投影。
 *
 * <p>两件事：
 * <ol>
 *   <li>清空内部同步镜像 {@code targetContent}（该字段是内部运行期数据，不应直接对外输出；内部调用方仍从共用
 *       {@code findDetailsById} 拿到原始值）；</li>
 *   <li>剔除四类已下线资源业务类型的关联资源（规则见 {@link DisabledResourceBizTypes}）。</li>
 * </ol>
 *
 * <p>本类为无状态静态工具，供 {@code 0007} 的入口 10/11 使用，也可被 {@code 0009} 的保存/运行配置路径复用。
 */
public final class DigitalEmployeeOutputSanitizer {

    private DigitalEmployeeOutputSanitizer() {
    }

    /** 员工详情对外输出的安全投影；{@code null} 入参安全。 */
    public static void sanitizeForOutput(DigitalEmployeeDetailsDTO details) {
        if (details == null) {
            return;
        }
        details.setTargetContent(null);
        details.setRelResourceList(filterRelResources(details.getRelResourceList()));
    }

    /** 关联资源列表的停用类型剔除；{@code null} / 空列表安全。 */
    public static List<SsResourceDTO> filterRelResources(List<SsResourceDTO> relResourceList) {
        if (relResourceList == null || relResourceList.isEmpty()) {
            return relResourceList;
        }
        return relResourceList.stream()
            .filter(relResource -> relResource == null
                || !DisabledResourceBizTypes.isDisabled(relResource.getResourceBizType()))
            .toList();
    }
}
