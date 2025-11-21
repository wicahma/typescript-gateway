/**
 * Request Transformer - Transform requests before proxying
 * Phase 6: Proxy Logic & Request Forwarding
 * 
 * Features:
 * - Header transformations (add, remove, rename, modify)
 * - Query parameter transformations
 * - Path rewriting with pattern matching
 * - Body transformations (JSON/form-data)
 * - Conditional transformations
 * - Transformation chains
 */

import { IncomingHttpHeaders } from 'http';
import { URL } from 'url';
import { logger } from '../utils/logger.js';

/**
 * Header transformation operations
 */
export interface HeaderTransformations {
  /** Headers to add */
  add?: Record<string, string>;
  /** Header names/patterns to remove */
  remove?: string[];
  /** Headers to rename (old name -> new name) */
  rename?: Record<string, string>;
  /** Headers to modify with string replacement */
  modify?: Record<string, { pattern: string | RegExp; replacement: string }>;
}

/**
 * Query parameter transformation operations
 */
export interface QueryTransformations {
  /** Query params to add */
  add?: Record<string, string>;
  /** Query param names to remove */
  remove?: string[];
  /** Query params to modify */
  modify?: Record<string, string>;
}

/**
 * Path rewrite rule
 */
export interface PathRewriteRule {
  /** Pattern to match (string or regex) */
  pattern: string | RegExp;
  /** Replacement string */
  replacement: string;
}

/**
 * Body transformation operations
 */
export interface BodyTransformations {
  /** JSON path transformations */
  json?: {
    /** Fields to add/update */
    set?: Record<string, unknown>;
    /** Fields to remove */
    remove?: string[];
  };
  /** Form data transformations */
  formData?: {
    /** Fields to add/update */
    set?: Record<string, string>;
    /** Fields to remove */
    remove?: string[];
  };
}

/**
 * Conditional transformation rule
 */
export interface TransformationCondition {
  /** Header must match */
  header?: { name: string; value: string | RegExp };
  /** Path must match */
  path?: string | RegExp;
  /** Method must match */
  method?: string | string[];
  /** Query param must exist */
  queryParam?: string;
}

/**
 * Complete request transformation configuration
 */
export interface RequestTransformation {
  /** Routes this transformation applies to */
  routes?: string[];
  /** Conditions for applying transformation */
  conditions?: TransformationCondition;
  /** Header transformations */
  headers?: HeaderTransformations;
  /** Query parameter transformations */
  query?: QueryTransformations;
  /** Path rewrite rules */
  pathRewrite?: PathRewriteRule[];
  /** Body transformations */
  body?: BodyTransformations;
  /** Priority (higher = applied first) */
  priority?: number;
}

/**
 * Transformation result
 */
export interface TransformationResult {
  /** Transformed headers */
  headers: IncomingHttpHeaders;
  /** Transformed path */
  path: string;
  /** Transformed query string */
  queryString: string;
  /** Transformed body (if applicable) */
  body?: Buffer;
  /** Transformation duration in ms */
  duration: number;
}

/**
 * Request Transformer
 */
export class RequestTransformer {
  private transformations: RequestTransformation[] = [];

  /**
   * Add transformation rules
   */
  addTransformation(transformation: RequestTransformation): void {
    this.transformations.push(transformation);
    // Sort by priority (highest first)
    this.transformations.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  /**
   * Set all transformations (replaces existing)
   */
  setTransformations(transformations: RequestTransformation[]): void {
    this.transformations = [...transformations];
    this.transformations.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  /**
   * Transform a request
   */
  async transform(
    method: string,
    path: string,
    headers: IncomingHttpHeaders,
    body?: Buffer
  ): Promise<TransformationResult> {
    const startTime = process.hrtime.bigint();

    // Clone headers to avoid mutation
    let transformedHeaders = { ...headers };
    let transformedPath = path;
    let transformedBody = body;

    // Parse URL for query parameter transformations
    const url = new URL(path, 'http://dummy');
    let transformedQueryString = url.search.slice(1); // Remove leading '?'

    // Apply matching transformations in priority order
    for (const transformation of this.transformations) {
      if (!this.shouldApply(transformation, method, path, headers)) {
        continue;
      }

      // Apply header transformations
      if (transformation.headers) {
        transformedHeaders = this.transformHeaders(transformedHeaders, transformation.headers);
      }

      // Apply query transformations
      if (transformation.query) {
        transformedQueryString = this.transformQuery(transformedQueryString, transformation.query);
      }

      // Apply path rewrite
      if (transformation.pathRewrite) {
        transformedPath = this.rewritePath(transformedPath, transformation.pathRewrite);
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

    // Reconstruct full path with transformed query string
    const pathWithoutQuery = transformedPath.split('?')[0] || '/';
    const finalPath = transformedQueryString
      ? `${pathWithoutQuery}?${transformedQueryString}`
      : pathWithoutQuery;

    const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;

    return {
      headers: transformedHeaders,
      path: finalPath,
      queryString: transformedQueryString,
      body: transformedBody,
      duration,
    };
  }

  /**
   * Check if transformation should be applied
   */
  private shouldApply(
    transformation: RequestTransformation,
    method: string,
    path: string,
    headers: IncomingHttpHeaders
  ): boolean {
    // Check route patterns
    if (transformation.routes) {
      const routeMatches = transformation.routes.some((routePattern) => {
        const regex = this.routePatternToRegex(routePattern);
        return regex.test(path);
      });
      if (!routeMatches) return false;
    }

    // Check conditions
    if (transformation.conditions) {
      const { header, path: pathCondition, method: methodCondition, queryParam } = transformation.conditions;

      // Check header condition
      if (header) {
        const headerValue = headers[header.name.toLowerCase()];
        if (!headerValue) return false;
        const value = Array.isArray(headerValue) ? headerValue[0] : headerValue;
        if (typeof header.value === 'string') {
          if (value !== header.value) return false;
        } else if (header.value instanceof RegExp) {
          if (!header.value.test(value || '')) return false;
        }
      }

      // Check path condition
      if (pathCondition) {
        if (typeof pathCondition === 'string') {
          if (path !== pathCondition) return false;
        } else if (pathCondition instanceof RegExp) {
          if (!pathCondition.test(path)) return false;
        }
      }

      // Check method condition
      if (methodCondition) {
        const methods = Array.isArray(methodCondition) ? methodCondition : [methodCondition];
        if (!methods.includes(method)) return false;
      }

      // Check query param condition
      if (queryParam) {
        const url = new URL(path, 'http://dummy');
        if (!url.searchParams.has(queryParam)) return false;
      }
    }

    return true;
  }

  /**
   * Transform headers
   */
  private transformHeaders(
    headers: IncomingHttpHeaders,
    transformations: HeaderTransformations
  ): IncomingHttpHeaders {
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

    // Modify headers
    if (transformations.modify) {
      for (const [name, { pattern, replacement }] of Object.entries(transformations.modify)) {
        const value = result[name.toLowerCase()];
        if (value !== undefined) {
          const strValue = Array.isArray(value) ? value[0] : value;
          if (strValue) {
            const regex = typeof pattern === 'string' ? new RegExp(pattern, 'g') : pattern;
            result[name.toLowerCase()] = strValue.replace(regex, replacement);
          }
        }
      }
    }

    return result;
  }

  /**
   * Transform query parameters
   */
  private transformQuery(queryString: string, transformations: QueryTransformations): string {
    const params = new URLSearchParams(queryString);

    // Add query params
    if (transformations.add) {
      for (const [name, value] of Object.entries(transformations.add)) {
        params.set(name, value);
      }
    }

    // Remove query params
    if (transformations.remove) {
      for (const name of transformations.remove) {
        params.delete(name);
      }
    }

    // Modify query params
    if (transformations.modify) {
      for (const [name, value] of Object.entries(transformations.modify)) {
        if (params.has(name)) {
          params.set(name, value);
        }
      }
    }

    return params.toString();
  }

  /**
   * Rewrite path based on rules
   */
  private rewritePath(path: string, rules: PathRewriteRule[]): string {
    let result = path.split('?')[0] || '/'; // Remove query string for rewriting

    for (const rule of rules) {
      const regex = typeof rule.pattern === 'string' 
        ? new RegExp(rule.pattern) 
        : rule.pattern;
      
      if (regex.test(result)) {
        result = result.replace(regex, rule.replacement);
      }
    }

    return result;
  }

  /**
   * Transform request body
   */
  private async transformBody(
    body: Buffer,
    headers: IncomingHttpHeaders,
    transformations: BodyTransformations
  ): Promise<Buffer> {
    const contentType = headers['content-type'];
    if (!contentType) return body;

    try {
      // JSON transformations
      if (
        transformations.json &&
        (contentType.includes('application/json') || contentType.includes('application/vnd.api+json'))
      ) {
        const json = JSON.parse(body.toString('utf-8'));
        
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

      // Form data transformations
      if (
        transformations.formData &&
        contentType.includes('application/x-www-form-urlencoded')
      ) {
        const params = new URLSearchParams(body.toString('utf-8'));

        // Set fields
        if (transformations.formData.set) {
          for (const [name, value] of Object.entries(transformations.formData.set)) {
            params.set(name, value);
          }
        }

        // Remove fields
        if (transformations.formData.remove) {
          for (const name of transformations.formData.remove) {
            params.delete(name);
          }
        }

        return Buffer.from(params.toString(), 'utf-8');
      }
    } catch (error) {
      logger.error(`Body transformation failed: ${error}`);
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
