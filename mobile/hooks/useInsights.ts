import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Insight, WeeklyReport } from '../lib/types';

export function useInsights() {
  return useQuery({
    queryKey: ['insights'],
    queryFn: () => api.get<Insight[]>('/insights'),
  });
}

export function useRefreshInsights() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Insight[]>('/insights/refresh'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['insights'] }),
  });
}

export function useDismissInsight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.patch(`/insights/${id}/dismiss`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['insights'] }),
  });
}

export function useWeeklyReports() {
  return useQuery({
    queryKey: ['reports'],
    queryFn: () => api.get<WeeklyReport[]>('/insights/reports'),
  });
}

export function useGenerateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<WeeklyReport>('/insights/reports/generate'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports'] }),
  });
}

export function useChat() {
  return useMutation({
    mutationFn: (message: string) =>
      api.post<{ reply: string }>('/insights/chat', { message }),
  });
}
