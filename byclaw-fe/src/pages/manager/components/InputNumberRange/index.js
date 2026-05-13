import React, { forwardRef, useImperativeHandle, useEffect, useState } from 'react';

import { useIntl } from '@umijs/max';
import { Row, Col, InputNumber } from 'antd';

const InputNumberRange = forwardRef((props, ref) => {
  useImperativeHandle(ref, () => ({}));

  const intl = useIntl();

  const { separatorWidth = '20%', value, onChange, min = 0, max = 100, precision, inputSuffix = null } = props;

  const [values, setValues] = useState(value);

  useEffect(() => {
    setValues(value);
  }, [value]);

  return (
    <Row align="middle">
      <InputNumber
        style={{ width: '40%', textAlign: 'center' }}
        placeholder={intl.formatMessage({ id: 'employeeDetail.minValue' })}
        min={min}
        max={value?.[1] ?? max}
        value={values?.[0]}
        precision={precision}
        onChange={(v) => {
          (onChange || setValues)([v, values?.[1]]);
        }}
      />
      {inputSuffix}
      <Col style={{ width: separatorWidth, textAlign: 'center' }}> ~~ </Col>
      {/*
      <Input
        style={{
          width: '20%',
          borderLeft: 0,
          pointerEvents: 'none',
          backgroundColor: THEME_COLOR === '1' ? 'none' : '#303A39',
        }}
        placeholder="~"
        disabled
      />
      */}
      <InputNumber
        style={{ width: '40%', textAlign: 'center' }}
        placeholder={intl.formatMessage({ id: 'employeeDetail.maxValue' })}
        value={values?.[1]}
        min={values?.[0] ?? min}
        max={max}
        precision={precision}
        onChange={(v) => {
          (onChange || setValues)([values?.[0], v]);
        }}
      />
      {inputSuffix}
    </Row>
  );
});

export default InputNumberRange;
