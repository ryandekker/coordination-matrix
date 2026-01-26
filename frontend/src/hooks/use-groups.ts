'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { groupsApi, projectsApi, Group, Project, GroupRole, ProjectStatus } from '@/lib/api'

// ============================================================================
// Groups Hooks
// ============================================================================

interface UseGroupsOptions {
  all?: boolean
  enabled?: boolean
}

export function useGroups(options?: UseGroupsOptions) {
  const { enabled = true, ...params } = options || {}

  return useQuery({
    queryKey: ['groups', params],
    queryFn: () => groupsApi.list(params),
    enabled,
    staleTime: 30 * 1000, // 30 seconds
  })
}

export function useGroup(id: string | null) {
  return useQuery({
    queryKey: ['group', id],
    queryFn: () => (id ? groupsApi.get(id) : null),
    enabled: !!id,
  })
}

export function useGroupMembers(id: string | null) {
  return useQuery({
    queryKey: ['group-members', id],
    queryFn: () => (id ? groupsApi.getMembers(id) : null),
    enabled: !!id,
  })
}

export function useCreateGroup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: groupsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] })
    },
  })
}

export function useUpdateGroup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string
      data: Parameters<typeof groupsApi.update>[1]
    }) => groupsApi.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['groups'] })
      queryClient.invalidateQueries({ queryKey: ['group', id] })
    },
  })
}

export function useDeleteGroup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: groupsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] })
    },
  })
}

export function useAddGroupMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      groupId,
      userId,
      role,
    }: {
      groupId: string
      userId: string
      role?: GroupRole
    }) => groupsApi.addMember(groupId, { userId, role }),
    onSuccess: (_, { groupId }) => {
      queryClient.invalidateQueries({ queryKey: ['groups'] })
      queryClient.invalidateQueries({ queryKey: ['group', groupId] })
      queryClient.invalidateQueries({ queryKey: ['group-members', groupId] })
    },
  })
}

export function useUpdateGroupMemberRole() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      groupId,
      userId,
      role,
    }: {
      groupId: string
      userId: string
      role: GroupRole
    }) => groupsApi.updateMemberRole(groupId, userId, role),
    onSuccess: (_, { groupId }) => {
      queryClient.invalidateQueries({ queryKey: ['groups'] })
      queryClient.invalidateQueries({ queryKey: ['group', groupId] })
      queryClient.invalidateQueries({ queryKey: ['group-members', groupId] })
    },
  })
}

export function useRemoveGroupMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ groupId, userId }: { groupId: string; userId: string }) =>
      groupsApi.removeMember(groupId, userId),
    onSuccess: (_, { groupId }) => {
      queryClient.invalidateQueries({ queryKey: ['groups'] })
      queryClient.invalidateQueries({ queryKey: ['group', groupId] })
      queryClient.invalidateQueries({ queryKey: ['group-members', groupId] })
    },
  })
}

// ============================================================================
// Projects Hooks
// ============================================================================

interface UseProjectsOptions {
  groupId?: string
  status?: ProjectStatus
  enabled?: boolean
}

export function useProjects(options?: UseProjectsOptions) {
  const { enabled = true, ...params } = options || {}

  return useQuery({
    queryKey: ['projects', params],
    queryFn: () => projectsApi.list(params),
    enabled,
    staleTime: 30 * 1000, // 30 seconds
  })
}

export function useProject(id: string | null) {
  return useQuery({
    queryKey: ['project', id],
    queryFn: () => (id ? projectsApi.get(id) : null),
    enabled: !!id,
  })
}

export function useCreateProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: projectsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useUpdateProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string
      data: Parameters<typeof projectsApi.update>[1]
    }) => projectsApi.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['project', id] })
    },
  })
}

export function useDeleteProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: projectsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}
