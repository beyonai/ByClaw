import { useRequest } from 'ahooks';
import { getPublicationCapabilities } from '@/service/employeePublication';

export default function useEmployeePublicationCapabilities() {
  return useRequest(getPublicationCapabilities, { cacheKey: 'employee-publication-capabilities', staleTime: 60000 })
    .data;
}
