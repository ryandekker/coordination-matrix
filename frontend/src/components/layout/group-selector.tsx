'use client'

import { useState } from 'react'
import { Building2, FolderKanban, ChevronDown, Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useGroupContext } from '@/lib/group-context'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'

export function GroupSelector() {
  const {
    groups,
    projects,
    currentGroup,
    currentProject,
    setCurrentGroup,
    setCurrentProject,
    isLoadingGroups,
    isLoadingProjects,
  } = useGroupContext()

  const [groupOpen, setGroupOpen] = useState(false)
  const [projectOpen, setProjectOpen] = useState(false)

  return (
    <div className="flex items-center gap-2">
      {/* Group Selector */}
      <Popover open={groupOpen} onOpenChange={setGroupOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={groupOpen}
            className="w-[180px] justify-between"
            disabled={isLoadingGroups}
          >
            <div className="flex items-center gap-2 truncate">
              {isLoadingGroups ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Building2 className="h-4 w-4 shrink-0" />
              )}
              <span className="truncate">
                {currentGroup?.displayName || 'Select group...'}
              </span>
            </div>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[220px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search groups..." />
            <CommandList>
              <CommandEmpty>No groups found.</CommandEmpty>
              <CommandGroup>
                {groups.map((group) => (
                  <CommandItem
                    key={group._id}
                    value={group.displayName}
                    onSelect={() => {
                      setCurrentGroup(group)
                      setGroupOpen(false)
                    }}
                  >
                    <div className="flex items-center gap-2 w-full">
                      <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="truncate">{group.displayName}</span>
                        <span className="text-xs text-muted-foreground truncate">
                          {group.members?.length || 0} members
                        </span>
                      </div>
                      {currentGroup?._id === group._id && (
                        <Check className="h-4 w-4 shrink-0" />
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Project Selector */}
      <Popover open={projectOpen} onOpenChange={setProjectOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={projectOpen}
            className="w-[180px] justify-between"
            disabled={!currentGroup || isLoadingProjects}
          >
            <div className="flex items-center gap-2 truncate">
              {isLoadingProjects ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FolderKanban className="h-4 w-4 shrink-0" />
              )}
              <span className="truncate">
                {currentProject?.displayName || 'All projects'}
              </span>
            </div>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[220px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search projects..." />
            <CommandList>
              <CommandEmpty>No projects found.</CommandEmpty>
              <CommandGroup>
                {/* All projects option */}
                <CommandItem
                  value="all-projects"
                  onSelect={() => {
                    setCurrentProject(null)
                    setProjectOpen(false)
                  }}
                >
                  <div className="flex items-center gap-2 w-full">
                    <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1">All projects</span>
                    {!currentProject && (
                      <Check className="h-4 w-4 shrink-0" />
                    )}
                  </div>
                </CommandItem>

                {projects.length > 0 && <CommandSeparator />}

                {projects.map((project) => (
                  <CommandItem
                    key={project._id}
                    value={project.displayName}
                    onSelect={() => {
                      setCurrentProject(project)
                      setProjectOpen(false)
                    }}
                  >
                    <div className="flex items-center gap-2 w-full">
                      {project.color ? (
                        <div
                          className="h-4 w-4 rounded shrink-0"
                          style={{ backgroundColor: project.color }}
                        />
                      ) : (
                        <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="truncate">{project.displayName}</span>
                        {project.description && (
                          <span className="text-xs text-muted-foreground truncate">
                            {project.description}
                          </span>
                        )}
                      </div>
                      {currentProject?._id === project._id && (
                        <Check className="h-4 w-4 shrink-0" />
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

// Compact version for smaller spaces
export function GroupSelectorCompact() {
  const {
    groups,
    projects,
    currentGroup,
    currentProject,
    setCurrentGroup,
    setCurrentProject,
    isLoadingGroups,
    isLoadingProjects,
  } = useGroupContext()

  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1 px-2"
          disabled={isLoadingGroups}
        >
          {isLoadingGroups ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <>
              <Building2 className="h-3 w-3" />
              <span className="text-xs max-w-[100px] truncate">
                {currentGroup?.displayName || 'Group'}
              </span>
              {currentProject && (
                <>
                  <span className="text-muted-foreground">/</span>
                  <FolderKanban className="h-3 w-3" />
                  <span className="text-xs max-w-[80px] truncate">
                    {currentProject.displayName}
                  </span>
                </>
              )}
            </>
          )}
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search..." />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>

            {/* Groups */}
            <CommandGroup heading="Groups">
              {groups.map((group) => (
                <CommandItem
                  key={group._id}
                  value={`group-${group.displayName}`}
                  onSelect={() => {
                    setCurrentGroup(group)
                    // Don't close - let user also select project if desired
                  }}
                >
                  <div className="flex items-center gap-2 w-full">
                    <Building2 className={cn(
                      "h-4 w-4 shrink-0",
                      currentGroup?._id === group._id ? "text-primary" : "text-muted-foreground"
                    )} />
                    <span className="flex-1 truncate">{group.displayName}</span>
                    {currentGroup?._id === group._id && (
                      <Check className="h-4 w-4 shrink-0 text-primary" />
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>

            {/* Projects (only if group selected) */}
            {currentGroup && projects.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading={`Projects in ${currentGroup.displayName}`}>
                  <CommandItem
                    value="project-all"
                    onSelect={() => {
                      setCurrentProject(null)
                      setOpen(false)
                    }}
                  >
                    <div className="flex items-center gap-2 w-full">
                      <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1">All projects</span>
                      {!currentProject && (
                        <Check className="h-4 w-4 shrink-0 text-primary" />
                      )}
                    </div>
                  </CommandItem>
                  {projects.map((project) => (
                    <CommandItem
                      key={project._id}
                      value={`project-${project.displayName}`}
                      onSelect={() => {
                        setCurrentProject(project)
                        setOpen(false)
                      }}
                    >
                      <div className="flex items-center gap-2 w-full">
                        {project.color ? (
                          <div
                            className="h-4 w-4 rounded shrink-0"
                            style={{ backgroundColor: project.color }}
                          />
                        ) : (
                          <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="flex-1 truncate">{project.displayName}</span>
                        {currentProject?._id === project._id && (
                          <Check className="h-4 w-4 shrink-0 text-primary" />
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
