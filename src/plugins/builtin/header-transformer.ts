/**
 * Header Transformer Plugin
 * Add, remove, or modify request and response headers
 */

import { Plugin } from '../../types/plugin.js';
import { RequestContext } from '../../types/core.js';

/**
 * Header transformation rule
 */
export interface HeaderRule {
  /** Header name */
  name: string;
  /** Action to perform */
  action: 'add' | 'set' | 'remove' | 'rename';
  /** Value for add/set actions */
  value?: string;
  /** New name for rename action */
  newName?: string;
  /** Apply to request headers (default: false) */
  applyToRequest?: boolean;
  /** Apply to response headers (default: true) */
  applyToResponse?: boolean;
  /** Condition (simple string match in value) */
  condition?: {
    header: string;
    contains?: string;
    equals?: string;
  };
}

/**
 * Header transformer plugin configuration
 */
export interface HeaderTransformerConfig {
  /** Header transformation rules */
  rules: HeaderRule[];
  /** Enable request header transformation (default: true) */
  transformRequest: boolean;
  /** Enable response header transformation (default: true) */
  transformResponse: boolean;
}

/**
 * Header Transformer Plugin
 * Adds, removes, or modifies headers based on configurable rules
 */
export class HeaderTransformerPlugin implements Plugin {
  name = 'header-transformer';
  version = '1.0.0';
  description = 'Add, remove, or modify request and response headers';
  author = 'Gateway Team';
  
  private config: HeaderTransformerConfig = {
    rules: [],
    transformRequest: true,
    transformResponse: true,
  };
  
  init(config: Record<string, unknown>): void {
    if ('rules' in config && Array.isArray(config['rules'])) {
      this.config.rules = config['rules'] as HeaderRule[];
    }
    if ('transformRequest' in config && config['transformRequest'] !== undefined) {
      this.config.transformRequest = Boolean(config['transformRequest']);
    }
    if ('transformResponse' in config && config['transformResponse'] !== undefined) {
      this.config.transformResponse = Boolean(config['transformResponse']);
    }
  }
  
  preHandler(ctx: RequestContext): void {
    if (!this.config.transformRequest) {
      return;
    }
    
    // Apply rules to request headers
    for (const rule of this.config.rules) {
      if (rule.applyToRequest) {
        this.applyRule(rule, ctx.headers);
      }
    }
  }
  
  postHandler(ctx: RequestContext): void {
    if (!this.config.transformResponse) {
      return;
    }
    
    // Apply rules to response headers
    for (const rule of this.config.rules) {
      if (rule.applyToResponse !== false) {
        // Default to response if not specified
        this.applyRuleToResponse(rule, ctx);
      }
    }
  }
  
  /**
   * Apply rule to request headers object
   */
  private applyRule(
    rule: HeaderRule,
    headers: Record<string, string | string[] | undefined>
  ): void {
    // Check condition if present
    if (rule.condition && !this.checkCondition(rule.condition, headers)) {
      return;
    }
    
    const headerName = rule.name.toLowerCase();
    
    switch (rule.action) {
      case 'add': {
        if (rule.value !== undefined) {
          const existing = headers[headerName];
          if (existing) {
            // Append to existing
            if (Array.isArray(existing)) {
              existing.push(rule.value);
            } else {
              headers[headerName] = [existing, rule.value];
            }
          } else {
            headers[headerName] = rule.value;
          }
        }
        break;
      }
      
      case 'set': {
        if (rule.value !== undefined) {
          headers[headerName] = rule.value;
        }
        break;
      }
      
      case 'remove': {
        delete headers[headerName];
        break;
      }
      
      case 'rename': {
        if (rule.newName) {
          const value = headers[headerName];
          if (value !== undefined) {
            delete headers[headerName];
            headers[rule.newName.toLowerCase()] = value;
          }
        }
        break;
      }
    }
  }
  
  /**
   * Apply rule to response headers
   */
  private applyRuleToResponse(rule: HeaderRule, ctx: RequestContext): void {
    // Check condition if present
    if (rule.condition && !this.checkConditionResponse(rule.condition, ctx)) {
      return;
    }
    
    const headerName = rule.name.toLowerCase();
    
    switch (rule.action) {
      case 'add': {
        if (rule.value !== undefined) {
          const existing = ctx.res.getHeader(headerName);
          if (existing) {
            // Append to existing
            if (Array.isArray(existing)) {
              ctx.res.setHeader(headerName, [...existing, rule.value]);
            } else {
              ctx.res.setHeader(headerName, [String(existing), rule.value]);
            }
          } else {
            ctx.res.setHeader(headerName, rule.value);
          }
        }
        break;
      }
      
      case 'set': {
        if (rule.value !== undefined) {
          ctx.res.setHeader(headerName, rule.value);
        }
        break;
      }
      
      case 'remove': {
        ctx.res.removeHeader(headerName);
        break;
      }
      
      case 'rename': {
        if (rule.newName) {
          const value = ctx.res.getHeader(headerName);
          if (value !== undefined && value !== null) {
            ctx.res.removeHeader(headerName);
            ctx.res.setHeader(rule.newName.toLowerCase(), value);
          }
        }
        break;
      }
    }
  }
  
  /**
   * Check rule condition against request headers
   */
  private checkCondition(
    condition: HeaderRule['condition'],
    headers: Record<string, string | string[] | undefined>
  ): boolean {
    if (!condition) {
      return true;
    }
    
    const headerValue = headers[condition.header.toLowerCase()];
    
    if (!headerValue) {
      return false;
    }
    
    const value = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    
    if (!value) {
      return false;
    }
    
    if (condition.equals !== undefined) {
      return value === condition.equals;
    }
    
    if (condition.contains !== undefined) {
      return value ? value.includes(condition.contains) : false;
    }
    
    return true;
  }
  
  /**
   * Check rule condition against response
   */
  private checkConditionResponse(condition: HeaderRule['condition'], ctx: RequestContext): boolean {
    if (!condition) {
      return true;
    }
    
    const headerValue = ctx.res.getHeader(condition.header.toLowerCase());
    
    if (!headerValue) {
      return false;
    }
    
    const value = Array.isArray(headerValue) ? headerValue[0] : String(headerValue);
    
    if (condition.equals !== undefined) {
      return value === condition.equals;
    }
    
    if (condition.contains !== undefined) {
      return value ? value.includes(condition.contains) : false;
    }
    
    return true;
  }
}

/**
 * Create header transformer plugin instance
 */
export function createHeaderTransformerPlugin(
  config?: Partial<HeaderTransformerConfig>
): HeaderTransformerPlugin {
  const plugin = new HeaderTransformerPlugin();
  if (config) {
    plugin.init(config);
  }
  return plugin;
}
