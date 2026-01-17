// OpenAPI path definitions for Events (SSE) endpoints

export const eventPaths = {
  '/api/events/stream': {
    get: {
      tags: ['Events'],
      summary: 'Server-Sent Events stream',
      description: 'Real-time event stream for task and workflow updates. Clients connect here to receive live updates.',
      responses: {
        200: {
          description: 'SSE connection established',
          content: {
            'text/event-stream': {
              schema: {
                type: 'string',
                description: 'Server-Sent Events stream. Events include: connected, task.created, task.updated, task.deleted, workflow.step_started, workflow.step_completed, workflow.completed, workflow.failed',
              },
            },
          },
        },
      },
    },
  },
  '/api/events/stats': {
    get: {
      tags: ['Events'],
      summary: 'Get SSE statistics',
      description: 'Returns the number of active SSE connections and event bus listeners',
      responses: {
        200: {
          description: 'SSE statistics',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  activeConnections: { type: 'integer', description: 'Number of active SSE connections' },
                  eventBusListeners: { type: 'integer', description: 'Number of event bus listeners' },
                },
              },
            },
          },
        },
      },
    },
  },
};
