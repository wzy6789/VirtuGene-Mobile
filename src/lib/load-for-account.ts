import { useAuthStore } from '../store/auth-store';

/** Chunk downloads introduce a yield: do not run an operation for the account that has since left. */
export async function loadForAccount<T>(userId: string, load: () => Promise<T>): Promise<T> {
  const assertOwner = () => { if (!userId || useAuthStore.getState().userId !== userId) throw new Error('账号已切换，请重新打开。'); };
  assertOwner();
  const module = await load();
  assertOwner();
  return module;
}
