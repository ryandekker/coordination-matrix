// MongoDB Seed Data
// Initial configurations and sample data

db = db.getSiblingDB('coordination_matrix');

// ============================================================================
// LOOKUP TABLES - Status codes, urgency levels, etc.
// ============================================================================

const lookups = [
  // Task statuses
  { type: 'task_status', code: 'pending', displayName: 'Pending', color: '#6B7280', icon: 'clock', sortOrder: 1, isActive: true },
  { type: 'task_status', code: 'in_progress', displayName: 'In Progress', color: '#3B82F6', icon: 'play', sortOrder: 2, isActive: true },
  { type: 'task_status', code: 'waiting', displayName: 'Waiting', color: '#8B5CF6', icon: 'hourglass', sortOrder: 3, isActive: true },
  { type: 'task_status', code: 'on_hold', displayName: 'On Hold', color: '#F59E0B', icon: 'pause', sortOrder: 4, isActive: true },
  { type: 'task_status', code: 'completed', displayName: 'Completed', color: '#10B981', icon: 'check', sortOrder: 5, isActive: true },
  { type: 'task_status', code: 'failed', displayName: 'Failed', color: '#EF4444', icon: 'x-circle', sortOrder: 6, isActive: true },
  { type: 'task_status', code: 'cancelled', displayName: 'Cancelled', color: '#9CA3AF', icon: 'ban', sortOrder: 7, isActive: true },
  { type: 'task_status', code: 'archived', displayName: 'Archived', color: '#64748B', icon: 'archive', sortOrder: 8, isActive: true },

  // Urgency levels
  { type: 'urgency', code: 'low', displayName: 'Low', color: '#6B7280', icon: 'arrow-down', sortOrder: 1, isActive: true },
  { type: 'urgency', code: 'normal', displayName: 'Normal', color: '#3B82F6', icon: 'minus', sortOrder: 2, isActive: true },
  { type: 'urgency', code: 'high', displayName: 'High', color: '#F97316', icon: 'arrow-up', sortOrder: 3, isActive: true },
  { type: 'urgency', code: 'urgent', displayName: 'Urgent', color: '#EF4444', icon: 'alert-triangle', sortOrder: 4, isActive: true },
];

db.lookups.insertMany(lookups);

// ============================================================================
// FIELD CONFIGURATIONS - Define how fields are displayed and edited
// ============================================================================

const fieldConfigs = [
  // Task collection fields
  {
    collectionName: 'tasks',
    fieldPath: 'title',
    displayName: 'Title',
    fieldType: 'text',
    isRequired: true,
    isEditable: true,
    isSearchable: true,
    isSortable: true,
    isFilterable: true,
    displayOrder: 1,
    width: 600,
    minWidth: 300,
    validation: { minLength: 1, maxLength: 500 },
    defaultVisible: true,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'summary',
    displayName: 'Summary',
    fieldType: 'textarea',
    isRequired: false,
    isEditable: true,
    isSearchable: true,
    isSortable: false,
    isFilterable: false,
    displayOrder: 2,
    width: 400,
    defaultVisible: false,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'extraPrompt',
    displayName: 'Extra Prompt',
    fieldType: 'textarea',
    isRequired: false,
    isEditable: true,
    isSearchable: true,
    isSortable: false,
    isFilterable: false,
    displayOrder: 3,
    width: 400,
    defaultVisible: false,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'status',
    displayName: 'Status',
    fieldType: 'select',
    isRequired: true,
    isEditable: true,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 5,
    width: 140,
    lookupType: 'task_status',
    defaultValue: 'pending',
    defaultVisible: true,
    renderAs: 'badge',
  },
  {
    collectionName: 'tasks',
    fieldPath: 'urgency',
    displayName: 'Urgency',
    fieldType: 'select',
    isRequired: false,
    isEditable: true,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 6,
    width: 120,
    lookupType: 'urgency',
    defaultValue: 'normal',
    defaultVisible: true,
    renderAs: 'badge',
  },
  {
    collectionName: 'tasks',
    fieldPath: 'assigneeId',
    displayName: 'Assignee',
    fieldType: 'reference',
    isRequired: false,
    isEditable: true,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 7,
    width: 180,
    referenceCollection: 'users',
    referenceDisplayField: 'displayName',
    defaultVisible: true,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'tags',
    displayName: 'Tags',
    fieldType: 'tags',
    isRequired: false,
    isEditable: true,
    isSearchable: true,
    isSortable: false,
    isFilterable: true,
    displayOrder: 8,
    width: 200,
    defaultVisible: true,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'dueAt',
    displayName: 'Due',
    fieldType: 'datetime',
    isRequired: false,
    isEditable: true,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 9,
    width: 160,
    defaultVisible: true,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'createdAt',
    displayName: 'Created',
    fieldType: 'datetime',
    isRequired: false,
    isEditable: false,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 10,
    width: 160,
    defaultVisible: true,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'updatedAt',
    displayName: 'Updated',
    fieldType: 'datetime',
    isRequired: false,
    isEditable: false,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 11,
    width: 160,
    defaultVisible: false,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'createdById',
    displayName: 'Created By',
    fieldType: 'reference',
    isRequired: false,
    isEditable: false,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 12,
    width: 180,
    referenceCollection: 'users',
    referenceDisplayField: 'displayName',
    defaultVisible: false,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'externalId',
    displayName: 'External ID',
    fieldType: 'text',
    isRequired: false,
    isEditable: true,
    isSearchable: true,
    isSortable: false,
    isFilterable: true,
    displayOrder: 13,
    width: 150,
    defaultVisible: false,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'externalHoldDate',
    displayName: 'External Hold Date',
    fieldType: 'datetime',
    isRequired: false,
    isEditable: true,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 14,
    width: 160,
    defaultVisible: false,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'parentId',
    displayName: 'Parent Task',
    fieldType: 'reference',
    isRequired: false,
    isEditable: true,
    isSearchable: false,
    isSortable: false,
    isFilterable: true,
    displayOrder: 15,
    width: 200,
    referenceCollection: 'tasks',
    referenceDisplayField: 'title',
    defaultVisible: false,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'workflowId',
    displayName: 'Workflow',
    fieldType: 'reference',
    isRequired: false,
    isEditable: true,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 16,
    width: 180,
    referenceCollection: 'workflows',
    referenceDisplayField: 'name',
    defaultVisible: true,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'workflowStage',
    displayName: 'Stage',
    fieldType: 'text',
    isRequired: false,
    isEditable: true,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 17,
    width: 150,
    defaultVisible: true,
  },
];

db.field_configs.insertMany(fieldConfigs);

// ============================================================================
// VIEW FOLDERS
// ============================================================================

const systemFolderId = new ObjectId();

const viewFolders = [
  {
    _id: systemFolderId,
    name: 'System',
    collectionName: 'tasks',
    sortOrder: 0,
    isExpanded: true,
    createdAt: new Date(),
  },
];

db.view_folders.insertMany(viewFolders);

// ============================================================================
// DEFAULT VIEWS
// ============================================================================

const views = [
  {
    name: 'All Tasks',
    collectionName: 'tasks',
    isDefault: true,
    isSystem: true,
    filters: {},
    sorting: [{ field: 'createdAt', direction: 'desc' }],
    visibleColumns: ['title', 'status', 'urgency', 'assigneeId', 'workflowId', 'workflowStage', 'tags', 'dueAt', 'createdAt'],
    folderId: null,  // All Tasks stays at root level (shown as static nav item)
    createdAt: new Date(),
  },
  {
    name: 'My Tasks',
    collectionName: 'tasks',
    isDefault: false,
    isSystem: true,
    filters: { assigneeId: '{{currentUserId}}' },
    sorting: [{ field: 'urgency', direction: 'desc' }, { field: 'dueAt', direction: 'asc' }],
    visibleColumns: ['title', 'status', 'urgency', 'dueAt', 'tags'],
    folderId: systemFolderId,
    createdAt: new Date(),
  },
  {
    name: 'On Hold',
    collectionName: 'tasks',
    isDefault: false,
    isSystem: true,
    filters: { status: ['on_hold'] },
    sorting: [{ field: 'externalHoldDate', direction: 'asc' }],
    visibleColumns: ['title', 'status', 'urgency', 'externalHoldDate', 'externalId', 'assigneeId'],
    folderId: systemFolderId,
    createdAt: new Date(),
  },
  {
    name: 'Urgent Tasks',
    collectionName: 'tasks',
    isDefault: false,
    isSystem: true,
    filters: { urgency: ['high', 'urgent'] },
    sorting: [{ field: 'urgency', direction: 'desc' }, { field: 'createdAt', direction: 'asc' }],
    visibleColumns: ['title', 'status', 'urgency', 'assigneeId', 'dueAt'],
    folderId: systemFolderId,
    createdAt: new Date(),
  },
  {
    name: 'Unassigned',
    collectionName: 'tasks',
    isDefault: false,
    isSystem: true,
    filters: {
      assigneeId: ['__unassigned__'],
      status: ['pending', 'in_progress', 'waiting', 'on_hold']
    },
    sorting: [{ field: 'urgency', direction: 'desc' }, { field: 'createdAt', direction: 'asc' }],
    visibleColumns: ['title', 'status', 'urgency', 'workflowId', 'workflowStage', 'dueAt', 'createdAt'],
    folderId: systemFolderId,
    createdAt: new Date(),
  },
];

db.views.insertMany(views);

// ============================================================================
// SYSTEM USER - Special pseudo-user for system-executed tasks
// This user is assigned to tasks that are executed by the system (webhooks, joins, etc.)
// Using a well-known ObjectId so it can be referenced consistently
// ============================================================================

const SYSTEM_USER_ID = ObjectId('000000000000000000000001');

const systemUser = {
  _id: SYSTEM_USER_ID,
  displayName: 'System',
  role: 'operator',
  isActive: true,
  isSystem: true,
  botColor: '#6B7280',  // Gray - neutral system color
  createdAt: new Date(),
};

db.users.insertOne(systemUser);

// ============================================================================
// SAMPLE USERS
// ============================================================================

const users = [
  {
    email: 'admin@example.com',
    displayName: 'Admin User',
    role: 'admin',
    isActive: true,
    createdAt: new Date(),
  },
  {
    email: 'operator@example.com',
    displayName: 'Alex Operator',
    role: 'operator',
    isActive: true,
    createdAt: new Date(),
  },
  {
    email: 'sarah.chen@example.com',
    displayName: 'Sarah Chen',
    role: 'operator',
    isActive: true,
    createdAt: new Date(),
  },
  {
    email: 'marcus.johnson@example.com',
    displayName: 'Marcus Johnson',
    role: 'reviewer',
    isActive: true,
    createdAt: new Date(),
  },
  {
    email: 'emma.wilson@example.com',
    displayName: 'Emma Wilson',
    role: 'viewer',
    isActive: true,
    createdAt: new Date(),
  },
  // Bot users with custom colors
  {
    displayName: 'Code Reviewer',
    role: 'operator',
    isActive: true,
    isAgent: true,
    agentPrompt: 'You are a code review assistant that analyzes code for quality and best practices.',
    botColor: '#10b981', // Emerald green
    createdAt: new Date(),
  },
  {
    displayName: 'Content Writer',
    role: 'operator',
    isActive: true,
    isAgent: true,
    agentPrompt: 'You are a content writing assistant that helps create engaging content.',
    botColor: '#8b5cf6', // Purple
    createdAt: new Date(),
  },
  {
    displayName: 'Research Assistant',
    role: 'operator',
    isActive: true,
    isAgent: true,
    agentPrompt: 'You are a research assistant that gathers and synthesizes information.',
    botColor: '#f59e0b', // Amber
    createdAt: new Date(),
  },
];

const userResult = db.users.insertMany(users);
const userIds = Object.values(userResult.insertedIds);

// ============================================================================
// GROUPS - Access control groups
// ============================================================================

const defaultGroupId = ObjectId();
const engineeringGroupId = ObjectId();
const marketingGroupId = ObjectId();

const groups = [
  {
    _id: defaultGroupId,
    name: 'default',
    displayName: 'Default',
    description: 'Default organization group with access to all resources',
    visibility: 'internal',
    members: [
      { userId: userIds[0], role: 'owner', addedAt: new Date(), addedById: null },  // Admin
      { userId: userIds[1], role: 'admin', addedAt: new Date(), addedById: userIds[0] },  // Alex Operator
      { userId: userIds[2], role: 'member', addedAt: new Date(), addedById: userIds[0] },  // Sarah Chen
      { userId: userIds[3], role: 'member', addedAt: new Date(), addedById: userIds[0] },  // Marcus Johnson
      { userId: userIds[4], role: 'viewer', addedAt: new Date(), addedById: userIds[0] },  // Emma Wilson
      { userId: userIds[5], role: 'member', addedAt: new Date(), addedById: userIds[0] },  // Code Reviewer bot
      { userId: userIds[6], role: 'member', addedAt: new Date(), addedById: userIds[0] },  // Content Writer bot
      { userId: userIds[7], role: 'member', addedAt: new Date(), addedById: userIds[0] },  // Research Assistant bot
    ],
    createdById: userIds[0],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    _id: engineeringGroupId,
    name: 'engineering',
    displayName: 'Engineering',
    description: 'Engineering team for software development',
    visibility: 'private',
    members: [
      { userId: userIds[0], role: 'owner', addedAt: new Date(), addedById: null },
      { userId: userIds[1], role: 'admin', addedAt: new Date(), addedById: userIds[0] },
      { userId: userIds[2], role: 'member', addedAt: new Date(), addedById: userIds[0] },
      { userId: userIds[5], role: 'member', addedAt: new Date(), addedById: userIds[0] },  // Code Reviewer
    ],
    createdById: userIds[0],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    _id: marketingGroupId,
    name: 'marketing',
    displayName: 'Marketing',
    description: 'Marketing team for campaigns and content',
    visibility: 'private',
    members: [
      { userId: userIds[0], role: 'owner', addedAt: new Date(), addedById: null },
      { userId: userIds[1], role: 'member', addedAt: new Date(), addedById: userIds[0] },
      { userId: userIds[2], role: 'admin', addedAt: new Date(), addedById: userIds[0] },
      { userId: userIds[3], role: 'member', addedAt: new Date(), addedById: userIds[0] },
      { userId: userIds[6], role: 'member', addedAt: new Date(), addedById: userIds[0] },  // Content Writer
    ],
    createdById: userIds[0],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

db.groups.insertMany(groups);

// ============================================================================
// PROJECTS - Organizational units within groups
// ============================================================================

const webAppProjectId = ObjectId();
const apiProjectId = ObjectId();
const q4CampaignProjectId = ObjectId();
const websiteRedesignProjectId = ObjectId();

const projects = [
  {
    _id: webAppProjectId,
    name: 'web-app',
    displayName: 'Web Application',
    description: 'Main web application development',
    groupId: engineeringGroupId,
    status: 'active',
    color: '#3B82F6',  // Blue
    createdById: userIds[0],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    _id: apiProjectId,
    name: 'api',
    displayName: 'API Development',
    description: 'REST and GraphQL API development',
    groupId: engineeringGroupId,
    status: 'active',
    color: '#10B981',  // Green
    createdById: userIds[0],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    _id: q4CampaignProjectId,
    name: 'q4-campaign',
    displayName: 'Q4 Campaign',
    description: 'Q4 2024 marketing campaign',
    groupId: marketingGroupId,
    status: 'active',
    color: '#F59E0B',  // Amber
    createdById: userIds[0],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    _id: websiteRedesignProjectId,
    name: 'website-redesign',
    displayName: 'Website Redesign',
    description: 'Company website redesign project',
    groupId: marketingGroupId,
    status: 'active',
    color: '#8B5CF6',  // Purple
    createdById: userIds[0],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

db.projects.insertMany(projects);

// ============================================================================
// WORKFLOW FOLDERS
// ============================================================================

const workflowFolderContentId = ObjectId();
const workflowFolderEngineeringId = ObjectId();

const workflowFolders = [
  {
    _id: workflowFolderContentId,
    name: 'Content',
    description: 'Content creation and publishing workflows',
    sortOrder: 0,
    isExpanded: true,
    createdById: userIds[0],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    _id: workflowFolderEngineeringId,
    name: 'Engineering',
    description: 'Software development workflows',
    sortOrder: 1,
    isExpanded: true,
    createdById: userIds[0],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

db.workflow_folders.insertMany(workflowFolders);

// ============================================================================
// SAMPLE WORKFLOWS (with folder assignments and pastel colors)
// ============================================================================

// Pastel color palette for workflows
const WORKFLOW_COLORS = {
  sky: '#BAE6FD',       // pastel blue
  lavender: '#DDD6FE', // pastel purple
  rose: '#FECDD3',     // pastel pink
  mint: '#A7F3D0',     // pastel green
  peach: '#FED7AA',    // pastel orange
  coral: '#FECACA',    // pastel red
  lemon: '#FEF08A',    // pastel yellow
  periwinkle: '#C7D2FE', // pastel indigo
  aqua: '#99F6E4',     // pastel teal
  stone: '#D6D3D1',    // pastel gray
};

const workflows = [
  {
    name: 'Content Generation Pipeline',
    description: 'Standard workflow for AI-assisted content generation',
    isActive: true,
    stages: ['Draft', 'Review', 'Approved', 'Published'],
    folderId: workflowFolderContentId,
    color: WORKFLOW_COLORS.sky,
    groupId: marketingGroupId,  // Marketing group owns this workflow
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    name: 'Bug Fix Process',
    description: 'Workflow for tracking and resolving bugs',
    isActive: true,
    stages: ['Reported', 'Investigating', 'Fix in Progress', 'Testing', 'Deployed'],
    folderId: workflowFolderEngineeringId,
    color: WORKFLOW_COLORS.coral,
    groupId: engineeringGroupId,  // Engineering group owns this workflow
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    name: 'Feature Development',
    description: 'Workflow for new feature development',
    isActive: true,
    stages: ['Planning', 'Design', 'Development', 'Code Review', 'QA', 'Released'],
    folderId: workflowFolderEngineeringId,
    color: WORKFLOW_COLORS.mint,
    groupId: engineeringGroupId,  // Engineering group owns this workflow
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const workflowResult = db.workflows.insertMany(workflows);
const workflowIds = Object.values(workflowResult.insertedIds);

// ============================================================================
// SAMPLE TASKS WITH HIERARCHY
// ============================================================================

const now = new Date();
const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

// Root task 1: Q4 Marketing Campaign
const rootTask1Id = ObjectId();
const rootTask1 = {
  _id: rootTask1Id,
  title: 'Q4 Marketing Campaign',
  summary: 'Plan and execute the Q4 marketing campaign including email, social media, and content marketing.',
  extraPrompt: 'Focus on product launches and holiday promotions',
  status: 'in_progress',
  urgency: 'high',
  groupId: marketingGroupId,
  projectId: q4CampaignProjectId,
  parentId: null,
  workflowId: workflowIds[0],
  workflowStage: 'Review',
  externalId: 'MKT-2024-Q4',
  externalHoldDate: null,
  assigneeId: userIds[1],
  createdById: userIds[0],
  tags: ['marketing', 'q4', 'campaign'],
  createdAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
  updatedAt: now,
  dueAt: nextWeek,
};

// Child task 1.1: Email Marketing
const childTask1_1Id = ObjectId();
const childTask1_1 = {
  _id: childTask1_1Id,
  title: 'Email Marketing Campaign',
  summary: 'Create and schedule email campaigns for Q4 promotions',
  extraPrompt: '',
  status: 'in_progress',
  urgency: 'high',
  groupId: marketingGroupId,
  projectId: q4CampaignProjectId,
  parentId: rootTask1Id,
  workflowId: null,
  workflowStage: '',
  externalId: '',
  externalHoldDate: null,
  assigneeId: userIds[2],
  createdById: userIds[1],
  tags: ['email', 'marketing'],
  createdAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
  updatedAt: now,
  dueAt: tomorrow,
};

// Grandchild task 1.1.1: Design email templates
const grandchildTask1_1_1 = {
  _id: ObjectId(),
  title: 'Design Email Templates',
  summary: 'Create responsive email templates for holiday promotions',
  extraPrompt: '',
  status: 'completed',
  urgency: 'normal',
  groupId: marketingGroupId,
  projectId: q4CampaignProjectId,
  parentId: childTask1_1Id,
  workflowId: null,
  workflowStage: '',
  externalId: '',
  externalHoldDate: null,
  assigneeId: userIds[2],
  createdById: userIds[1],
  tags: ['design', 'email'],
  createdAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000),
  updatedAt: yesterday,
  dueAt: yesterday,
};

// Grandchild task 1.1.2: Write email copy
const grandchildTask1_1_2 = {
  _id: ObjectId(),
  title: 'Write Email Copy',
  summary: 'Write compelling email copy for promotional campaigns',
  extraPrompt: 'Use conversational tone, highlight value propositions',
  status: 'in_progress',
  urgency: 'high',
  groupId: marketingGroupId,
  projectId: q4CampaignProjectId,
  parentId: childTask1_1Id,
  workflowId: null,
  workflowStage: '',
  externalId: '',
  externalHoldDate: null,
  assigneeId: userIds[3],
  createdById: userIds[1],
  tags: ['copywriting', 'email'],
  createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
  updatedAt: now,
  dueAt: tomorrow,
};

// Child task 1.2: Social Media Campaign
const childTask1_2Id = ObjectId();
const childTask1_2 = {
  _id: childTask1_2Id,
  title: 'Social Media Campaign',
  summary: 'Plan and execute social media posts across all platforms',
  extraPrompt: '',
  status: 'pending',
  urgency: 'normal',
  groupId: marketingGroupId,
  projectId: q4CampaignProjectId,
  parentId: rootTask1Id,
  workflowId: null,
  workflowStage: '',
  externalId: '',
  externalHoldDate: null,
  assigneeId: userIds[2],
  createdById: userIds[1],
  tags: ['social-media', 'marketing'],
  createdAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
  updatedAt: now,
  dueAt: nextWeek,
};

// Root task 2: Website Redesign
const rootTask2Id = ObjectId();
const rootTask2 = {
  _id: rootTask2Id,
  title: 'Website Redesign Project',
  summary: 'Complete redesign of the company website with new branding',
  extraPrompt: '',
  status: 'on_hold',
  urgency: 'normal',
  groupId: marketingGroupId,
  projectId: websiteRedesignProjectId,
  parentId: null,
  workflowId: workflowIds[2],
  workflowStage: 'Design',
  externalId: 'WEB-2024-001',
  externalHoldDate: nextWeek,
  assigneeId: userIds[1],
  createdById: userIds[0],
  tags: ['website', 'design', 'rebrand'],
  createdAt: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
  updatedAt: now,
  dueAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
};

// Root task 3: Bug fix - Login issues
const rootTask3 = {
  _id: ObjectId(),
  title: 'Fix Login Authentication Bug',
  summary: 'Users reporting intermittent login failures',
  extraPrompt: 'Check session handling and token expiration',
  status: 'in_progress',
  urgency: 'urgent',
  groupId: engineeringGroupId,
  projectId: webAppProjectId,
  parentId: null,
  workflowId: workflowIds[1],
  workflowStage: 'Fix in Progress',
  externalId: 'BUG-789',
  externalHoldDate: null,
  assigneeId: userIds[3],
  createdById: userIds[0],
  tags: ['bug', 'authentication', 'urgent'],
  createdAt: yesterday,
  updatedAt: now,
  dueAt: tomorrow,
};

// Root task 4: Documentation update
const rootTask4 = {
  _id: ObjectId(),
  title: 'Update API Documentation',
  summary: 'Update REST API docs with new endpoints from v2.5 release',
  extraPrompt: '',
  status: 'pending',
  urgency: 'low',
  groupId: engineeringGroupId,
  projectId: apiProjectId,
  parentId: null,
  workflowId: null,
  workflowStage: '',
  externalId: '',
  externalHoldDate: null,
  assigneeId: userIds[4],
  createdById: userIds[0],
  tags: ['documentation', 'api'],
  createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
  updatedAt: now,
  dueAt: nextWeek,
};

// Root task 5: Completed task (default group, no project)
const rootTask5 = {
  _id: ObjectId(),
  title: 'Quarterly Performance Review',
  summary: 'Conduct Q3 performance reviews for the team',
  extraPrompt: '',
  status: 'completed',
  urgency: 'normal',
  groupId: defaultGroupId,
  projectId: null,
  parentId: null,
  workflowId: null,
  workflowStage: '',
  externalId: 'HR-Q3-2024',
  externalHoldDate: null,
  assigneeId: userIds[0],
  createdById: userIds[0],
  tags: ['hr', 'review'],
  createdAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
  updatedAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
  dueAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
};

// Root task 6: Cancelled task (default group, no project)
const rootTask6 = {
  _id: ObjectId(),
  title: 'Legacy System Migration',
  summary: 'Migrate data from legacy CRM to new system',
  extraPrompt: '',
  status: 'cancelled',
  urgency: 'low',
  groupId: defaultGroupId,
  projectId: null,
  parentId: null,
  workflowId: null,
  workflowStage: '',
  externalId: 'MIG-001',
  externalHoldDate: null,
  assigneeId: null,
  createdById: userIds[0],
  tags: ['migration', 'cancelled'],
  createdAt: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000),
  updatedAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
  dueAt: null,
};

// Additional tasks for variety
const additionalTasks = [
  {
    _id: ObjectId(),
    title: 'Implement Dark Mode',
    summary: 'Add dark mode support to the web application',
    extraPrompt: 'Follow system preferences by default',
    status: 'pending',
    urgency: 'low',
    groupId: engineeringGroupId,
    projectId: webAppProjectId,
    parentId: null,
    workflowId: workflowIds[2],
    workflowStage: 'Planning',
    externalId: '',
    externalHoldDate: null,
    assigneeId: userIds[2],
    createdById: userIds[0],
    tags: ['feature', 'ui', 'accessibility'],
    createdAt: now,
    updatedAt: now,
    dueAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
  },
  {
    _id: ObjectId(),
    title: 'Security Audit Review',
    summary: 'Review findings from external security audit',
    extraPrompt: '',
    status: 'in_progress',
    urgency: 'high',
    groupId: engineeringGroupId,
    projectId: webAppProjectId,
    parentId: null,
    workflowId: null,
    workflowStage: '',
    externalId: 'SEC-2024-001',
    externalHoldDate: null,
    assigneeId: userIds[3],
    createdById: userIds[0],
    tags: ['security', 'audit', 'compliance'],
    createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
    updatedAt: now,
    dueAt: tomorrow,
  },
  {
    _id: ObjectId(),
    title: 'Customer Feedback Analysis',
    summary: 'Analyze customer feedback from Q3 surveys',
    extraPrompt: 'Identify top 3 improvement areas',
    status: 'completed',
    urgency: 'normal',
    groupId: marketingGroupId,
    projectId: null,
    parentId: null,
    workflowId: null,
    workflowStage: '',
    externalId: '',
    externalHoldDate: null,
    assigneeId: userIds[4],
    createdById: userIds[1],
    tags: ['research', 'customer-feedback'],
    createdAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
    updatedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
    dueAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
  },
];

db.tasks.insertMany([
  rootTask1,
  childTask1_1,
  grandchildTask1_1_1,
  grandchildTask1_1_2,
  childTask1_2,
  rootTask2,
  rootTask3,
  rootTask4,
  rootTask5,
  rootTask6,
  ...additionalTasks,
]);

// ============================================================================
// BATCH JOB LOOKUPS - Status codes for batch processing
// ============================================================================

const batchJobLookups = [
  // Batch job statuses
  { type: 'batch_job_status', code: 'pending', displayName: 'Pending', color: '#6B7280', icon: 'clock', sortOrder: 1, isActive: true },
  { type: 'batch_job_status', code: 'processing', displayName: 'Processing', color: '#3B82F6', icon: 'loader', sortOrder: 2, isActive: true },
  { type: 'batch_job_status', code: 'awaiting_responses', displayName: 'Awaiting Responses', color: '#8B5CF6', icon: 'inbox', sortOrder: 3, isActive: true },
  { type: 'batch_job_status', code: 'completed', displayName: 'Completed', color: '#10B981', icon: 'check-circle', sortOrder: 4, isActive: true },
  { type: 'batch_job_status', code: 'completed_with_warnings', displayName: 'Completed with Warnings', color: '#F59E0B', icon: 'alert-triangle', sortOrder: 5, isActive: true },
  { type: 'batch_job_status', code: 'failed', displayName: 'Failed', color: '#EF4444', icon: 'x-circle', sortOrder: 6, isActive: true },
  { type: 'batch_job_status', code: 'cancelled', displayName: 'Cancelled', color: '#9CA3AF', icon: 'ban', sortOrder: 7, isActive: true },
  { type: 'batch_job_status', code: 'manual_review', displayName: 'Manual Review', color: '#EC4899', icon: 'user-check', sortOrder: 8, isActive: true },

  // Batch item statuses
  { type: 'batch_item_status', code: 'pending', displayName: 'Pending', color: '#6B7280', icon: 'clock', sortOrder: 1, isActive: true },
  { type: 'batch_item_status', code: 'received', displayName: 'Received', color: '#3B82F6', icon: 'inbox', sortOrder: 2, isActive: true },
  { type: 'batch_item_status', code: 'processing', displayName: 'Processing', color: '#8B5CF6', icon: 'loader', sortOrder: 3, isActive: true },
  { type: 'batch_item_status', code: 'completed', displayName: 'Completed', color: '#10B981', icon: 'check', sortOrder: 4, isActive: true },
  { type: 'batch_item_status', code: 'failed', displayName: 'Failed', color: '#EF4444', icon: 'x', sortOrder: 5, isActive: true },
  { type: 'batch_item_status', code: 'skipped', displayName: 'Skipped', color: '#9CA3AF', icon: 'skip-forward', sortOrder: 6, isActive: true },

  // Review decisions
  { type: 'review_decision', code: 'approved', displayName: 'Approved', color: '#10B981', icon: 'check', sortOrder: 1, isActive: true },
  { type: 'review_decision', code: 'rejected', displayName: 'Rejected', color: '#EF4444', icon: 'x', sortOrder: 2, isActive: true },
  { type: 'review_decision', code: 'proceed_with_partial', displayName: 'Proceed with Partial', color: '#F59E0B', icon: 'alert-circle', sortOrder: 3, isActive: true },
];

db.lookups.insertMany(batchJobLookups);

// ============================================================================
// SAMPLE BATCH JOBS - Example batch processing scenarios
// ============================================================================

// Example 1: Completed email analysis batch
const batchJob1Id = ObjectId();
const batchJob1 = {
  _id: batchJob1Id,
  name: 'Email Sentiment Analysis - October 2024',
  type: 'email_analysis',
  workflowId: null,
  workflowStepId: null,
  taskId: null,
  callbackUrl: 'http://localhost:3001/api/batch-jobs/' + batchJob1Id.toString() + '/callback',
  callbackSecret: 'whsec_example_secret_for_demo_purposes_only',
  status: 'completed',
  expectedCount: 100,
  receivedCount: 100,
  processedCount: 97,
  failedCount: 3,
  minSuccessPercent: 90,
  deadlineAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
  inputPayload: {
    sourceFolder: 'inbox/october',
    analysisType: 'sentiment',
    categories: ['positive', 'negative', 'neutral', 'urgent']
  },
  aggregateResult: {
    totalItems: 100,
    successfulCount: 97,
    failedCount: 3,
    successRate: 97,
    results: [
      { itemKey: 'email_001', externalId: 'msg_abc123', data: { sentiment: 'positive', confidence: 0.92 } },
      { itemKey: 'email_002', externalId: 'msg_def456', data: { sentiment: 'neutral', confidence: 0.78 } }
    ],
    errors: [
      { itemKey: 'email_098', externalId: 'msg_xyz999', error: 'Content too short for analysis' }
    ],
    aggregatedAt: new Date(now.getTime() - 23 * 60 * 60 * 1000)
  },
  isResultSealed: true,
  requiresManualReview: false,
  createdById: userIds[0],
  createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
  updatedAt: new Date(now.getTime() - 23 * 60 * 60 * 1000),
  startedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000 + 60000),
  completedAt: new Date(now.getTime() - 23 * 60 * 60 * 1000)
};

// Example 2: In-progress batch job
const batchJob2Id = ObjectId();
const batchJob2 = {
  _id: batchJob2Id,
  name: 'Document Classification Batch',
  type: 'document_classification',
  workflowId: workflowIds[0],
  workflowStepId: 'foreach_classify',
  taskId: rootTask1Id,
  callbackUrl: 'http://localhost:3001/api/batch-jobs/' + batchJob2Id.toString() + '/callback',
  callbackSecret: 'whsec_' + ObjectId().toString(),
  status: 'awaiting_responses',
  expectedCount: 50,
  receivedCount: 32,
  processedCount: 30,
  failedCount: 2,
  minSuccessPercent: 80,
  deadlineAt: new Date(now.getTime() + 2 * 60 * 60 * 1000),
  inputPayload: {
    documentSource: 's3://documents/incoming',
    classificationModel: 'gpt-4-classification',
    outputFormat: 'json'
  },
  aggregateResult: null,
  isResultSealed: false,
  requiresManualReview: false,
  createdById: userIds[1],
  createdAt: new Date(now.getTime() - 60 * 60 * 1000),
  updatedAt: now,
  startedAt: new Date(now.getTime() - 55 * 60 * 1000),
  completedAt: null
};

// Example 3: Batch job requiring manual review
const batchJob3Id = ObjectId();
const batchJob3 = {
  _id: batchJob3Id,
  name: 'Customer Data Validation',
  type: 'data_validation',
  workflowId: null,
  workflowStepId: null,
  taskId: null,
  callbackUrl: 'http://localhost:3001/api/batch-jobs/' + batchJob3Id.toString() + '/callback',
  callbackSecret: 'whsec_' + ObjectId().toString(),
  status: 'manual_review',
  expectedCount: 200,
  receivedCount: 200,
  processedCount: 140,
  failedCount: 60,
  minSuccessPercent: 95,
  deadlineAt: new Date(now.getTime() - 1 * 60 * 60 * 1000),
  inputPayload: {
    dataSource: 'customer_database',
    validationRules: ['email_format', 'phone_format', 'address_complete']
  },
  aggregateResult: {
    totalItems: 200,
    successfulCount: 140,
    failedCount: 60,
    successRate: 70,
    results: [],
    errors: [
      { itemKey: 'cust_001', error: 'Invalid email format' },
      { itemKey: 'cust_015', error: 'Missing phone number' }
    ],
    aggregatedAt: now
  },
  isResultSealed: false,
  requiresManualReview: true,
  createdById: userIds[0],
  createdAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
  updatedAt: now,
  startedAt: new Date(now.getTime() - 2.5 * 60 * 60 * 1000),
  completedAt: null
};

db.batch_jobs.insertMany([batchJob1, batchJob2, batchJob3]);

// Sample batch items for the in-progress batch job
const batchItems = [];
for (let i = 1; i <= 32; i++) {
  batchItems.push({
    batchJobId: batchJob2Id,
    itemKey: 'doc_' + String(i).padStart(3, '0'),
    externalId: 'file_' + ObjectId().toString().substring(0, 8),
    status: i <= 30 ? 'completed' : 'failed',
    inputData: {
      filename: 'document_' + i + '.pdf',
      size: Math.floor(Math.random() * 1000000) + 10000
    },
    resultData: i <= 30 ? {
      classification: ['invoice', 'contract', 'report', 'memo'][Math.floor(Math.random() * 4)],
      confidence: 0.7 + Math.random() * 0.3
    } : null,
    error: i > 30 ? 'Unable to parse document format' : null,
    attempts: 1,
    createdAt: new Date(now.getTime() - 55 * 60 * 1000),
    receivedAt: new Date(now.getTime() - (55 - i) * 60 * 1000),
    completedAt: new Date(now.getTime() - (54 - i) * 60 * 1000)
  });
}

db.batch_items.insertMany(batchItems);

// ============================================================================
// TAGS - Predefined tags with colors
// ============================================================================

const tags = [
  // Category tags
  { name: 'marketing', displayName: 'Marketing', color: '#8B5CF6', description: 'Marketing related tasks', isActive: true, createdAt: new Date() },
  { name: 'design', displayName: 'Design', color: '#EC4899', description: 'Design and UI/UX tasks', isActive: true, createdAt: new Date() },
  { name: 'feature', displayName: 'Feature', color: '#10B981', description: 'New feature development', isActive: true, createdAt: new Date() },
  { name: 'bug', displayName: 'Bug', color: '#EF4444', description: 'Bug fixes and issues', isActive: true, createdAt: new Date() },
  { name: 'documentation', displayName: 'Documentation', color: '#6366F1', description: 'Documentation tasks', isActive: true, createdAt: new Date() },
  { name: 'security', displayName: 'Security', color: '#F97316', description: 'Security related tasks', isActive: true, createdAt: new Date() },

  // Priority/status tags
  { name: 'urgent', displayName: 'Urgent', color: '#DC2626', description: 'Urgent priority items', isActive: true, createdAt: new Date() },
  { name: 'blocked', displayName: 'Blocked', color: '#9CA3AF', description: 'Blocked by dependencies', isActive: true, createdAt: new Date() },

  // Department tags
  { name: 'hr', displayName: 'HR', color: '#14B8A6', description: 'Human resources tasks', isActive: true, createdAt: new Date() },
  { name: 'research', displayName: 'Research', color: '#0EA5E9', description: 'Research tasks', isActive: true, createdAt: new Date() },

  // Type tags
  { name: 'email', displayName: 'Email', color: '#A855F7', description: 'Email related tasks', isActive: true, createdAt: new Date() },
  { name: 'social-media', displayName: 'Social Media', color: '#3B82F6', description: 'Social media tasks', isActive: true, createdAt: new Date() },
  { name: 'api', displayName: 'API', color: '#22C55E', description: 'API development tasks', isActive: true, createdAt: new Date() },
  { name: 'ui', displayName: 'UI', color: '#F472B6', description: 'User interface tasks', isActive: true, createdAt: new Date() },

  // Process tags
  { name: 'campaign', displayName: 'Campaign', color: '#FBBF24', description: 'Campaign tasks', isActive: true, createdAt: new Date() },
  { name: 'q4', displayName: 'Q4', color: '#84CC16', description: 'Q4 tasks', isActive: true, createdAt: new Date() },
  { name: 'review', displayName: 'Review', color: '#06B6D4', description: 'Review tasks', isActive: true, createdAt: new Date() },
  { name: 'audit', displayName: 'Audit', color: '#F59E0B', description: 'Audit tasks', isActive: true, createdAt: new Date() },
  { name: 'compliance', displayName: 'Compliance', color: '#64748B', description: 'Compliance tasks', isActive: true, createdAt: new Date() },

  // Technical tags
  { name: 'website', displayName: 'Website', color: '#7C3AED', description: 'Website tasks', isActive: true, createdAt: new Date() },
  { name: 'rebrand', displayName: 'Rebrand', color: '#BE185D', description: 'Rebranding tasks', isActive: true, createdAt: new Date() },
  { name: 'authentication', displayName: 'Authentication', color: '#B91C1C', description: 'Authentication tasks', isActive: true, createdAt: new Date() },
  { name: 'copywriting', displayName: 'Copywriting', color: '#7DD3FC', description: 'Copywriting tasks', isActive: true, createdAt: new Date() },
  { name: 'accessibility', displayName: 'Accessibility', color: '#34D399', description: 'Accessibility tasks', isActive: true, createdAt: new Date() },
  { name: 'customer-feedback', displayName: 'Customer Feedback', color: '#FB923C', description: 'Customer feedback tasks', isActive: true, createdAt: new Date() },
  { name: 'migration', displayName: 'Migration', color: '#A78BFA', description: 'Migration tasks', isActive: true, createdAt: new Date() },
  { name: 'cancelled', displayName: 'Cancelled', color: '#9CA3AF', description: 'Cancelled items', isActive: true, createdAt: new Date() },
];

db.tags.insertMany(tags);

// ============================================================================
// DOCUMENTS - Example documentation and SOPs
// ============================================================================

const documents = [
  {
    title: 'Social Media Posting Guidelines',
    groupId: marketingGroupId,
    projectId: null,
    content: `# Social Media Posting Guidelines

## Overview
This document outlines the standards and best practices for all social media content published on behalf of the organization.

## Content Standards

### Voice and Tone
- Professional yet approachable
- Avoid jargon unless speaking to technical audiences
- Use active voice
- Be concise and clear

### Visual Guidelines
- Use approved brand colors only
- Minimum image resolution: 1200x630px
- Include alt text for all images
- Videos should include captions

### Approval Workflow
1. Draft content is created
2. Content reviewed by marketing lead
3. Legal review for campaigns over $5k
4. Final approval by department head
5. Schedule or publish

## Platform-Specific Guidelines

### LinkedIn
- Professional tone
- Industry insights and thought leadership
- Company updates and milestones
- Best posting times: 8-10am, 12pm, 5-6pm

### Twitter/X
- More casual, conversational
- Quick updates and engagement
- Trending topic participation (when appropriate)
- Best posting times: 9am, 12pm, 3pm

### Instagram
- Visual-first approach
- Behind-the-scenes content
- User-generated content (with permission)
- Best posting times: 11am-1pm, 7-9pm

## Hashtag Policy
- Use 3-5 relevant hashtags per post
- Maintain list of approved brand hashtags
- Research trending hashtags before using

## Crisis Communication
- All communications during a crisis must go through PR
- Do not respond to negative comments without approval
- Escalate potential issues immediately
`,
    summary: 'Guidelines for creating and publishing social media content across all platforms',
    type: 'sop',
    status: 'approved',
    tags: ['social-media', 'marketing', 'guidelines'],
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    title: 'Q4 2024 Content Strategy',
    groupId: marketingGroupId,
    projectId: q4CampaignProjectId,
    content: `# Q4 2024 Content Strategy

## Executive Summary
This document outlines our content strategy for Q4 2024, focusing on product launches, holiday campaigns, and year-end engagement.

## Strategic Goals
1. Increase social media engagement by 25%
2. Launch 3 new product awareness campaigns
3. Drive holiday season conversions
4. Build year-end thought leadership content

## Content Pillars

### 1. Product Education
- Feature deep-dives
- How-to content
- Customer success stories

### 2. Industry Leadership
- Market trend analysis
- Expert interviews
- Research reports

### 3. Community Building
- User-generated content
- Interactive polls and Q&As
- Behind-the-scenes content

## Campaign Calendar

### October
- Week 1-2: Product launch campaign
- Week 3-4: Industry event coverage

### November
- Week 1-2: Customer appreciation
- Week 3-4: Pre-holiday prep content

### December
- Week 1-2: Holiday campaign
- Week 3-4: Year in review series

## KPIs and Metrics
| Metric | Target | Current |
|--------|--------|---------|
| Engagement Rate | 4.5% | 3.2% |
| Follower Growth | +15% | - |
| Lead Generation | 500 | - |
| Content Pieces | 60 | - |

## Resources Required
- 2 content writers
- 1 designer
- Paid media budget: $25,000
- Influencer partnerships: 3
`,
    summary: 'Strategic content plan for Q4 2024 including campaigns, goals, and resource allocation',
    type: 'strategy',
    status: 'approved',
    tags: ['marketing', 'q4', 'strategy'],
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    title: 'Content Approval Workflow Template',
    groupId: marketingGroupId,
    projectId: null,
    content: `# Content Approval Workflow

## Template Variables
- **Content Type**: [Blog/Social/Email/Video]
- **Campaign**: [Campaign Name]
- **Target Publish Date**: [Date]
- **Author**: [Name]

## Checklist

### Pre-Submission
- [ ] Content aligns with brand guidelines
- [ ] Spelling and grammar checked
- [ ] Links verified
- [ ] Images have alt text
- [ ] Legal disclaimers included (if applicable)

### Review Stages

#### Stage 1: Editorial Review
Reviewer: Marketing Lead
Timeline: 2 business days
- [ ] Messaging accuracy
- [ ] Tone and voice
- [ ] SEO optimization
- [ ] Call-to-action clarity

#### Stage 2: Brand Review
Reviewer: Brand Manager
Timeline: 1 business day
- [ ] Visual brand compliance
- [ ] Logo usage
- [ ] Color palette
- [ ] Typography

#### Stage 3: Legal Review (if required)
Reviewer: Legal Team
Timeline: 3 business days
- [ ] Compliance statements
- [ ] Trademark usage
- [ ] Claims verification
- [ ] Disclosure requirements

### Final Approval
- [ ] All stages complete
- [ ] Final proofread
- [ ] Scheduled or published

## Notes
[Add any additional notes or context here]
`,
    summary: 'Template for content approval workflows with checklists and review stages',
    type: 'template',
    status: 'approved',
    tags: ['marketing', 'workflow', 'template'],
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    title: 'Brand Voice Reference Guide',
    groupId: marketingGroupId,
    projectId: null,
    content: `# Brand Voice Reference Guide

## Our Brand Personality
We are **knowledgeable**, **approachable**, and **innovative**.

## Voice Characteristics

### 1. Expert but Accessible
**Do:** Explain complex topics in simple terms
**Don't:** Use jargon without explanation

*Example:*
- ✅ "Our AI helps you find the right customers faster"
- ❌ "Our ML-powered propensity model optimizes CAC through predictive analytics"

### 2. Confident but Not Arrogant
**Do:** State benefits clearly
**Don't:** Make unsubstantiated claims

*Example:*
- ✅ "Teams using our platform report 40% time savings"
- ❌ "We're the best solution on the market"

### 3. Friendly but Professional
**Do:** Use conversational language
**Don't:** Be overly casual or use slang

*Example:*
- ✅ "Need help? We're here for you."
- ❌ "Yo, hit us up if you need anything!"

## Tone Variations by Context

| Context | Tone | Example |
|---------|------|---------|
| Marketing | Enthusiastic, inspiring | "Transform your workflow today" |
| Support | Empathetic, helpful | "We understand this is frustrating" |
| Technical | Clear, precise | "Follow these steps to configure..." |
| Crisis | Calm, transparent | "We're aware of the issue and working on it" |

## Words We Use
- Transform
- Streamline
- Empower
- Collaborate
- Innovate

## Words We Avoid
- Revolutionary (overused)
- Synergy (corporate jargon)
- Disrupt (cliché)
- Guru/Ninja (dated)
`,
    summary: 'Reference guide for maintaining consistent brand voice across all communications',
    type: 'reference',
    status: 'approved',
    tags: ['marketing', 'brand', 'guidelines'],
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    title: 'Email Campaign Checklist',
    groupId: marketingGroupId,
    projectId: q4CampaignProjectId,
    content: `# Email Campaign Checklist

## Pre-Send Checklist

### Content
- [ ] Subject line is compelling (under 50 characters)
- [ ] Preview text is set
- [ ] Personalization tokens work correctly
- [ ] All links are tracked and working
- [ ] Unsubscribe link is present
- [ ] Physical address included (CAN-SPAM)
- [ ] Images have alt text
- [ ] Plain text version created

### Design
- [ ] Mobile responsive
- [ ] Tested on major email clients (Gmail, Outlook, Apple Mail)
- [ ] Brand colors and fonts used
- [ ] Clear call-to-action button
- [ ] Loading time under 3 seconds

### Targeting
- [ ] Correct audience segment selected
- [ ] Exclusions applied (recent purchasers, etc.)
- [ ] Suppression lists checked
- [ ] Send time optimized

### Testing
- [ ] Seed list test sent
- [ ] Spam score checked (under 5.0)
- [ ] A/B test configured (if applicable)
- [ ] Analytics tracking verified

### Approvals
- [ ] Copy approved by marketing
- [ ] Design approved by brand
- [ ] Legal review complete (if promotional)
- [ ] Final sign-off received

## Post-Send
- [ ] Monitor delivery rates
- [ ] Check for bounce issues
- [ ] Track initial opens/clicks
- [ ] Document learnings
`,
    summary: 'Comprehensive checklist for email campaign preparation and launch',
    type: 'sop',
    status: 'approved',
    tags: ['email', 'marketing', 'checklist'],
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

db.documents.insertMany(documents);

// Create version records for each document
const insertedDocs = db.documents.find().toArray();
const versions = insertedDocs.map(doc => ({
  documentId: doc._id,
  version: 1,
  title: doc.title,
  content: doc.content,
  summary: doc.summary,
  changeDescription: 'Initial version',
  modifiedById: null,
  modifiedAt: doc.createdAt
}));

if (versions.length > 0) {
  db.document_versions.insertMany(versions);
}

// ============================================================================
// CAPABILITY DOCUMENTS - On-demand documentation for daemon agents
//
// Source of truth: docs/capabilities/*.md
// These seed entries provide minimal content for local development.
// Run `node scripts/migrate-capabilities.mjs` to deploy full content
// from the codebase files to any environment.
// ============================================================================

const capabilityDocuments = [
  {
    title: 'Ask Questions',
    capabilityId: 'ask-questions',
    capabilityComplexity: 1,
    type: 'capability',
    status: 'approved',
    tags: ['capability', 'questions', 'human-input'],
    summary: 'Ask structured questions to humans when you need input to proceed.',
    content: '# Ask Questions\n\nUse `nextAction: "ASK"` with a `questions` array to ask humans for input.\nSupported types: text, choice, multiselect, confirm, number.\n\nRun migrate-capabilities.mjs for full documentation.',
    version: 1,
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    title: 'Document Operations',
    capabilityId: 'document-operations',
    capabilityComplexity: 2,
    type: 'capability',
    status: 'approved',
    tags: ['capability', 'documents', 'storage'],
    summary: 'Create, update, and search documents in the document store.',
    content: '# Document Operations\n\nInclude a `documentOperations` array in your response.\nSupported actions: create, update, search.\n\nRun migrate-capabilities.mjs for full documentation.',
    version: 1,
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    title: 'Delegation Patterns',
    capabilityId: 'delegation-patterns',
    capabilityComplexity: 3,
    type: 'capability',
    status: 'approved',
    tags: ['capability', 'delegation', 'advanced', 'escalation'],
    summary: 'Patterns for task continuation, escalation, and workflow recommendations.',
    content: '# Delegation Patterns\n\nActions: COMPLETE, CONTINUE (follow-up task), ESCALATE (human review), HOLD (wait).\nIn workflows, follow the workflow structure. Ad-hoc tasks have more autonomy.\n\nRun migrate-capabilities.mjs for full documentation.',
    version: 1,
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    title: 'Create Workflow',
    capabilityId: 'create-workflow',
    capabilityComplexity: 3,
    type: 'capability',
    status: 'approved',
    tags: ['capability', 'workflow', 'creation', 'advanced'],
    summary: 'Create and import workflow definitions via the API.',
    content: '# Create Workflow\n\nCreate workflows by posting JSON to the workflows API.\nStep types: trigger, agent, manual, external, webhook, decision, foreach, join, flow, code, findDocument.\n\nRun migrate-capabilities.mjs for full documentation.',
    version: 1,
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

db.documents.insertMany(capabilityDocuments);

// Create version records for capability documents
const insertedCapDocs = db.documents.find({ type: 'capability' }).toArray();
const capVersions = insertedCapDocs.map(doc => ({
  documentId: doc._id,
  version: 1,
  title: doc.title,
  content: doc.content,
  summary: doc.summary,
  changeDescription: 'Initial version',
  modifiedById: null,
  modifiedAt: doc.createdAt
}));

if (capVersions.length > 0) {
  db.document_versions.insertMany(capVersions);
}

print('Capability documents inserted: ' + capabilityDocuments.length);

print('Seed data inserted successfully!');
