import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Person, PersonListItem, PersonDetail } from '../lib/types';

export function usePeople() {
  return useQuery({
    queryKey: ['people'],
    queryFn: () => api.get<PersonListItem[]>('/people'),
  });
}

export function usePerson(id: string) {
  return useQuery({
    queryKey: ['people', id],
    queryFn: () => api.get<PersonDetail>(`/people/${id}`),
    enabled: !!id,
  });
}

export function useCreatePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; relationship?: string; keywords?: string[]; phone?: string; email?: string; organization?: string }) =>
      api.post<Person>('/people', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['people'] }),
  });
}

export function useUpdatePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; relationship?: string; keywords?: string[] }) =>
      api.patch<Person>(`/people/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['people'] }),
  });
}

export function useDeletePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/people/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['people'] }),
  });
}
