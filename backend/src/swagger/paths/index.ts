// Re-export all path definitions
export { healthPaths, authPaths, apiKeyPaths } from './health-auth.js';
export { taskPaths } from './tasks.js';
export { workflowPaths, workflowRunPaths, batchJobPaths } from './workflows.js';
export { userPaths, viewPaths, webhookPaths, activityLogPaths, lookupPaths, tagPaths, externalJobPaths } from './other.js';
export { documentPaths } from './documents.js';

// Combine all paths into a single object
import { healthPaths, authPaths, apiKeyPaths } from './health-auth.js';
import { taskPaths } from './tasks.js';
import { workflowPaths, workflowRunPaths, batchJobPaths } from './workflows.js';
import { userPaths, viewPaths, webhookPaths, activityLogPaths, lookupPaths, tagPaths, externalJobPaths } from './other.js';
import { documentPaths } from './documents.js';

export const allPaths = {
  ...healthPaths,
  ...authPaths,
  ...apiKeyPaths,
  ...taskPaths,
  ...workflowPaths,
  ...workflowRunPaths,
  ...batchJobPaths,
  ...userPaths,
  ...viewPaths,
  ...webhookPaths,
  ...activityLogPaths,
  ...lookupPaths,
  ...tagPaths,
  ...externalJobPaths,
  ...documentPaths,
};
