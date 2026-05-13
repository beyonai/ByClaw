import React, { FC, useState } from 'react';
import { Button, Popconfirm, Space } from 'antd';
// @ts-ignore
import { useDispatch, useIntl } from '@umijs/max';
import useGlobal from '@/hooks/useGlobal';
// import { deleteDigitalEmployee } from '@/service/digitalEmployees';

import ApplyForModal from '@/pages/digitalEmployees/components/ApplyForModal';

import AntdIcon from '@/components/AntdIcon';
import { IAgentCache } from '@/typescript/agent';

import styles from './index.module.less';

interface IProps {
  employee: IAgentCache;

  disableActionList?: Array<'delete' | 'apply' | 'unapply' | 'edit'>;
  allowDelete?: boolean;
  isLoading?: boolean;
}

export const UnApplyButton = ({
  employee,
  isLoading,
  setIsLoading,
  children,
}: {
  employee: IAgentCache;
  isLoading: boolean;
  setIsLoading: (isLoading: boolean) => void;
  children?: React.ReactNode;
}) => {
  const dispatch = useDispatch();
  const intl = useIntl();
  const { EventEmitter } = useGlobal();

  const { id } = employee || {};

  return (
    <Popconfirm
      title={intl.formatMessage({ id: 'digitalEmployees.unapplyConfirmTitle' })}
      description={intl.formatMessage({ id: 'digitalEmployees.unapplyConfirmDesc' })}
      onConfirm={(e) => {
        e?.stopPropagation();
        e?.preventDefault();

        setIsLoading?.(true);
        Promise.resolve(
          dispatch({
            type: 'employees/toUnApply',
            payload: {
              id,
            },
          })
        )
          .then(() => {
            EventEmitter.emit('beyond-update-employee', {
              unApplyList: [employee.agentId],
            });
          })
          .finally(() => {
            setIsLoading?.(false);
          });
      }}
    >
      {children ? (
        <>{children}</>
      ) : (
        <Button
          icon={<AntdIcon type="icon-a-Editorbianji" />}
          size="small"
          danger
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          loading={isLoading}
          className={styles.button}
        >
          {intl.formatMessage({ id: 'digitalEmployees.unapply' })}
        </Button>
      )}
    </Popconfirm>
  );
};

// const DelButton = ({
//   employee,
//   isLoading,
//   setIsLoading,
// }: {
//   employee: IAgentCache;
//   isLoading: boolean;
//   setIsLoading?: (isLoading: boolean) => void;
// }) => {
//   const intl = useIntl();
//   const { EventEmitter } = useGlobal();

//   const { id } = employee;
//   return (
//     <Popconfirm
//       title={intl.formatMessage({ id: 'digitalEmployees.deleteConfirmTitle' })}
//       description={intl.formatMessage({ id: 'digitalEmployees.deleteConfirmDesc' })}
//       onConfirm={() => {
//         setIsLoading?.(true);
//         deleteDigitalEmployee({
//           resourceId: String(employee.resourceId ?? id),
//         })
//           .then(() => {
//             EventEmitter.emit('beyond-update-employee', {
//               delIdList: [employee.agentId],
//             });
//           })
//           .finally(() => {
//             setIsLoading?.(false);
//           });
//       }}
//     >
//       <Button
//         size="small"
//         type="primary"
//         danger
//         onClick={(e) => {
//           e.stopPropagation();
//           e.preventDefault();
//         }}
//         loading={isLoading}
//         className={styles.button}
//       >
//         {intl.formatMessage({ id: 'common.delete' })}
//       </Button>
//     </Popconfirm>
//   );
// };

// const EditButton = ({ employee }: { employee: IAgentCache }) => {
//   const intl = useIntl();
//   const navigate = useNavigate();
//   return (
//     <Button
//       onClick={(e) => {
//         e.stopPropagation();
//         e.preventDefault();
//         // 详情接口 findDetailsById 入参为 resourceId，与列表里的资源主键一致
//         const resourceId = employee?.resourceId ?? employee?.id ?? employee?.agentId;
//         sessionStorage.setItem('EmployeeDetail_prevRoute', `${window.location.pathname}${window.location.search}`);
//         navigate(`/digitalEmployeesCreate?digitalType=FROM_MANUALLY&appId=${resourceId}`);
//       }}
//       icon={<AntdIcon type="icon-a-Editorbianji" />}
//       size="small"
//       type="primary"
//     >
//       {intl.formatMessage({ id: 'common.edit' })}
//     </Button>
//   );
// };

const RenderRightBottom: FC<IProps> = (
  {
    // employee, disableActionList, allowDelete = false, isLoading = false
  }
) => {
  // const { myCreate } = employee || {};

  const [showApply, setShowApply] = useState<boolean>(false);
  const [curId, setCurId] = useState<string>('');

  // const canDelete = allowDelete && myCreate && !disableActionList?.includes('delete');
  // const canEdit = myCreate && !disableActionList?.includes('edit');
  // const canApply = id && !approveStatus && !grantType && !disableActionList?.includes('apply');
  // const canUnApply = grantType === 'AVAILABLE_USE' && !disableActionList?.includes('unapply');

  return (
    <>
      <Space size="small">
        {/* {canEdit && <EditButton employee={employee} />} */}
        {/* {canDelete && <DelButton employee={employee} isLoading={isLoading} setIsLoading={() => {}} />} */}
        {/* {!canDelete && canUnApply && (
          <UnApplyButton employee={employee} isLoading={isLoading} setIsLoading={() => {}} />
        )}
        {canApply && (
          <ApplyButton employee={employee} setCurId={setCurId} setShowApply={setShowApply} isLoading={isLoading} />
        )} */}
      </Space>
      <ApplyForModal
        id={curId}
        visible={showApply}
        onClose={() => {
          setShowApply(false);
          setCurId('');
        }}
      />
    </>
  );
};

export default RenderRightBottom;
