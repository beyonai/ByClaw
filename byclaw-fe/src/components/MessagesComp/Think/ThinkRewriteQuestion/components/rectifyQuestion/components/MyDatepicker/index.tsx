// tslint:disable:ordered-imports
import React, { useState, useRef, useEffect } from 'react';
import dayjs from 'dayjs';
import { Button, DatePicker, Space } from 'antd';
import { concat } from 'lodash';
import { CalendarOutlined } from '@ant-design/icons';
import { getIntl } from '@umijs/max';

import styles from './style.less';

const { RangePicker } = DatePicker;

let dateFormat = 'YYYYMMDD';

type IProps = {
  dataObj: string[];
  onChangeDate: (newDate: string[]) => void;
  formatType: string;
  conditionType: string;
};

function MyRangePicker(props: { startDate: string; endDate: string; onChangeDate: (newDate: string[]) => void }) {
  const { startDate, endDate, onChangeDate } = props;
  const intl = getIntl();
  const [isEdit, setIsEdit] = useState(false);

  const lastDate = useRef([startDate, endDate]);

  if (!isEdit) {
    return (
      <>
        {startDate}
        <>&nbsp;-&nbsp;</>
        {endDate}
        <CalendarOutlined
          className={styles.calendarOutlinedIcon}
          onClick={() => {
            setIsEdit(true);
          }}
        />
      </>
    );
  }

  return (
    <RangePicker
      defaultValue={[dayjs(startDate, dateFormat), dayjs(endDate, dateFormat)]}
      format={dateFormat}
      className={styles.dateTagPicker}
      allowClear={false}
      size="small"
      open
      placement="topLeft"
      onChange={(_value, dateString) => {
        lastDate.current = dateString;
      }}
      renderExtraFooter={() => (
        <div className="ub ub-ac ub-pe">
          <Space>
            <Button size="small" onClick={() => setIsEdit(false)}>
              {intl.formatMessage({ id: 'common.cancel' })}
            </Button>
            <Button
              size="small"
              type="primary"
              onClick={() => {
                setIsEdit(false);
                onChangeDate(lastDate.current);
              }}
            >
              {intl.formatMessage({ id: 'common.confirm' })}
            </Button>
          </Space>
        </div>
      )}
    />
  );
}

function MyDatePicker(props: { curDate: string; onChangeDate: (newDate: string[]) => void }) {
  const { curDate, onChangeDate } = props;
  const intl = getIntl();
  const [isEdit, setIsEdit] = useState(false);
  const lastDate = useRef(concat([], curDate));

  if (!isEdit) {
    return (
      <>
        {curDate}
        <CalendarOutlined
          className={styles.calendarOutlinedIcon}
          onClick={() => {
            setIsEdit(true);
          }}
        />
      </>
    );
  }

  return (
    <DatePicker
      defaultValue={dayjs(curDate, dateFormat)}
      format={dateFormat}
      className={styles.dateTagPicker}
      allowClear={false}
      size="small"
      open
      placement="topLeft"
      onChange={(_value, dateString) => {
        lastDate.current = concat([], dateString);
      }}
      renderExtraFooter={() => (
        <div className="ub ub-ac ub-pe">
          <Space>
            <Button size="small" onClick={() => setIsEdit(false)}>
              {intl.formatMessage({ id: 'common.cancel' })}
            </Button>
            <Button
              size="small"
              type="primary"
              onClick={() => {
                setIsEdit(false);
                onChangeDate(lastDate.current);
              }}
            >
              {intl.formatMessage({ id: 'common.confirm' })}
            </Button>
          </Space>
        </div>
      )}
    />
  );
}

function Datepicker(props: IProps) {
  const { dataObj, onChangeDate, formatType = 'YYYYMMDD', conditionType } = props;
  const [startDate, endDate] = dataObj || [];

  useEffect(() => {
    dateFormat = formatType.toLocaleUpperCase();
  }, []);

  if ((conditionType || '').toLocaleLowerCase() === 'between') {
    return <MyRangePicker startDate={startDate} endDate={endDate} onChangeDate={onChangeDate} />;
  }

  return <MyDatePicker curDate={startDate} onChangeDate={onChangeDate} />;
}

export default Datepicker;
