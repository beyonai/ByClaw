jest.mock('@/service/common/request', () => ({
  GET: jest.fn(),
  POST: jest.fn(),
}));

import {
  addRelDataset,
  checkEmployeeAudit,
  createDigitalEmployee,
  findDetailsById,
  getCompositeAppInfo,
  getSourceOption,
  importToolJson,
  publishApp,
  queryAgentByPage,
  queryResourcesByPage,
  saveDigitalEmployee,
  selectDigitalEmployeeByQo,
} from '../DigitalEmployeeMgr';
import { GET, POST } from '@/service/common/request';

const mockGET = GET as jest.MockedFunction<typeof GET>;
const mockPOST = POST as jest.MockedFunction<typeof POST>;

describe('manager/service/DigitalEmployeeMgr', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('queryAgentByPage posts with customHandle config', () => {
    const payload = { pageNum: 1, pageSize: 10 };
    queryAgentByPage(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/digitalEmployeeController/queryAgentByPage', payload, {
      responseCfg: {
        customHandle: true,
      },
    });
  });

  it('selectDigitalEmployeeByQo posts with customHandle config', () => {
    const payload = { keyword: 'agent' };
    selectDigitalEmployeeByQo(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/digitalEmployeeController/selectDigitalEmployeeByQo', payload, {
      responseCfg: {
        customHandle: true,
      },
    });
  });

  it('createDigitalEmployee posts with customHandle config', () => {
    const payload = { resourceName: 'agent' };
    createDigitalEmployee(payload);
    expect(mockPOST).toHaveBeenCalledWith(
      '/byaiService/digitalEmployeeController/createDigitalEmployee',
      {
        ...payload,
        implType: '',
        workerAgentType: '',
      },
      {
        responseCfg: {
          customHandle: true,
        },
      }
    );
  });

  it('saveDigitalEmployee posts with customHandle config', () => {
    const payload = { resourceName: 'agent' };
    saveDigitalEmployee(payload);
    expect(mockPOST).toHaveBeenCalledWith(
      '/byaiService/digitalEmployeeController/saveDigitalEmployee',
      {
        ...payload,
        implType: '',
        workerAgentType: '',
      },
      {
        responseCfg: {
          customHandle: true,
        },
      }
    );
  });

  it('checkEmployeeAudit posts with customHandle config', () => {
    const payload = { resourceId: '1' };
    checkEmployeeAudit(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/digitalEmployeeController/checkEmployeeAudit', payload, {
      responseCfg: {
        customHandle: true,
      },
    });
  });

  it('findDetailsById normalizes resourceId payload', () => {
    findDetailsById({ resourceId: '1' });
    expect(mockPOST).toHaveBeenCalledWith(
      '/byaiService/digitalEmployeeController/findDetailsById',
      { resourceId: '1' },
      {
        responseCfg: {
          customHandle: true,
        },
      }
    );
  });

  it('getCompositeAppInfo uses details endpoint when resourceId exists', () => {
    getCompositeAppInfo({ id: '1' });
    expect(mockPOST).toHaveBeenCalledWith(
      '/byaiService/digitalEmployeeController/findDetailsById',
      { resourceId: '1' },
      {
        responseCfg: {
          customHandle: true,
        },
      }
    );
  });

  it('getCompositeAppInfo falls back to generic endpoint when resourceId is absent', () => {
    const payload = { pageNum: 1 };
    getCompositeAppInfo(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/api/v1/digitEmploy/getCompositeAppInfo', payload, {
      responseCfg: {
        customHandle: true,
      },
    });
  });

  it('publishApp posts with customHandle config', () => {
    const payload = { resourceId: '1' };
    publishApp(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/digitalEmployeeController/publishApp', payload, {
      responseCfg: {
        customHandle: true,
      },
    });
  });

  it('queryResourcesByPage posts with customHandle config', () => {
    const payload = { pageNum: 1 };
    queryResourcesByPage(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/open/api/v1/queryResourcesByPage', payload, {
      responseCfg: {
        customHandle: true,
      },
    });
  });

  it('addRelDataset posts with customHandle config', () => {
    const payload = { resourceId: '1', datasetId: '2' };
    addRelDataset(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/digitalEmployeeController/addRelDataset', payload, {
      responseCfg: {
        customHandle: true,
      },
    });
  });

  it('getSourceOption calls GET with customHandle config', () => {
    getSourceOption();
    expect(mockGET).toHaveBeenCalledWith(
      '/byaiService/system/sourcesystem/getSourceSystemList',
      {},
      {
        responseCfg: {
          customHandle: true,
        },
      }
    );
  });

  it('importToolJson posts multipart form data with customHandle config', () => {
    const file = new File(['{}'], 'tool.json', { type: 'application/json' });
    importToolJson({ file, catalogId: '3' });

    expect(mockPOST).toHaveBeenCalledTimes(1);
    const [url, formData, config] = mockPOST.mock.calls[0];
    expect(url).toBe('/byaiService/tool/importToolJson');
    expect(formData).toBeInstanceOf(FormData);
    expect((formData as FormData).get('file')).toBe(file);
    expect((formData as FormData).get('catalogId')).toBe('3');
    expect(config).toEqual({
      headers: { 'Content-Type': 'multipart/form-data' },
      responseCfg: {
        customHandle: true,
      },
    });
  });
});
