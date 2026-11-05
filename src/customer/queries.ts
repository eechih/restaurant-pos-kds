import { queryOptions } from '@tanstack/react-query';
import type { CustomerRepository } from '../data/customerRepository';

const POLL_INTERVAL_MS = 5_000;

export const tableQuery = (repository: CustomerRepository, tableToken: string) =>
  queryOptions({
    queryKey: ['customer', 'table', tableToken],
    queryFn: () => repository.getTable(tableToken),
    staleTime: 5 * 60_000,
  });

export const menuQuery = (repository: CustomerRepository) =>
  queryOptions({
    queryKey: ['customer', 'menu'],
    queryFn: () => repository.getMenu(),
    staleTime: 60_000,
  });

export const orderQuery = (repository: CustomerRepository, orderId: string) =>
  queryOptions({
    queryKey: ['customer', 'order', orderId],
    queryFn: () => repository.getOrder(orderId),
    // An order that has been served or has expired will not change again.
    refetchInterval: ({ state: { data } }) =>
      data === null || data?.status === 'EXPIRED' || data?.ticketStatus === 'SERVED'
        ? false
        : POLL_INTERVAL_MS,
  });
