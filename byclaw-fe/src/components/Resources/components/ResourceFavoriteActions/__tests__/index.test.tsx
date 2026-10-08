import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { message } from 'antd';
import ResourceFavoriteActions from '..';
import { RESOURCE_FAVORITE_CHANGED_EVENT, setResourceFavorite } from '@/service/resourceFavorites';

jest.mock('@umijs/max', () => ({ useIntl: () => ({ formatMessage: ({ id }: any) => id }) }));
jest.mock('@/service/resourceFavorites', () => ({
  RESOURCE_FAVORITE_CHANGED_EVENT: 'resourceFavoriteChanged',
  setResourceFavorite: jest.fn(),
}));

beforeEach(() => jest.clearAllMocks());

it.each([
  [true, true, 'authorized'],
  [false, true, 'pending'],
  [false, false, 'unauthorized'],
])('shows the user relationship from loaded list permissions (%s, %s)', (hasUsePermission, useApplyPending, state) => {
  render(
    <ResourceFavoriteActions
      resourceId="10"
      operationPermissionsLoaded
      hasUsePermission={hasUsePermission}
      useApplyPending={useApplyPending}
    />
  );
  expect(screen.getByText(`resource.authorization.${state}`)).toBeInTheDocument();
  expect(setResourceFavorite).not.toHaveBeenCalled();
});

it('does not label unloaded permissions as unauthorized', () => {
  render(<ResourceFavoriteActions resourceId="10" />);
  expect(screen.queryByText('resource.authorization.unauthorized')).toBeNull();
});

it('locks only the clicked button, sends one mutation and does not open the card', async () => {
  let finish!: (value: any) => void;
  (setResourceFavorite as jest.Mock).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const onCardClick = jest.fn();
  const changed = jest.fn();
  window.addEventListener(RESOURCE_FAVORITE_CHANGED_EVENT, changed);
  render(
    <div onClick={onCardClick}>
      <ResourceFavoriteActions resourceId="10" favoriteCount={4} />
      <ResourceFavoriteActions resourceId="20" favoriteCount={8} />
    </div>
  );
  const buttons = screen.getAllByRole('button', { name: 'resource.favorite.add' });
  fireEvent.click(buttons[0]);
  fireEvent.click(buttons[0]);
  expect(buttons[0]).toBeDisabled();
  expect(buttons[1]).not.toBeDisabled();
  expect(setResourceFavorite).toHaveBeenCalledTimes(1);
  expect(setResourceFavorite).toHaveBeenCalledWith('10', true);
  expect(onCardClick).not.toHaveBeenCalled();
  await act(async () => {
    finish({ favorited: true, favoriteCount: 5 });
  });
  expect(changed.mock.calls[0][0].detail).toEqual({ resourceId: '10', favorited: true, favoriteCount: 5 });
  window.removeEventListener(RESOURCE_FAVORITE_CHANGED_EVENT, changed);
});

it('keeps the favorite state and count on mutation failure', async () => {
  (setResourceFavorite as jest.Mock).mockRejectedValue(new Error('failed'));
  const error = jest.spyOn(message, 'error').mockImplementation(() => undefined as any);
  render(<ResourceFavoriteActions resourceId="10" favorited favoriteCount={4} />);
  fireEvent.click(screen.getByRole('button', { name: 'resource.favorite.cancel' }));
  await waitFor(() => expect(error).toHaveBeenCalled());
  expect(screen.getByRole('button', { name: 'resource.favorite.cancel' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('4')).toBeInTheDocument();
  error.mockRestore();
});
