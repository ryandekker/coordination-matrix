// OpenAPI path definitions for Health and Auth endpoints

export const healthPaths = {
  '/health': {
    get: {
      tags: ['Health'],
      summary: 'Health check',
      security: [],
      responses: {
        200: {
          description: 'Server is healthy',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', example: 'healthy' },
                  timestamp: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
      },
    },
  },
};

export const authPaths = {
  '/api/auth/login': {
    post: {
      tags: ['Auth'],
      summary: 'Login with email and password',
      security: [],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email', 'password'],
              properties: {
                email: { type: 'string', format: 'email' },
                password: { type: 'string', minLength: 8 },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Login successful',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' },
                  data: {
                    type: 'object',
                    properties: {
                      token: { type: 'string' },
                      user: { $ref: '#/components/schemas/User' },
                    },
                  },
                },
              },
            },
          },
        },
        401: { description: 'Invalid credentials' },
      },
    },
  },
  '/api/auth/register': {
    post: {
      tags: ['Auth'],
      summary: 'Register a new user',
      security: [],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email', 'password', 'displayName'],
              properties: {
                email: { type: 'string', format: 'email' },
                password: { type: 'string', minLength: 8 },
                displayName: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: 'Registration successful',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' },
                  data: {
                    type: 'object',
                    properties: {
                      token: { type: 'string' },
                      user: { $ref: '#/components/schemas/User' },
                    },
                  },
                },
              },
            },
          },
        },
        400: { description: 'Invalid input or email already exists' },
      },
    },
  },
  '/api/auth/me': {
    get: {
      tags: ['Auth'],
      summary: 'Get current user',
      responses: {
        200: {
          description: 'Current user',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' },
                  data: { $ref: '#/components/schemas/User' },
                },
              },
            },
          },
        },
        401: { description: 'Not authenticated' },
      },
    },
  },
  '/api/auth/status': {
    get: {
      tags: ['Auth'],
      summary: 'Check if initial setup is required',
      security: [],
      responses: {
        200: {
          description: 'Setup status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' },
                  data: {
                    type: 'object',
                    properties: {
                      setupRequired: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

export const apiKeyPaths = {
  '/api/auth/api-keys': {
    get: {
      tags: ['API Keys'],
      summary: 'List API keys',
      parameters: [
        { name: 'userId', in: 'query', schema: { type: 'string' } },
        { name: 'includeInactive', in: 'query', schema: { type: 'boolean' } },
      ],
      responses: {
        200: {
          description: 'List of API keys',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' },
                  data: { type: 'array', items: { $ref: '#/components/schemas/ApiKey' } },
                },
              },
            },
          },
        },
      },
    },
    post: {
      tags: ['API Keys'],
      summary: 'Create a new API key',
      description: 'Returns the full key only once - store it securely',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string', example: 'CLI Tool' },
                description: { type: 'string' },
                scopes: { type: 'array', items: { type: 'string' }, example: ['tasks:read', 'tasks:write'] },
                expiresAt: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: 'API key created - save the key now, it won\'t be shown again',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' },
                  data: {
                    type: 'object',
                    properties: {
                      key: { type: 'string', description: 'Full API key - save this!' },
                      apiKey: { $ref: '#/components/schemas/ApiKey' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
