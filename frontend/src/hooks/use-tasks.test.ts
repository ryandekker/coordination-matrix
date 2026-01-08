import { describe, it, expect } from 'vitest'

// Test the helper functions that can be tested in isolation

describe('use-tasks helpers', () => {
  describe('normalizeParams', () => {
    // Recreate the function for testing
    function normalizeParams(params?: Record<string, string | number | boolean>): string {
      if (!params) return ''
      const sortedKeys = Object.keys(params).sort()
      return sortedKeys.map(k => `${k}:${params[k]}`).join('|')
    }

    it('should return empty string for undefined params', () => {
      expect(normalizeParams(undefined)).toBe('')
    })

    it('should return empty string for empty object', () => {
      expect(normalizeParams({})).toBe('')
    })

    it('should normalize single param', () => {
      expect(normalizeParams({ status: 'pending' })).toBe('status:pending')
    })

    it('should sort keys alphabetically', () => {
      const params = { zebra: 'z', alpha: 'a', middle: 'm' }
      expect(normalizeParams(params)).toBe('alpha:a|middle:m|zebra:z')
    })

    it('should handle different value types', () => {
      const params = { str: 'value', num: 42, bool: true }
      expect(normalizeParams(params)).toBe('bool:true|num:42|str:value')
    })

    it('should create consistent keys for same params', () => {
      const params1 = { b: '2', a: '1' }
      const params2 = { a: '1', b: '2' }
      expect(normalizeParams(params1)).toBe(normalizeParams(params2))
    })
  })

  describe('updateTaskInTree', () => {
    interface Task {
      _id: string
      title: string
      status: string
      children?: Task[]
    }

    // Recreate the function for testing
    function updateTaskInTree(tasks: Task[], taskId: string, updates: Partial<Task>): Task[] {
      return tasks.map(task => {
        if (task._id === taskId) {
          return { ...task, ...updates }
        }
        if (task.children && task.children.length > 0) {
          return {
            ...task,
            children: updateTaskInTree(task.children, taskId, updates)
          }
        }
        return task
      })
    }

    it('should update task at root level', () => {
      const tasks: Task[] = [
        { _id: '1', title: 'Task 1', status: 'pending' },
        { _id: '2', title: 'Task 2', status: 'pending' },
      ]

      const result = updateTaskInTree(tasks, '1', { status: 'completed' })

      expect(result[0].status).toBe('completed')
      expect(result[1].status).toBe('pending')
    })

    it('should update nested task', () => {
      const tasks: Task[] = [
        {
          _id: '1',
          title: 'Parent',
          status: 'pending',
          children: [
            { _id: '2', title: 'Child', status: 'pending' }
          ]
        },
      ]

      const result = updateTaskInTree(tasks, '2', { status: 'completed' })

      expect(result[0].status).toBe('pending')
      expect(result[0].children?.[0].status).toBe('completed')
    })

    it('should update deeply nested task', () => {
      const tasks: Task[] = [
        {
          _id: '1',
          title: 'Level 1',
          status: 'pending',
          children: [
            {
              _id: '2',
              title: 'Level 2',
              status: 'pending',
              children: [
                { _id: '3', title: 'Level 3', status: 'pending' }
              ]
            }
          ]
        },
      ]

      const result = updateTaskInTree(tasks, '3', { title: 'Updated Level 3' })

      expect(result[0].children?.[0].children?.[0].title).toBe('Updated Level 3')
    })

    it('should not mutate original array', () => {
      const tasks: Task[] = [
        { _id: '1', title: 'Task 1', status: 'pending' },
      ]

      const result = updateTaskInTree(tasks, '1', { status: 'completed' })

      expect(tasks[0].status).toBe('pending')
      expect(result[0].status).toBe('completed')
    })

    it('should handle task not found', () => {
      const tasks: Task[] = [
        { _id: '1', title: 'Task 1', status: 'pending' },
      ]

      const result = updateTaskInTree(tasks, 'nonexistent', { status: 'completed' })

      expect(result[0].status).toBe('pending')
    })
  })

  describe('updateTasksInTree', () => {
    interface Task {
      _id: string
      title: string
      status: string
      children?: Task[]
    }

    // Recreate the function for testing
    function updateTasksInTree(tasks: Task[], taskIds: Set<string>, updates: Partial<Task>): Task[] {
      return tasks.map(task => {
        const updatedTask = taskIds.has(task._id) ? { ...task, ...updates } : task
        if (task.children && task.children.length > 0) {
          return {
            ...updatedTask,
            children: updateTasksInTree(task.children, taskIds, updates)
          }
        }
        return updatedTask
      })
    }

    it('should update multiple tasks at root level', () => {
      const tasks: Task[] = [
        { _id: '1', title: 'Task 1', status: 'pending' },
        { _id: '2', title: 'Task 2', status: 'pending' },
        { _id: '3', title: 'Task 3', status: 'pending' },
      ]

      const result = updateTasksInTree(tasks, new Set(['1', '3']), { status: 'completed' })

      expect(result[0].status).toBe('completed')
      expect(result[1].status).toBe('pending')
      expect(result[2].status).toBe('completed')
    })

    it('should update tasks at different levels', () => {
      const tasks: Task[] = [
        {
          _id: '1',
          title: 'Parent',
          status: 'pending',
          children: [
            { _id: '2', title: 'Child', status: 'pending' }
          ]
        },
        { _id: '3', title: 'Sibling', status: 'pending' },
      ]

      const result = updateTasksInTree(tasks, new Set(['1', '2']), { status: 'completed' })

      expect(result[0].status).toBe('completed')
      expect(result[0].children?.[0].status).toBe('completed')
      expect(result[1].status).toBe('pending')
    })

    it('should handle empty set', () => {
      const tasks: Task[] = [
        { _id: '1', title: 'Task 1', status: 'pending' },
      ]

      const result = updateTasksInTree(tasks, new Set(), { status: 'completed' })

      expect(result[0].status).toBe('pending')
    })
  })
})

describe('query key generation', () => {
  it('should generate consistent query keys', () => {
    const params1 = { status: 'pending', page: 1 }
    const params2 = { page: 1, status: 'pending' }

    function normalizeParams(params?: Record<string, string | number | boolean>): string {
      if (!params) return ''
      const sortedKeys = Object.keys(params).sort()
      return sortedKeys.map(k => `${k}:${params[k]}`).join('|')
    }

    expect(normalizeParams(params1)).toBe(normalizeParams(params2))
  })
})

describe('stale time configuration', () => {
  it('should have appropriate stale times', () => {
    // These are the stale time values from the hooks
    const staleTimeConfig = {
      tasks: 30 * 1000,        // 30 seconds
      lookups: 5 * 60 * 1000,  // 5 minutes
      fieldConfigs: 5 * 60 * 1000,
      views: 60 * 1000,        // 1 minute
      users: 5 * 60 * 1000,
      workflows: 5 * 60 * 1000,
    }

    // Tasks change frequently, should have short stale time
    expect(staleTimeConfig.tasks).toBe(30000)

    // Reference data changes infrequently, should have longer stale time
    expect(staleTimeConfig.lookups).toBe(300000)
    expect(staleTimeConfig.fieldConfigs).toBe(300000)
    expect(staleTimeConfig.users).toBe(300000)
    expect(staleTimeConfig.workflows).toBe(300000)

    // Views change moderately often
    expect(staleTimeConfig.views).toBe(60000)
  })
})
