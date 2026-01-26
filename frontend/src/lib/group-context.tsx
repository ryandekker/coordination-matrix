'use client'

import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo } from 'react'
import { Group, Project, groupsApi, projectsApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'

interface GroupContextType {
  // Current selections
  currentGroup: Group | null
  currentProject: Project | null

  // Available options
  groups: Group[]
  projects: Project[]  // Projects for current group

  // Loading states
  isLoadingGroups: boolean
  isLoadingProjects: boolean

  // Actions
  setCurrentGroup: (group: Group | null) => void
  setCurrentProject: (project: Project | null) => void
  refreshGroups: () => Promise<void>
  refreshProjects: () => Promise<void>

  // Helpers
  currentGroupId: string | null
  currentProjectId: string | null
}

const GroupContext = createContext<GroupContextType | undefined>(undefined)

const STORAGE_KEY_GROUP = 'current_group_id'
const STORAGE_KEY_PROJECT = 'current_project_id'

export function GroupProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: isAuthLoading } = useAuth()

  // Groups state
  const [groups, setGroups] = useState<Group[]>([])
  const [currentGroup, setCurrentGroupState] = useState<Group | null>(null)
  const [isLoadingGroups, setIsLoadingGroups] = useState(true)

  // Projects state
  const [projects, setProjects] = useState<Project[]>([])
  const [currentProject, setCurrentProjectState] = useState<Project | null>(null)
  const [isLoadingProjects, setIsLoadingProjects] = useState(false)

  // Fetch groups
  const refreshGroups = useCallback(async () => {
    if (!user) {
      setGroups([])
      setCurrentGroupState(null)
      setIsLoadingGroups(false)
      return
    }

    setIsLoadingGroups(true)
    try {
      const response = await groupsApi.list()
      const fetchedGroups = response.data || []
      setGroups(fetchedGroups)

      // Try to restore saved group from localStorage
      const savedGroupId = localStorage.getItem(STORAGE_KEY_GROUP)
      if (savedGroupId) {
        const savedGroup = fetchedGroups.find((g) => g._id === savedGroupId)
        if (savedGroup) {
          setCurrentGroupState(savedGroup)
        } else if (fetchedGroups.length > 0) {
          // Saved group no longer accessible, use first available
          setCurrentGroupState(fetchedGroups[0])
          localStorage.setItem(STORAGE_KEY_GROUP, fetchedGroups[0]._id)
        }
      } else if (fetchedGroups.length > 0) {
        // No saved group, select first one
        setCurrentGroupState(fetchedGroups[0])
        localStorage.setItem(STORAGE_KEY_GROUP, fetchedGroups[0]._id)
      }
    } catch (error) {
      console.error('Failed to fetch groups:', error)
      setGroups([])
    } finally {
      setIsLoadingGroups(false)
    }
  }, [user])

  // Fetch projects for current group
  const refreshProjects = useCallback(async () => {
    if (!currentGroup) {
      setProjects([])
      setCurrentProjectState(null)
      return
    }

    setIsLoadingProjects(true)
    try {
      const response = await projectsApi.list({ groupId: currentGroup._id })
      const fetchedProjects = response.data || []
      setProjects(fetchedProjects)

      // Try to restore saved project from localStorage
      const savedProjectId = localStorage.getItem(STORAGE_KEY_PROJECT)
      if (savedProjectId) {
        const savedProject = fetchedProjects.find((p) => p._id === savedProjectId)
        if (savedProject) {
          setCurrentProjectState(savedProject)
        } else {
          // Saved project not in this group, clear selection
          setCurrentProjectState(null)
          localStorage.removeItem(STORAGE_KEY_PROJECT)
        }
      } else {
        setCurrentProjectState(null)
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error)
      setProjects([])
    } finally {
      setIsLoadingProjects(false)
    }
  }, [currentGroup])

  // Set current group with persistence
  const setCurrentGroup = useCallback((group: Group | null) => {
    setCurrentGroupState(group)
    if (group) {
      localStorage.setItem(STORAGE_KEY_GROUP, group._id)
    } else {
      localStorage.removeItem(STORAGE_KEY_GROUP)
    }
    // Clear project when group changes
    setCurrentProjectState(null)
    localStorage.removeItem(STORAGE_KEY_PROJECT)
  }, [])

  // Set current project with persistence
  const setCurrentProject = useCallback((project: Project | null) => {
    setCurrentProjectState(project)
    if (project) {
      localStorage.setItem(STORAGE_KEY_PROJECT, project._id)
    } else {
      localStorage.removeItem(STORAGE_KEY_PROJECT)
    }
  }, [])

  // Fetch groups when user changes
  useEffect(() => {
    if (!isAuthLoading) {
      refreshGroups()
    }
  }, [user, isAuthLoading, refreshGroups])

  // Fetch projects when group changes
  useEffect(() => {
    refreshProjects()
  }, [currentGroup, refreshProjects])

  const value = useMemo(
    () => ({
      currentGroup,
      currentProject,
      groups,
      projects,
      isLoadingGroups,
      isLoadingProjects,
      setCurrentGroup,
      setCurrentProject,
      refreshGroups,
      refreshProjects,
      currentGroupId: currentGroup?._id || null,
      currentProjectId: currentProject?._id || null,
    }),
    [
      currentGroup,
      currentProject,
      groups,
      projects,
      isLoadingGroups,
      isLoadingProjects,
      setCurrentGroup,
      setCurrentProject,
      refreshGroups,
      refreshProjects,
    ]
  )

  return <GroupContext.Provider value={value}>{children}</GroupContext.Provider>
}

export function useGroupContext() {
  const context = useContext(GroupContext)
  if (context === undefined) {
    throw new Error('useGroupContext must be used within a GroupProvider')
  }
  return context
}

// Convenience hook to get just the current group/project IDs
export function useCurrentGroupProject() {
  const { currentGroupId, currentProjectId } = useGroupContext()
  return { groupId: currentGroupId, projectId: currentProjectId }
}
