// Re-export everything from the workflow execution service
export { workflowExecutionService } from './workflow-execution-service.js';

// Export utilities for use by other services
export { resolveTemplateVariables, getValueByPath, resolveTitleTemplate, getBaseUrl } from './template-utils.js';
export type { TemplateContext } from './template-utils.js';
export { stripUndefined, NULLABLE_ID_FIELDS, OLD_ATLAS_TASK_TYPES } from './mongo-utils.js';
