import { QueryClient, useQuery } from '@tanstack/react-query';
import { api } from './client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

export const keys = {
  settings: ['settings'] as const,
  projects: ['projects'] as const,
  board: (id: string) => ['board', id] as const,
  events: (id: string) => ['events', id] as const,
  task: (id: string) => ['task', id] as const,
};

export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: api.settings });
export const useProjects = () => useQuery({ queryKey: keys.projects, queryFn: api.projects });
export const useBoard = (id: string | null) =>
  useQuery({ queryKey: keys.board(id ?? ''), queryFn: () => api.board(id!), enabled: !!id });
export const useEvents = (id: string | null) =>
  useQuery({ queryKey: keys.events(id ?? ''), queryFn: () => api.events(id!, 100), enabled: !!id });
export const useTask = (id: string | null) =>
  useQuery({ queryKey: keys.task(id ?? ''), queryFn: () => api.task(id!), enabled: !!id });

/** Перечитать всё, что зависит от проекта (после своей мутации или события SSE). */
export function refreshProject(projectId: string | null | undefined) {
  void queryClient.invalidateQueries({ queryKey: keys.projects });
  void queryClient.invalidateQueries({ queryKey: ['task'] });
  if (projectId) {
    void queryClient.invalidateQueries({ queryKey: keys.board(projectId) });
    void queryClient.invalidateQueries({ queryKey: keys.events(projectId) });
  } else {
    void queryClient.invalidateQueries({ queryKey: keys.settings });
  }
}
