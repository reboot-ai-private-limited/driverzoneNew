import type { CustomerWalletDto } from '@driverzone/contracts';
import { ROLE_PREFIX } from '../../config';
import { request } from '../client';
import { getAccessToken } from '../../auth/session';

/**
 * `GET /customer/wallet` — the signed-in customer's balance and statement.
 *
 * Scoped by the access token alone; there is no id to pass and so no way to ask for anybody
 * else's. The three figures (`balance`, `spendable_credit`, `amount_owed`) all come DOWN from the
 * server rather than being derived here, so this app cannot disagree with the fare sheet about
 * what a negative balance means.
 */
export function getWallet(): Promise<CustomerWalletDto> {
  return request<CustomerWalletDto>(`${ROLE_PREFIX}/wallet`, {
    token: getAccessToken() ?? undefined,
  });
}
