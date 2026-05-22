import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Commitment } from '../lib/types';

export function useCommitments(status?: 'open' | 'completed' | 'overdue') {
  return useQuery({
    queryKey: ['commitments', status],
    queryFn: () => api.get<Commitment[]>(`/commitments${status ? `?status=${status}` : ''}`),
  });
}

export function useUpdateCommitment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; status?: string; dueDate?: string | null; addedToCalendar?: boolean; description?: string }) =>
      api.patch<Commitment>(`/commitments/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['commitments'] });
      qc.invalidateQueries({ queryKey: ['notes'] });
      qc.invalidateQueries({ queryKey: ['people'] });
    },
  });
}
