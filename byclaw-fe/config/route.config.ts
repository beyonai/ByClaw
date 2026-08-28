export default [
  {
    path: '/single',
    name: 'single',
    component: './login/single',
  },
  {
    path: '/datacloud/loginByCode',
    name: 'datacloud-loginByCode',
    component: './datacloud/loginByCode',
  },
  {
    path: '/',
    component: '@/layout/commonLayout',
    routes: [
      {
        path: '/manager',
        component: '@/pages/manager/layout',
        routes: [
          {
            path: '/manager',
            redirect: '/manager/operation/dashboard',
          },
          {
            path: '/manager/operation/dashboard',
            name: 'managerDashboard',
            component: './manager/pages/dashboard',
          },
          {
            path: '/manager/org/orgMgr',
            name: 'managerOrgMgr',
            component: './manager/pages/OrgMgr',
          },
          {
            path: '/manager/org/postManage',
            name: 'managerPostManage',
            component: './manager/pages/PostManage',
          },
          {
            path: '/manager/org/permissionGroup',
            name: 'managerPermissionGroup',
            component: './manager/pages/PermissionGroupMgr',
          },
          {
            path: '/manager/systemParams/system',
            name: 'managerSystemParams',
            component: './manager/pages/SystemParams',
          },
          {
            path: '/manager/systemParams/modal',
            name: 'managerModelMgr',
            component: './manager/pages/ModelMgr',
          },
          {
            path: '/manager/systemParams/sandbox',
            name: 'managerSandbox',
            component: './manager/pages/SandboxMgr',
          },
          {
            path: '/manager/system/feedback',
            name: 'managerSystemFeedback',
            component: './manager/pages/SystemFeedbackMgr',
          },
          {
            path: '/manager/asset/digitalEmployee',
            name: 'managerDigitalEmployee',
            component: './manager/pages/digitalEmployeeMgr',
          },
          {
            path: '/manager/resource/digitalEmployee',
            name: 'managerResourceDigitalEmployee',
            component: './manager/pages/digitalEmployeeMgr',
          },
          {
            path: '/manager/resource/employeeDetail',
            name: 'managerEmployeeDetail',
            component: './manager/pages/digitalEmployeeMgr/EmployeeDetail',
          },
          {
            path: '/manager/business/field',
            name: 'managerBusinessField',
            component: './manager/pages/BusinessFieldMgr',
          },
          {
            path: '/manager/notification',
            name: 'managerNotification',
            component: './manager/pages/NotificationMgr',
          },
        ],
      },
      {
        path: '/preview',
        component: './preview',
      },
      {
        path: '/mobile',
        component: '@/layout/mobileLayout',
        routes: [
          {
            path: '/mobile',
            name: 'mobile',
            component: './mobile/AuthPage',
          },
          {
            path: '/mobile/notice',
            name: 'mobileNotice',
            component: './mobile/Notice',
          },
          {
            path: '/mobile/login',
            name: 'mobileLogin',
            component: './mobile/Login',
          },
          {
            path: '/mobile/openclaw',
            name: 'mobileOpenClaw',
            component: './mobile/OpenClaw',
          },
          {
            path: '/mobile/appBridge',
            component: '@/layout/mobileLayout/AppBridge',
            routes: [
              {
                path: '/mobile/appBridge/application',
                name: 'mobileApplication',
                component: './mobile/Application',
              },
              {
                path: '/mobile/appBridge/iframe',
                name: 'mobileIframe',
                component: './mobile/Iframe',
              },
            ],
          },
        ],
      },
      {
        path: '/',
        component: '@/layout/pcLayout',
        routes: [
          {
            path: '/',
            redirect: '/chat',
          },
          {
            path: '/chat',
            name: 'chat',
            component: './chat',
          },
          {
            path: '/dialogueRecord',
            name: 'dialogueRecord',
            component: './dialogueRecord',
          },
          {
            path: '/knowledgeCenter',
            name: 'knowledgeCenter',
            component: './knowledgeCenter',
          },
          {
            path: '/inspiration',
            name: 'inspiration',
            component: './inspiration',
          },
          {
            path: '/resourceCenter',
            name: 'resourceCenter',
            component: './resourceCenter',
          },
          {
            path: '/files',
            name: 'files',
            component: './files',
          },
          {
            path: '/automation',
            name: 'automation',
            component: './automation',
          },
          {
            path: '/models',
            name: 'models',
            component: './models',
          },
          {
            path: '/objectCenter',
            name: 'objectCenter',
            component: './objectCenter',
          },
          {
            path: '/ontologyCenter',
            name: 'ontologyCenter',
            component: './ontologyCenter',
          },
          {
            path: '/ontologyBaseDetail',
            name: 'ontologyBaseDetail',
            component: './ontologyBaseDetail',
          },
          {
            path: '/skillCenter',
            name: 'skillCenter',
            component: './skillCenter',
          },
          {
            path: '/viewCenter',
            name: 'viewCenter',
            component: './viewCenter',
          },
          {
            path: '/toolCenter',
            name: 'toolCenter',
            component: './toolCenter',
          },
          {
            path: '/workCenter',
            name: 'workCenter',
            component: './workCenter',
          },
          {
            path: '/knowledgeDetail',
            name: 'knowledgeDetail',
            component: './knowledgeDetail',
          },
          {
            path: '/employees',
            name: 'employees',
            component: './employees',
          },
          {
            path: '/digitalEmployees',
            name: 'digitalEmployees',
            component: './digitalEmployees',
          },
          {
            path: '/myEmployees',
            name: 'myEmployees',
            component: './myEmployees',
          },
          {
            path: '/digitalEmployeesCreate',
            name: 'digitalEmployeesCreate',
            component: './manager/pages/digitalEmployeeMgr/EmployeeDetail',
          },
          {
            path: '/achievementSpace',
            name: 'achievementSpace',
            component: './achievementSpace',
          },
          {
            path: '/accessTokenMgmt',
            name: 'accessTokenMgmt',
            component: './accessTokenMgmt',
          },
          {
            path: '/projectSpace',
            name: 'projectSpace',
            component: './projectSpace',
          },
          {
            name: 'settings',
            path: '/settings',
            component: './settings',
          },
          {
            name: 'assistantSettings',
            path: '/assistantSettings',
            component: './assistantSettings',
          },
          {
            name: 'notice',
            path: '/notice',
            component: './notice',
          },
          {
            name: 'sandbox',
            path: '/sandbox',
            component: './sandbox',
          },
          {
            name: 'searchAndQuery',
            path: '/searchAndQuery',
            component: './searchAndQuery',
          },
        ],
      },
      {
        // 规范/文档页走独立布局:不要 Sider、会话态与抽屉,页面自己掌控滚动容器。
        path: '/spec',
        component: '@/layout/docLayout',
        routes: [
          {
            // 集成测试规范:全平台一份(status.json 契约由平台硬编码读取,项目改不了)。
            path: '/spec/integrationTest',
            name: 'specIntegrationTest',
            component: './spec',
          },
        ],
      },
      {
        path: '/iframes',
        component: '@/layout/pcLayout/simple',
        routes: [
          {
            path: '/iframes/employee',
            name: 'employee',
            component: './iframes/employee',
          },
          {
            path: '/iframes/adapter-recorder',
            name: 'adapterRecorder',
            component: './adapterRecorder',
          },
        ],
      },
    ],
  },
];
