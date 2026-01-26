// OpenAPI path definitions for Groups and Projects APIs

export const groupPaths = {
  '/api/groups': {
    get: {
      tags: ['Groups'],
      summary: 'List groups',
      description: 'List groups the current user is a member of. Admins can see all groups with ?all=true',
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
      parameters: [
        {
          name: 'all',
          in: 'query',
          schema: { type: 'boolean' },
          description: 'If true (admin only), return all groups',
        },
      ],
      responses: {
        200: {
          description: 'List of groups',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { type: 'array', items: { $ref: '#/components/schemas/Group' } },
                },
              },
            },
          },
        },
        401: { description: 'Unauthorized' },
      },
    },
    post: {
      tags: ['Groups'],
      summary: 'Create a group',
      description: 'Create a new group. The creator becomes the owner.',
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/GroupCreate' },
          },
        },
      },
      responses: {
        201: {
          description: 'Group created',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { $ref: '#/components/schemas/Group' },
                },
              },
            },
          },
        },
        400: { description: 'Invalid input' },
        401: { description: 'Unauthorized' },
        409: { description: 'Group name already exists' },
      },
    },
  },

  '/api/groups/{id}': {
    get: {
      tags: ['Groups'],
      summary: 'Get group by ID',
      description: 'Get a specific group. Must be a member or admin.',
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { $ref: '#/components/schemas/ObjectId' },
        },
      ],
      responses: {
        200: {
          description: 'Group details',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { $ref: '#/components/schemas/Group' },
                },
              },
            },
          },
        },
        401: { description: 'Unauthorized' },
        403: { description: 'Not a member of this group' },
        404: { description: 'Group not found' },
      },
    },
    patch: {
      tags: ['Groups'],
      summary: 'Update a group',
      description: 'Update group details. Requires admin role in the group.',
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { $ref: '#/components/schemas/ObjectId' },
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/GroupUpdate' },
          },
        },
      },
      responses: {
        200: {
          description: 'Group updated',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { $ref: '#/components/schemas/Group' },
                },
              },
            },
          },
        },
        400: { description: 'Invalid input' },
        401: { description: 'Unauthorized' },
        403: { description: 'Insufficient permissions' },
        404: { description: 'Group not found' },
      },
    },
    delete: {
      tags: ['Groups'],
      summary: 'Delete a group',
      description: 'Delete a group. Only owners can delete groups.',
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { $ref: '#/components/schemas/ObjectId' },
        },
      ],
      responses: {
        200: { description: 'Group deleted' },
        401: { description: 'Unauthorized' },
        403: { description: 'Only group owners can delete groups' },
        404: { description: 'Group not found' },
      },
    },
  },

  '/api/groups/{id}/members': {
    get: {
      tags: ['Groups'],
      summary: 'List group members',
      description: 'Get all members of a group with their roles.',
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { $ref: '#/components/schemas/ObjectId' },
        },
      ],
      responses: {
        200: {
          description: 'List of members',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { type: 'array', items: { $ref: '#/components/schemas/GroupMemberWithUser' } },
                },
              },
            },
          },
        },
        401: { description: 'Unauthorized' },
        403: { description: 'Not a member of this group' },
        404: { description: 'Group not found' },
      },
    },
    post: {
      tags: ['Groups'],
      summary: 'Add a member to group',
      description: 'Add a user to the group. Requires admin role in the group.',
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { $ref: '#/components/schemas/ObjectId' },
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['userId'],
              properties: {
                userId: { type: 'string', description: 'User ID to add' },
                role: { $ref: '#/components/schemas/GroupRole' },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Member added',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { $ref: '#/components/schemas/Group' },
                },
              },
            },
          },
        },
        400: { description: 'Invalid input or user already a member' },
        401: { description: 'Unauthorized' },
        403: { description: 'Insufficient permissions' },
        404: { description: 'Group or user not found' },
      },
    },
  },

  '/api/groups/{id}/members/{userId}': {
    patch: {
      tags: ['Groups'],
      summary: 'Update member role',
      description: 'Change a member\'s role in the group. Admins can modify non-owner roles.',
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { $ref: '#/components/schemas/ObjectId' },
        },
        {
          name: 'userId',
          in: 'path',
          required: true,
          schema: { $ref: '#/components/schemas/ObjectId' },
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['role'],
              properties: {
                role: { $ref: '#/components/schemas/GroupRole' },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Role updated',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { $ref: '#/components/schemas/Group' },
                },
              },
            },
          },
        },
        400: { description: 'Invalid role' },
        401: { description: 'Unauthorized' },
        403: { description: 'Insufficient permissions' },
        404: { description: 'Group or member not found' },
      },
    },
    delete: {
      tags: ['Groups'],
      summary: 'Remove member from group',
      description: 'Remove a user from the group. Admins can remove non-owners.',
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { $ref: '#/components/schemas/ObjectId' },
        },
        {
          name: 'userId',
          in: 'path',
          required: true,
          schema: { $ref: '#/components/schemas/ObjectId' },
        },
      ],
      responses: {
        200: { description: 'Member removed' },
        401: { description: 'Unauthorized' },
        403: { description: 'Insufficient permissions' },
        404: { description: 'Group or member not found' },
      },
    },
  },
};

export const projectPaths = {
  '/api/projects': {
    get: {
      tags: ['Projects'],
      summary: 'List projects',
      description: 'List projects the current user has access to via group membership.',
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
      parameters: [
        {
          name: 'groupId',
          in: 'query',
          schema: { type: 'string' },
          description: 'Filter by group ID',
        },
        {
          name: 'status',
          in: 'query',
          schema: { $ref: '#/components/schemas/ProjectStatus' },
          description: 'Filter by status',
        },
      ],
      responses: {
        200: {
          description: 'List of projects',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { type: 'array', items: { $ref: '#/components/schemas/Project' } },
                },
              },
            },
          },
        },
        401: { description: 'Unauthorized' },
      },
    },
    post: {
      tags: ['Projects'],
      summary: 'Create a project',
      description: 'Create a new project within a group. Requires member role in the group.',
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ProjectCreate' },
          },
        },
      },
      responses: {
        201: {
          description: 'Project created',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { $ref: '#/components/schemas/Project' },
                },
              },
            },
          },
        },
        400: { description: 'Invalid input' },
        401: { description: 'Unauthorized' },
        403: { description: 'Insufficient permissions' },
        409: { description: 'Project name already exists in group' },
      },
    },
  },

  '/api/projects/{id}': {
    get: {
      tags: ['Projects'],
      summary: 'Get project by ID',
      description: 'Get a specific project. Must have access to the parent group.',
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { $ref: '#/components/schemas/ObjectId' },
        },
      ],
      responses: {
        200: {
          description: 'Project details',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { $ref: '#/components/schemas/Project' },
                },
              },
            },
          },
        },
        401: { description: 'Unauthorized' },
        403: { description: 'No access to this project' },
        404: { description: 'Project not found' },
      },
    },
    patch: {
      tags: ['Projects'],
      summary: 'Update a project',
      description: 'Update project details. Requires member role in the group.',
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { $ref: '#/components/schemas/ObjectId' },
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ProjectUpdate' },
          },
        },
      },
      responses: {
        200: {
          description: 'Project updated',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { $ref: '#/components/schemas/Project' },
                },
              },
            },
          },
        },
        400: { description: 'Invalid input' },
        401: { description: 'Unauthorized' },
        403: { description: 'Insufficient permissions' },
        404: { description: 'Project not found' },
      },
    },
    delete: {
      tags: ['Projects'],
      summary: 'Delete a project',
      description: 'Delete a project. Requires admin role in the group.',
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { $ref: '#/components/schemas/ObjectId' },
        },
      ],
      responses: {
        200: { description: 'Project deleted' },
        401: { description: 'Unauthorized' },
        403: { description: 'Insufficient permissions' },
        404: { description: 'Project not found' },
      },
    },
  },
};
