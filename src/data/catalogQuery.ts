import { queryOptions } from '@tanstack/react-query';
import type { Repository } from './repository';

export const catalogQuery = (repository: Repository) =>
  queryOptions({
    queryKey: ['catalog'],
    queryFn: () => repository.getCatalog(),
    staleTime: 60_000,
  });
