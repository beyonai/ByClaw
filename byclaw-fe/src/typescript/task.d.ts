import { ResourceTypeMap } from '@/constants/resource';

type IBeyondTask = {
  disabled?: boolean;
  theme?: string;
}

export type ITask = {
  comAcctId: null;
  content: string;
  createBy: number;
  createTime: string;
  dealDesc: null;
  dealObjId: null;
  dealType: null;
  fileOut: null;
  fileOutType: null;
  messageStepCode: null;
  messageId?: string;
  oriTaskId: null;
  pTaskId: null;
  priority: string;
  resComId: number;
  resPage: string;
  pageId?: string;
  loadSsoIframeUrl?: string;
  resPageObj?: {
    id: string;
    compType: string;
    children: any[];
    disabledBIds?: [string];
    controlBtns: Array<{
      buttonName: string;
      style: string;
      event: [
        {
          code: string;
          params: {
            toResCode: string; // 填写百应的agent、插件的编码
            chatContent: string; // 对话内容
            extParam: Record<string, string>;
          };
        }
      ];
    }>;
    flow?: any
  };
  resType: 2010;
  sendObjId: null;
  sendType: null;
  statusCd: string; // 已提交-Submitted 已完成-Completed
  systemNo: string;
  taskDealineTime: null;
  taskExtId: string;
  taskId: number;
  taskType: string;
  title: string;
  updateBy: null;
  updateTime: null;
} & IBeyondTask & IResource;

type IResource = {
  "content": string,
  "dealObjId": number | null,
  "dealType": string | null,
  "messageId": number | string | null | undefined,
  "pageId": string | undefined,
  "priority": string,
  "resComId": number,
  "resourceBizType"?: typeof ResourceTypeMap[keyof typeof ResourceTypeMap],
  "resourceId"?: string,
  "sendObjId": number | null,
  "sendType": string | null,
  "sessionId"?: number,
  "statusCd": string,
  "systemNo": string,
  "taskExtId": string,
  "taskId"?: number,
  "taskType": string,
  "title": string,
  "updateBy": number | null,
  "updateTime": string | null
}

// {
//   "comAcctId": null,
//   "content": "流程标题: 111[刻章申请流程]流程类型: 刻章申请流程流程号: 72042547申请人: 张莹莹0027026248申请时间: 2025-07-18 11:15:07",
//   "createBy": 1,
//   "createTime": "2025-07-18 11:16:43",
//   "dealDesc": null,
//   "dealObjId": null,
//   "dealType": null,
//   "fileOut": null,
//   "fileOutType": null,
//   "messageId": null,
//   "messageStepCode": null,
//   "oriTaskId": null,
//   "pTaskId": null,
//   "priority": "MEDIUM",
//   "resComId": 600000030545,
//   "resPage": "{\"compType\":\"page\",\"children\":[{\"compType\":\"typography\",\"comProps\":{\"articleContent\":\"**流程标题:** 111[刻章申请流程]<br>\\n**流程类型:** 刻章申请流程<br>\\n**流程号:** 72042547<br>\\n**申请人:** 张莹莹0027026248<br>\\n**申请时间:** 2025-07-18 11:15:07<br>\\n\"}}],\"id\":\"72042591\",\"controlBtns\":[{\"buttonName\":\"智能审批\",\"style\":\"primary\",\"event\":[{\"code\":\"sendChatMessage\",\"params\":{\"toResCode\":\"UIAGENT_AGENT_UIAGENT\",\"extParam\":{\"markdown_text\":\"**流程标题:** 111[刻章申请流程]<br>\\n**流程类型:** 刻章申请流程<br>\\n**流程号:** 72042547<br>\\n**申请人:** 张莹莹0027026248<br>\\n**申请时间:** 2025-07-18 11:15:07<br>\\n\",\"common\":{\"default_message\":\"查询当前流程申请详情\",\"out_track_id\":\"72042591\",\"user_code\":\"0027014766\",\"card_template_id\":\"543c9eab-ac49-47df-8b20-afe4884ceb19.schema\",\"user_id\":\"3148374268854335\",\"manual_approval_task_id\":\"\",\"task_id\":\"1329220709975162881\",\"card_type\":\"流程申请\",\"task_type\":\"init_card\",\"chat_task_id\":\"1329220709975162881\",\"status\":\"\",\"quick_approve_url\":\"https://zmptest.iwhalecloud.com/newZmp?task_id=1329220709975162881&task_type=open&PROC_INST_ID=72042547\"},\"business_param\":{\"proc_inst_id\":\"72042547\",\"params_detail\":[{\"code\":\"FLOW_NAME\",\"label\":\"流程标题\",\"value\":\"\"},{\"code\":\"PROC_DEF_NAME\",\"label\":\"流程类型\",\"value\":\"\"},{\"code\":\"PROC_INST_ID\",\"label\":\"流程号\",\"value\":\"\"},{\"code\":\"CREATE_STAFF_CODE_NAME\",\"label\":\"申请人\",\"value\":\"\"},{\"code\":\"TASK_START_TIME\",\"label\":\"申请时间\",\"value\":\"\"}]},\"systemCode\":\"UIAGENT\",\"pageUrl\":\"https://zmptest.iwhalecloud.com/newZmp?task_id=1329220709975162881&task_type=open&PROC_INST_ID=72042547\",\"taskExtId\":\"72042591\"},\"chatContent\":\"智能审批\"}}]}]}",
//   "resType": 2010,
//   "sendObjId": null,
//   "sendType": null,
//   "statusCd": "Submitted",
//   "systemNo": "UIAGENT",
//   "taskDealineTime": null,
//   "taskExtId": "72042591",
//   "taskId": 600000030546,
//   "taskType": "APPROVE",
//   "title": "流程申请",
//   "updateBy": null,
//   "updateTime": null
// }
