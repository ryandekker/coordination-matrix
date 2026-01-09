import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';
import { securitySchemes, schemas, tags } from './schemas.js';
import { allPaths } from './paths/index.js';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Coordination Matrix API',
      version: '1.0.0',
      description: `
AI Workflow Task Management System API.

## Authentication

Most endpoints require authentication via one of:
- **Bearer Token**: JWT token in \`Authorization: Bearer <token>\` header
- **API Key**: API key in \`X-API-Key: <key>\` header

## Common Response Format

All responses follow this structure:
\`\`\`json
{
  "success": true,
  "data": { ... },
  "pagination": { "page": 1, "limit": 50, "total": 100 }
}
\`\`\`

## Error Responses

\`\`\`json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
\`\`\`
      `,
      contact: {
        name: 'API Support',
      },
    },
    servers: [
      {
        url: 'http://localhost:3001',
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes,
      schemas,
    },
    security: [
      { bearerAuth: [] },
      { apiKeyAuth: [] },
    ],
    tags,
    paths: allPaths,
  },
  apis: [], // We're defining paths inline above
};

const swaggerSpec = swaggerJsdoc(options);

export function setupSwagger(app: Express): void {
  // Serve swagger UI
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Coordination Matrix API',
  }));

  // Serve raw OpenAPI spec
  app.get('/api-docs.json', (_, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  console.log('Swagger UI available at /api-docs');
}

export { swaggerSpec };
