import { requiresOfficialUpdateReview } from './identity';

it.each(['personal', 'personal_default'])(
  'keeps %s saving independent even when an old response marks it as official',
  (ownerType) => {
    expect(
      requiresOfficialUpdateReview({
        ownerType,
        operationPermissions: { officialPublication: true, officialUpdateRequiresReview: true },
      })
    ).toBe(false);
  }
);

it('requires review only for an enterprise publication copy whose maintainer must apply for an update', () => {
  expect(
    requiresOfficialUpdateReview({
      ownerType: 'enterprise',
      operationPermissions: { officialPublication: true, officialUpdateRequiresReview: true },
    })
  ).toBe(true);
  expect(
    requiresOfficialUpdateReview({
      ownerType: 'enterprise',
      operationPermissions: { officialPublication: true, officialUpdateRequiresReview: false },
    })
  ).toBe(false);
  expect(
    requiresOfficialUpdateReview({
      ownerType: 'enterprise',
      operationPermissions: { officialPublication: false, officialUpdateRequiresReview: true },
    })
  ).toBe(false);
});
