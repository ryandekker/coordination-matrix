// Re-export all path definitions
export { healthPaths, authPaths, apiKeyPaths } from './health-auth.js';
export { taskPaths } from './tasks.js';
export { workflowPaths, workflowRunPaths, batchJobPaths } from './workflows.js';
export { userPaths, viewPaths, webhookPaths, activityLogPaths, lookupPaths, tagPaths, externalJobPaths } from './other.js';
export { documentPaths } from './documents.js';
export { fieldConfigPaths } from './field-configs.js';
export { eventPaths } from './events.js';
export { groupPaths, projectPaths } from './groups.js';

// Combine all paths into a single object
import { healthPaths, authPaths, apiKeyPaths } from './health-auth.js';
import { taskPaths } from './tasks.js';
import { workflowPaths, workflowRunPaths, batchJobPaths } from './workflows.js';
import { userPaths, viewPaths, webhookPaths, activityLogPaths, lookupPaths, tagPaths, externalJobPaths } from './other.js';
import { documentPaths } from './documents.js';
import { fieldConfigPaths } from './field-configs.js';
import { eventPaths } from './events.js';
import { groupPaths, projectPaths } from './groups.js';

export const allPaths = {
  ...healthPaths,
  ...authPaths,
  ...apiKeyPaths,
  ...taskPaths,
  ...workflowPaths,
  ...workflowRunPaths,
  ...batchJobPaths,
  ...userPaths,
  ...groupPaths,
  ...projectPaths,
  ...viewPaths,
  ...webhookPaths,
  ...activityLogPaths,
  ...lookupPaths,
  ...tagPaths,
  ...externalJobPaths,
  ...documentPaths,
  ...fieldConfigPaths,
  ...eventPaths,
};
