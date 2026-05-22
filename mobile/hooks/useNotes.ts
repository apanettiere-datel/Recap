import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Note, SearchResults } from '../lib/types';

export function useNotes() {
  return useQuery({
    queryKey: ['notes'],
    queryFn: () => api.get<Note[]>('/notes'),
    refetchInterval: (query) => {
      const notes = query.state.data;
      if (notes?.some(n => n.isProcessing)) return 3000;
      return false;
    },
  });
}

export function useNote(id: string) {
  return useQuery({
    queryKey: ['notes', id],
    queryFn: () => api.get<Note>(`/notes/${id}`),
    enabled: !!id,
  });
}

export function useUploadNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (formData: FormData) => api.upload<{ id: string }>('/notes', formData),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/notes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });
}

export function useUpdateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; title?: string; summary?: string; isPinned?: boolean; isArchived?: boolean }) =>
      api.patch<Note>(`/notes/${id}`, body),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['notes'] });
      qc.invalidateQueries({ queryKey: ['notes', vars.id] });
    },
  });
}

export function useSearchNotes(query: string) {
  return useQuery({
    queryKey: ['search', query],
    queryFn: () => api.get<SearchResults>(`/notes/search/${encodeURIComponent(query)}`),
    enabled: query.length >= 2,
  });
}
