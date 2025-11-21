/**
 * JSON Schema definitions for gateway configuration
 * Used by AJV for validation
 */

export const gatewayConfigSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['version', 'environment', 'server'],
  properties: {
    version: {
      type: 'string',
      pattern: '^\\d+\\.\\d+\\.\\d+$',
      description: 'Configuration version (semver)'
    },
    environment: {
      type: 'string',
      enum: ['development', 'staging', 'production'],
      description: 'Deployment environment'
    },
    server: {
      type: 'object',
      required: ['port', 'host'],
      properties: {
        port: {
          type: 'integer',
          minimum: 1,
          maximum: 65535,
          description: 'Server port'
        },
        host: {
          type: 'string',
          description: 'Server host address'
        },
        keepAlive: {
          type: 'boolean',
          default: true,
          description: 'Enable HTTP keep-alive'
        },
        keepAliveTimeout: {
          type: 'integer',
          minimum: 1000,
          default: 65000,
          description: 'Keep-alive timeout in milliseconds'
        },
        requestTimeout: {
          type: 'integer',
          minimum: 100,
          default: 30000,
          description: 'Request timeout in milliseconds'
        },
        maxHeaderSize: {
          type: 'integer',
          minimum: 1024,
          default: 16384,
          description: 'Maximum header size in bytes'
        },
        maxBodySize: {
          type: 'integer',
          minimum: 1024,
          default: 10485760,
          description: 'Maximum request body size in bytes (10MB default)'
        }
      }
    },
    routes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['method', 'path'],
        properties: {
          method: {
            type: 'string',
            enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
            description: 'HTTP method'
          },
          path: {
            type: 'string',
            pattern: '^/',
            description: 'Route path pattern'
          },
          priority: {
            type: 'integer',
            minimum: 0,
            default: 0,
            description: 'Route priority (higher = checked first)'
          }
        }
      },
      default: []
    },
    upstreams: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'protocol', 'host', 'port'],
        properties: {
          id: {
            type: 'string',
            pattern: '^[a-zA-Z0-9_-]+$',
            description: 'Unique upstream identifier'
          },
          protocol: {
            type: 'string',
            enum: ['http', 'https'],
            description: 'Upstream protocol'
          },
          host: {
            type: 'string',
            description: 'Upstream hostname or IP'
          },
          port: {
            type: 'integer',
            minimum: 1,
            maximum: 65535,
            description: 'Upstream port'
          },
          basePath: {
            type: 'string',
            default: '',
            description: 'Base path prefix for upstream'
          },
          poolSize: {
            type: 'integer',
            minimum: 1,
            default: 10,
            description: 'Connection pool size'
          },
          timeout: {
            type: 'integer',
            minimum: 100,
            default: 30000,
            description: 'Request timeout in milliseconds'
          },
          healthCheck: {
            type: 'object',
            properties: {
              enabled: {
                type: 'boolean',
                default: true
              },
              interval: {
                type: 'integer',
                minimum: 1000,
                default: 30000,
                description: 'Health check interval in milliseconds'
              },
              timeout: {
                type: 'integer',
                minimum: 100,
                default: 5000,
                description: 'Health check timeout in milliseconds'
              },
              path: {
                type: 'string',
                default: '/health',
                description: 'Health check endpoint path'
              },
              expectedStatus: {
                type: 'integer',
                minimum: 100,
                maximum: 599,
                default: 200,
                description: 'Expected HTTP status code'
              }
            }
          }
        }
      },
      default: []
    },
    plugins: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'enabled'],
        properties: {
          name: {
            type: 'string',
            pattern: '^[a-zA-Z0-9_-]+$',
            description: 'Plugin name'
          },
          enabled: {
            type: 'boolean',
            description: 'Enable/disable plugin'
          },
          settings: {
            type: 'object',
            description: 'Plugin-specific settings',
            additionalProperties: true
          }
        }
      },
      default: []
    },
    performance: {
      type: 'object',
      properties: {
        workerCount: {
          type: 'integer',
          minimum: 0,
          default: 0,
          description: 'Number of worker threads (0 = CPU count)'
        },
        contextPoolSize: {
          type: 'integer',
          minimum: 10,
          default: 1000,
          description: 'Request context pool size'
        },
        bufferPoolSize: {
          type: 'integer',
          minimum: 10,
          default: 1000,
          description: 'Buffer pool size'
        },
        responsePoolSize: {
          type: 'integer',
          minimum: 10,
          default: 1000,
          description: 'Response pool size'
        },
        enablePooling: {
          type: 'boolean',
          default: true,
          description: 'Enable object pooling'
        }
      },
      default: {
        workerCount: 0,
        contextPoolSize: 1000,
        bufferPoolSize: 1000,
        responsePoolSize: 1000,
        enablePooling: true
      }
    }
  }
};
