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
            path: '/objectCenter',
            name: 'objectCenter',
            component: './objectCenter',
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
        path: '/iframes',
        component: '@/layout/pcLayout/simple',
        routes: [
          {
            path: '/iframes/employee',
            name: 'employee',
            component: './iframes/employee',
          },
        ],
      },
    ],
  },
];
