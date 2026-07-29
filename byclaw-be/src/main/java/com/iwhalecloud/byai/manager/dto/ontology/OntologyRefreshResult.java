package com.iwhalecloud.byai.manager.dto.ontology;

import java.util.ArrayList;
import java.util.List;
import lombok.Data;

/**
 * 企业本体库刷新结果：汇总（拉取/新增/更新/下架）+ 明细（本体编码、名称、动作）。
 *
 * @author qin.guoquan
 * @date 2026-06-29 17:38:38
 */
@Data
public class OntologyRefreshResult {

    /** 本次从本体管理门户拉取的本体库总数。 */
    private int total;

    /** 新增条数。 */
    private int added;

    /** 更新条数。 */
    private int updated;

    /** 下架条数（远程已删、本地残留，置 resource_status=3）。 */
    private int offline;

    /** 明细列表。 */
    private List<Item> details = new ArrayList<>();

    public void addDetail(String baseCode, String baseName, String action) {
        this.details.add(new Item(baseCode, baseName, action));
    }

    /** 单条明细。 */
    @Data
    public static class Item {

        /** 本体编码（baseId / resource_code）。 */
        private String baseCode;

        /** 本体名称。 */
        private String baseName;

        /** 动作：insert-新增 / update-更新 / offline-下架。 */
        private String action;

        public Item() {
        }

        public Item(String baseCode, String baseName, String action) {
            this.baseCode = baseCode;
            this.baseName = baseName;
            this.action = action;
        }
    }
}
