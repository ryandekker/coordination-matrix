// OpenAPI path definitions for Health and Auth endpoints

export const healthPaths = {
  '/api/health': {
    get: {
      tags: ['Health'],
      summary: 'Health check with deploy version info',
      description: 'Public endpoint (no auth). Returns server status and deployed version. In production, reachable at cm.hcizero.com/api/health.',
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
                  version: {
                    type: 'object',
                    nullable: true,
                    description: 'Build info from deploy pipeline. Null if build-info.json was not generated.',
                    properties: {
                      commitSha: { type: 'string', example: 'a5e5988' },
                      commitFull: { type: 'string', example: 'a5e598852e7fa1d2a9f44b42782dbd9bc3710f09' },
                      commitMessage: { type: 'string', example: 'Fix frontend deploy' },
                      branch: { type: 'string', example: 'main' },
                      buildTimestamp: { type: 'string', format: 'date-time' },
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
  '/api/auth/change-password': {
    post: {
      tags: ['Auth'],
      summary: 'Change password',
      description: 'Change the current user\'s password. Rate limited to 5 attempts per hour per user.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['currentPassword', 'newPassword'],
              properties: {
                currentPassword: { type: 'string', minLength: 1 },
                newPassword: { type: 'string', minLength: 8 },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Password changed successfully' },
        400: { description: 'Invalid input' },
        401: { description: 'Current password is incorrect' },
      },
    },
  },
  '/api/auth/dev-login': {
    post: {
      tags: ['Auth'],
      summary: 'Development-only passwordless login',
      description: 'Login without password. Only available when NODE_ENV !== "production". Rate limited like regular login.',
      security: [],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email'],
              properties: {
                email: { type: 'string', format: 'email' },
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
                  token: { type: 'string' },
                  user: { $ref: '#/components/schemas/User' },
                },
              },
            },
          },
        },
        403: { description: 'Dev login is not available in production' },
        404: { description: 'User not found' },
      },
    },
  },
};

export const apiKeyPaths = {
  '/api/auth/api-keys': {
    get: {
      tags: ['API Keys'],
      summary: 'List API keys',
      description: 'Non-admins can only see their own keys. Admins can see all keys and use filters.',
      parameters: [
        { name: 'createdById', in: 'query', schema: { type: 'string' }, description: 'Filter by who created the key (admin only)' },
        { name: 'actsAsUserId', in: 'query', schema: { type: 'string' }, description: 'Filter by which user the key acts as (admin only)' },
        { name: 'includeInactive', in: 'query', schema: { type: 'boolean' }, description: 'Include revoked/inactive keys' },
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
      description: 'Returns the full key only once - store it securely. Only admins can create keys that act as other users.',
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
                userId: { type: 'string', description: 'User ID this key acts as (admin only)' },
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
        403: { description: 'Only admins can create keys that act as other users' },
      },
    },
  },
  '/api/auth/api-keys/{id}': {
    get: {
      tags: ['API Keys'],
      summary: 'Get a specific API key',
      description: 'Users can only view their own API keys unless they are admin.',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      responses: {
        200: { description: 'API key details (without keyHash)' },
        403: { description: 'You do not have permission to view this API key' },
        404: { description: 'API key not found' },
      },
    },
    patch: {
      tags: ['API Keys'],
      summary: 'Update an API key',
      description: 'Users can only update their own API keys unless they are admin. Only admins can change userId.',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                scopes: { type: 'array', items: { type: 'string' } },
                expiresAt: { type: 'string', format: 'date-time', nullable: true },
                isActive: { type: 'boolean' },
                userId: { type: 'string', nullable: true, description: 'User this key acts as (admin only)' },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'API key updated' },
        403: { description: 'You do not have permission to update this API key' },
        404: { description: 'API key not found' },
      },
    },
    delete: {
      tags: ['API Keys'],
      summary: 'Revoke an API key',
      description: 'Soft-deletes an API key by setting isActive to false. Users can only revoke their own keys unless they are admin.',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      responses: {
        200: { description: 'API key revoked' },
        403: { description: 'You do not have permission to revoke this API key' },
        404: { description: 'API key not found' },
      },
    },
  },
  '/api/auth/api-keys/{id}/regenerate': {
    post: {
      tags: ['API Keys'],
      summary: 'Regenerate an API key',
      description: 'Generates a new key value while keeping the same API key record. Users can only regenerate their own keys unless they are admin.',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/ObjectId' } },
      ],
      responses: {
        200: {
          description: 'API key regenerated - save the new key now',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: {
                    type: 'object',
                    properties: {
                      key: { type: 'string', description: 'New API key - save this!' },
                    },
                  },
                },
              },
            },
          },
        },
        403: { description: 'You do not have permission to regenerate this API key' },
        404: { description: 'API key not found' },
      },
    },
  },
};
