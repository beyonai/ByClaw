/* eslint-disable no-template-curly-in-string */
import { getIntl } from '@umijs/max';

export const getMarkdownTemp1 = () => {
  const intl = getIntl();
  const initiator = intl.formatMessage({ id: 'common.initiator' });
  const handler = intl.formatMessage({ id: 'common.handler' });
  return `<mark style="color:#14161AFF;font-size: 14px;background: transparent;font-weight: bolder;line-height: 22px">\${parameters.flow.PROC_DEF_NAME || ""}</mark>\n\n<mark style="color:#14161AFF;font-size: 13px;background: transparent">\${parameters.flow.PROC_INST_ID || ""} \${parameters.flow.FLOW_NAME || ""}</mark>\n\n<mark style="color:#40454d;font-size: 12px;background: transparent;">${initiator}：\${parameters.flow.CREATE_STAFF_CODE_NAME || ""}</mark></br><mark style="color:#40454d;font-size: 12px;background: transparent;">${handler}：\${parameters.flow.CHECK_USER || ""}</mark>\n\n</br><mark style="color:#A4AAB2FF;font-size: 13px;background: transparent;line-height: 28px" class="date">\${parameters.flow.TASK_START_TIME ? dayjs(parameters.flow.TASK_START_TIME).format("MM-DD hh:mm") : ""}</mark>`;
};

export const getMarkdownTemp2 = () => {
  const intl = getIntl();
  const fileDownload = intl.formatMessage({ id: 'common.fileDownload' });
  const clickToDownload = intl.formatMessage({ id: 'common.clickToDownload' });
  return `${fileDownload}：[${clickToDownload}](\${parameters.downloadUrl})\n\n</br><mark style="color:#A4AAB2FF;font-size: 13px;background: transparent;line-height: 28px" class="date">\${parameters.createTime ? dayjs(parameters.createTime).format("MM-DD hh:mm") : ""}</mark>`;
};

export const getWait4ApprovalBtn = () => {
  const intl = getIntl();

  return {
    bId: 'viewDetail',
    display: '!!root',
    isDisabled: '1',
    buttonName: intl.formatMessage({ id: 'common.wait4Approval' }),
    event: [
      {
        id: '-1',
        code: 'byaiCustom',
        name: intl.formatMessage({ id: 'common.wait4Approval' }),
        params: {
          key: '-1',
          name: 'root',
          type: 'object',
          children: [
            {
              name: 'substance',
              type: 'object',
              key: 'a851e06e-e6ed-44f4-be40-34f07c1cd72b',
            },
          ],
        },
        content: 'resourceDetail',
        response: null,
      },
    ],
  };
};

export const getDetailBtn = () => {
  const intl = getIntl();

  return {
    bId: 'viewDetail',
    display: '!!root',
    buttonName: intl.formatMessage({ id: 'common.viewDetail' }),
    event: [
      {
        id: '-1',
        code: 'byaiCustom',
        name: intl.formatMessage({ id: 'myBot.callPageFunc' }),
        params: {
          key: '-1',
          name: 'root',
          type: 'object',
          children: [
            {
              name: 'substance',
              type: 'object',
              value: '${pageParams.substance}',
              key: 'a851e06e-e6ed-44f4-be40-34f07c1cd72b',
            },
          ],
        },
        content: 'resourceDetail',
        response: null,
      },
    ],
  };
};

export const getControlBtns = () => {
  const intl = getIntl();
  return [
    {
      bId: 'approval',
      display: 'root.flow.FLOW_STATUS === "00X" && !root.authPassParam && !root.authNotPassParam',
      buttonName: intl.formatMessage({ id: 'common.smartApproval' }),
      style: 'text',
      icon: 'icon-daiban',
      event: [
        {
          id: '-1',
          code: 'sendChatMessage',
          name: intl.formatMessage({ id: 'common.sendMessage' }),
          params: {
            key: '-1',
            name: 'root',
            description: intl.formatMessage({ id: 'myBot.actionParams' }),
            type: 'object',
            children: [
              {
                key: '1',
                name: 'content',
                description: intl.formatMessage({ id: 'myBot.messageContent' }),
                tip: intl.formatMessage({ id: 'myBot.messageContentTip' }),
                type: 'string',
                value: '${pageParams.authFuncParam.chatContent}',
              },
              {
                key: '2',
                name: 'params',
                description: intl.formatMessage({ id: 'myBot.messageParams' }),
                tip: intl.formatMessage({ id: 'myBot.messageParamsTip' }),
                type: 'object',
                value: '${pageParams.authFuncParam.params}',
              },
            ],
          },
          content: '',
        },
      ],
    },
    {
      bId: 'processUrl',
      display: 'root.flow.FLOW_STATUS === "00A" && !root.authPassParam && !root.authNotPassParam',
      buttonName: intl.formatMessage({ id: 'myBot.viewProcessDetail' }),
      // style: 'ghost',
      event: [
        {
          id: '-1',
          code: 'pageFunc',
          name: intl.formatMessage({ id: 'myBot.callPageFunc' }),
          params: {
            key: '-1',
            name: 'root',
            description: intl.formatMessage({ id: 'myBot.rootNode' }),
            type: 'object',
            children: [
              {
                description: intl.formatMessage({ id: 'myBot.pageUrl' }),
                name: 'url',
                type: 'string',
                value: '${pageParams.authFuncParam.params.extParam.pageUrl}',
                key: '0eab71eb-3716-47f3-88b2-4e20cbb3ec92',
                parentKey: '-1',
                parentKeyPath: ['-1'],
                parentType: 'object',
                defaultValue: '',
                operation: null,
                children: null,
              },
              {
                description: intl.formatMessage({ id: 'myBot.pageParams' }),
                name: 'parameters',
                type: 'object',
                value: '',
                key: 'a851e06e-e6ed-44f4-be40-34f07c1cd72b',
                parentKey: '-1',
                parentKeyPath: ['-1'],
                children: null,
                parentType: 'object',
              },
            ],
            parentKeyPath: [],
          },
          content: 'openByaiAppPage',
          response: null,
        },
      ],
    },
    {
      bId: 'authPass',
      display: '!!root.authPassParam',
      buttonName: intl.formatMessage({ id: 'common.approve' }),
      // style: 'primary',
      event: [
        {
          id: '-1',
          code: 'pageFunc',
          name: intl.formatMessage({ id: 'myBot.callPageFunc' }),
          params: {
            key: '-1',
            name: 'root',
            description: intl.formatMessage({ id: 'myBot.rootNode' }),
            type: 'object',
            children: [
              {
                description: intl.formatMessage({ id: 'myBot.approveParams' }),
                name: 'authPassParam',
                type: 'object',
                value: '${pageParams.authPassParam}',
                key: 'a8aa9a06-4c1e-4474-bb37-6363e085ae51',
                parentKey: '-1',
                parentKeyPath: ['-1'],
                children: null,
                parentType: 'object',
              },
            ],
            parentKeyPath: [],
          },
          content: 'authPass',
          response: null,
        },
      ],
    },
    {
      bId: 'authNotPass',
      display: '!!root.authNotPassParam',
      buttonName: intl.formatMessage({ id: 'common.reject' }),
      // style: 'ghost',
      event: [
        {
          id: '-1',
          code: 'pageFunc',
          name: intl.formatMessage({ id: 'myBot.callPageFunc' }),
          params: {
            key: '-1',
            name: 'root',
            description: intl.formatMessage({ id: 'myBot.rootNode' }),
            type: 'object',
            children: [
              {
                description: intl.formatMessage({ id: 'myBot.rejectParams' }),
                name: 'params',
                type: 'object',
                value: '${pageParams.authNotPassParam}',
                key: '664ec2ec-d377-4488-a1a7-395825a1dbc7',
                parentKey: '-1',
                parentKeyPath: ['-1'],
                children: null,
                parentType: 'object',
              },
            ],
            parentKeyPath: [],
          },
          content: 'authNotPass',
          response: null,
        },
      ],
    },
  ];
};
