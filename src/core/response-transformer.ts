/**
 * Response Transformer - Transform responses after proxying
 * Phase 6: Proxy Logic & Request Forwarding
 * 
 * Features:
 * - Header transformations
 * - Status code mapping
 * - Body transformations
 * - Error response templating
 * - CORS handling
 * - Conditional transformations
 */

import { OutgoingHttpHeaders } from 'http';
import { logger } from '../utils/logger.js';

/**
 * Response header transformation operations
 */
export interface ResponseHeaderTransformations {
  /** Headers to add */
  add?: Record<string, string>;
  /** Header names/patterns to remove */
  remove?: string[];
  /** Headers to rename (old name -> new name) */
  rename?: Record<string, string>;
}

/**
 * Status code mapping
 */
export interface StatusCodeMapping {
  /** Map of status codes: upstream code -> gateway code */
  map: Record<number, number>;
}

/**
 * CORS configuration
 */
export interface CorsConfig {
  /** Enable CORS */
  enabled: boolean;
  /** Allowed origins (* for all) */
  origins: string[];
  /** Allowed methods */
  methods: string[];
  /** Allowed headers */
  allowedHeaders?: string[];
  /** Exposed headers */
  exposedHeaders?: string[];
  /** Allow credentials */
  credentials?: boolean;
  /** Max age in seconds */
  maxAge?: number;
}

/**
 * Error response template
 */
export interface ErrorTemplate {
  /** Status codes this template applies to */
  statusCodes: number[];
  /** Response body template */
  body: string | object;
  /** Additional headers */
  headers?: Record<string, string>;
}

/**
 * Response body transformations
 */
export interface ResponseBodyTransformations {
  /** JSON transformations */
  json?: {
    /** Fields to add/update */
    set?: Record<string, unknown>;
    /** Fields to remove */
    remove?: string[];
    /** Wrap response in a field */
    wrap?: string;
  };
}

/**
 * Conditional transformation rule
 */
export interface ResponseTransformationCondition {
  /** Status code must match */
  statusCode?: number | number[];
  /** Header must match */
  header?: { name: string; value: string | RegExp };
  /** Content-type must match */
  contentType?: string | RegExp;
}

/**
 * Complete response transformation configuration
 */
export interface ResponseTransformation {
  /** Routes this transformation applies to */
  routes?: string[];
  /** Conditions for applying transformation */
  conditions?: ResponseTransformationCondition;
  /** Header transformations */
  headers?: ResponseHeaderTransformations;
  /** Status code mapping */
  statusCodeMap?: Record<number, number>;
  /** Body transformations */
  body?: ResponseBodyTransformations;
  /** CORS configuration */
  cors?: CorsConfig;
  /** Error templates */
  errorTemplates?: ErrorTemplate[];
  /** Priority (higher = applied first) */
  priority?: number;
}

/**
 * Transformation result
 */
export interface ResponseTransformationResult {
  /** Transformed status code */
  statusCode: number;
  /** Transformed headers */
  headers: OutgoingHttpHeaders;
  /** Transformed body (if applicable) */
  body?: Buffer;
  /** Transformation duration in ms */
  duration: number;
}

/**
 * Response Transformer
 */
export class ResponseTransformer {
  private transformations: ResponseTransformation[] = [];

  /**
   * Add transformation rules
   */
  addTransformation(transformation: ResponseTransformation): void {
    this.transformations.push(transformation);
    // Sort by priority (highest first)
    this.transformations.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  /**
   * Set all transformations (replaces existing)
   */
  setTransformations(transformations: ResponseTransformation[]): void {
    this.transformations = [...transformations];
    this.transformations.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  /**
   * Transform a response
   */
  async transform(
    requestPath: string,
    statusCode: number,
    headers: OutgoingHttpHeaders,
    body?: Buffer
  ): Promise<ResponseTransformationResult> {
    const startTime = process.hrtime.bigint();

    // Clone headers to avoid mutation
    let transformedHeaders = { ...headers };
    let transformedStatusCode = statusCode;
    let transformedBody = body;

    // Apply matching transformations in priority order
    for (const transformation of this.transformations) {
      if (!this.shouldApply(transformation, requestPath, transformedStatusCode, transformedHeaders)) {
        continue;
      }

      // Apply status code mapping
      if (transformation.statusCodeMap) {
        const mappedCode = transformation.statusCodeMap[transformedStatusCode];
        if (mappedCode !== undefined) {
          transformedStatusCode = mappedCode;
        }
      }

      // Apply header transformations
      if (transformation.headers) {
        transformedHeaders = this.transformHeaders(transformedHeaders, transformation.headers);
      }

      // Apply CORS headers
      if (transformation.cors && transformation.cors.enabled) {
        transformedHeaders = this.applyCors(transformedHeaders, transformation.cors);
      }

      // Apply error templates
      if (transformation.errorTemplates && transformedStatusCode >= 400) {
        const template = this.findErrorTemplate(transformation.errorTemplates, transformedStatusCode);
        if (template) {
          transformedBody = this.applyErrorTemplate(template);
          if (template.headers) {
            transformedHeaders = { ...transformedHeaders, ...template.headers };
          }
        }
      }

      // Apply body transformations
      if (transformation.body && transformedBody) {
        transformedBody = await this.transformBody(
          transformedBody,
          transformedHeaders,
          transformation.body
        );
      }
    }

    const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;

    return {
      statusCode: transformedStatusCode,
      headers: transformedHeaders,
      body: transformedBody,
      duration,
    };
  }

  /**
   * Check if transformation should be applied
   */
  private shouldApply(
    transformation: ResponseTransformation,
    requestPath: string,
    statusCode: number,
    headers: OutgoingHttpHeaders
  ): boolean {
    // Check route patterns
    if (transformation.routes) {
      const routeMatches = transformation.routes.some((routePattern) => {
        const regex = this.routePatternToRegex(routePattern);
        return regex.test(requestPath);
      });
      if (!routeMatches) return false;
    }

    // Check conditions
    if (transformation.conditions) {
      const { statusCode: statusCondition, header, contentType } = transformation.conditions;

      // Check status code condition
      if (statusCondition !== undefined) {
        const codes = Array.isArray(statusCondition) ? statusCondition : [statusCondition];
        if (!codes.includes(statusCode)) return false;
      }

      // Check header condition
      if (header) {
        const headerValue = headers[header.name.toLowerCase()];
        if (!headerValue) return false;
        const value = Array.isArray(headerValue) ? headerValue[0] : String(headerValue);
        if (typeof header.value === 'string') {
          if (value !== header.value) return false;
        } else if (header.value instanceof RegExp) {
          if (!header.value.test(value || '')) return false;
        }
      }

      // Check content-type condition
      if (contentType) {
        const ctHeader = headers['content-type'];
        if (!ctHeader) return false;
        const ct = Array.isArray(ctHeader) ? ctHeader[0] : String(ctHeader);
        if (typeof contentType === 'string') {
          if (ct && !ct.includes(contentType)) return false;
        } else if (contentType instanceof RegExp) {
          if (ct && !contentType.test(ct)) return false;
        }
      }
    }

    return true;
  }

  /**
   * Transform response headers
   */
  private transformHeaders(
    headers: OutgoingHttpHeaders,
    transformations: ResponseHeaderTransformations
  ): OutgoingHttpHeaders {
    const result = { ...headers };

    // Add headers
    if (transformations.add) {
      for (const [name, value] of Object.entries(transformations.add)) {
        result[name.toLowerCase()] = value;
      }
    }

    // Remove headers
    if (transformations.remove) {
      for (const pattern of transformations.remove) {
        if (pattern.includes('*')) {
          // Wildcard pattern
          const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$', 'i');
          for (const key of Object.keys(result)) {
            if (regex.test(key)) {
              delete result[key];
            }
          }
        } else {
          // Exact match
          delete result[pattern.toLowerCase()];
        }
      }
    }

    // Rename headers
    if (transformations.rename) {
      for (const [oldName, newName] of Object.entries(transformations.rename)) {
        const value = result[oldName.toLowerCase()];
        if (value !== undefined) {
          result[newName.toLowerCase()] = value;
          delete result[oldName.toLowerCase()];
        }
      }
    }

    return result;
  }

  /**
   * Apply CORS headers
   */
  private applyCors(headers: OutgoingHttpHeaders, cors: CorsConfig): OutgoingHttpHeaders {
    const result = { ...headers };

    // Access-Control-Allow-Origin
    if (cors.origins.includes('*')) {
      result['access-control-allow-origin'] = '*';
    } else if (cors.origins.length > 0) {
      result['access-control-allow-origin'] = cors.origins[0];
    }

    // Access-Control-Allow-Methods
    if (cors.methods.length > 0) {
      result['access-control-allow-methods'] = cors.methods.join(', ');
    }

    // Access-Control-Allow-Headers
    if (cors.allowedHeaders && cors.allowedHeaders.length > 0) {
      result['access-control-allow-headers'] = cors.allowedHeaders.join(', ');
    }

    // Access-Control-Expose-Headers
    if (cors.exposedHeaders && cors.exposedHeaders.length > 0) {
      result['access-control-expose-headers'] = cors.exposedHeaders.join(', ');
    }

    // Access-Control-Allow-Credentials
    if (cors.credentials) {
      result['access-control-allow-credentials'] = 'true';
    }

    // Access-Control-Max-Age
    if (cors.maxAge) {
      result['access-control-max-age'] = String(cors.maxAge);
    }

    return result;
  }

  /**
   * Find error template for status code
   */
  private findErrorTemplate(templates: ErrorTemplate[], statusCode: number): ErrorTemplate | null {
    return templates.find((t) => t.statusCodes.includes(statusCode)) || null;
  }

  /**
   * Apply error template
   */
  private applyErrorTemplate(template: ErrorTemplate): Buffer {
    if (typeof template.body === 'string') {
      return Buffer.from(template.body, 'utf-8');
    } else {
      return Buffer.from(JSON.stringify(template.body), 'utf-8');
    }
  }

  /**
   * Transform response body
   */
  private async transformBody(
    body: Buffer,
    headers: OutgoingHttpHeaders,
    transformations: ResponseBodyTransformations
  ): Promise<Buffer> {
    const contentType = headers['content-type'];
    if (!contentType) return body;

    try {
      // JSON transformations
      if (
        transformations.json &&
        (String(contentType).includes('application/json') ||
          String(contentType).includes('application/vnd.api+json'))
      ) {
        let json = JSON.parse(body.toString('utf-8'));

        // Wrap response
        if (transformations.json.wrap) {
          json = { [transformations.json.wrap]: json };
        }

        // Set fields
        if (transformations.json.set) {
          for (const [path, value] of Object.entries(transformations.json.set)) {
            this.setJsonPath(json, path, value);
          }
        }

        // Remove fields
        if (transformations.json.remove) {
          for (const path of transformations.json.remove) {
            this.deleteJsonPath(json, path);
          }
        }

        return Buffer.from(JSON.stringify(json), 'utf-8');
      }
    } catch (error) {
      logger.error(`Response body transformation failed: ${error}`);
      // Return original body on error
      return body;
    }

    return body;
  }

  /**
   * Set value at JSON path
   */
  private setJsonPath(obj: any, path: string, value: unknown): void {
    const parts = path.split('.');
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!part) continue;

      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part];
    }

    const lastPart = parts[parts.length - 1];
    if (lastPart) {
      current[lastPart] = value;
    }
  }

  /**
   * Delete value at JSON path
   */
  private deleteJsonPath(obj: any, path: string): void {
    const parts = path.split('.');
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!part || !(part in current)) {
        return;
      }
      current = current[part];
    }

    const lastPart = parts[parts.length - 1];
    if (lastPart && lastPart in current) {
      delete current[lastPart];
    }
  }

  /**
   * Convert route pattern to regex
   */
  private routePatternToRegex(pattern: string): RegExp {
    // Convert wildcard patterns to regex
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
      .replace(/\*/g, '.*'); // Convert * to .*
    return new RegExp('^' + escaped + '$');
  }

  /**
   * Get transformation statistics
   */
  getStats(): { totalTransformations: number } {
    return {
      totalTransformations: this.transformations.length,
    };
  }

  /**
   * Clear all transformations
   */
  clear(): void {
    this.transformations = [];
  }
}
