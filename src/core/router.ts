/**
 * High-performance radix tree router
 * Optimized for O(log n) route matching with O(1) static routes
 */

import { Route, RouteHandler, HttpMethod } from '../types/core.js';

/**
 * Radix tree node for dynamic routes
 */
interface RadixNode {
  /** Path segment */
  segment: string;
  /** Handler if this is a terminal node */
  handler: RouteHandler | null;
  /** Child nodes */
  children: Map<string, RadixNode>;
  /** Parameter node (for :param) */
  paramChild: RadixNode | null;
  /** Parameter name (if this is a param node) */
  paramName: string | null;
  /** Wildcard node (for *) */
  wildcardChild: RadixNode | null;
  /** Route metadata */
  route: Route | null;
}

/**
 * High-performance router implementation
 */
export class Router {
  // Static routes: O(1) lookup with Map
  private staticRoutes: Map<HttpMethod, Map<string, RouteHandler>>;

  // Dynamic routes: O(log n) lookup with radix tree
  private dynamicRoutes: Map<HttpMethod, RadixNode>;

  // All registered routes for introspection
  private routes: Route[] = [];

  constructor() {
    this.staticRoutes = new Map();
    this.dynamicRoutes = new Map();

    // Initialize maps for each HTTP method
    const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
    methods.forEach(method => {
      this.staticRoutes.set(method, new Map());
      this.dynamicRoutes.set(method, this.createNode(''));
    });
  }

  /**
   * Create new radix tree node
   */
  private createNode(segment: string): RadixNode {
    return {
      segment,
      handler: null,
      children: new Map(),
      paramChild: null,
      paramName: null,
      wildcardChild: null,
      route: null,
    };
  }

  /**
   * Register a route
   * Automatically detects static vs dynamic routes
   */
  register(method: HttpMethod, path: string, handler: RouteHandler, priority: number = 0): void {
    const route: Route = {
      method,
      path,
      handler,
      priority,
    };

    // Check if route is static (no params or wildcards)
    if (!path.includes(':') && !path.includes('*')) {
      // Static route - use Map for O(1) lookup
      const methodMap = this.staticRoutes.get(method);
      if (methodMap) {
        methodMap.set(path, handler);
      }
    } else {
      // Dynamic route - use radix tree
      this.insertRadix(method, path, handler, route);
    }

    this.routes.push(route);
  }

  /**
   * Insert route into radix tree
   */
  private insertRadix(method: HttpMethod, path: string, handler: RouteHandler, route: Route): void {
    const root = this.dynamicRoutes.get(method);
    if (!root) return;

    const segments = path.split('/').filter(s => s.length > 0);
    let current = root;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];

      if (!segment) continue;

      if (segment.startsWith(':')) {
        // Parameter segment
        const paramName = segment.slice(1);
        if (!current.paramChild) {
          current.paramChild = this.createNode(segment);
          current.paramChild.paramName = paramName;
        }
        current = current.paramChild;
      } else if (segment === '*') {
        // Wildcard segment
        if (!current.wildcardChild) {
          current.wildcardChild = this.createNode('*');
        }
        current = current.wildcardChild;
        break; // Wildcard is always terminal
      } else {
        // Static segment
        if (!current.children.has(segment)) {
          current.children.set(segment, this.createNode(segment));
        }
        current = current.children.get(segment)!;
      }
    }

    // Set handler at terminal node
    current.handler = handler;
    current.route = route;
  }

  /**
   * Match route and extract parameters
   * Returns handler and params if found
   */
  match(
    method: HttpMethod,
    path: string
  ): { handler: RouteHandler; params: Record<string, string> } | null {
    // Try static routes first (O(1))
    const staticMap = this.staticRoutes.get(method);
    if (staticMap) {
      const handler = staticMap.get(path);
      if (handler) {
        return { handler, params: {} };
      }
    }

    // Try dynamic routes (O(log n))
    const root = this.dynamicRoutes.get(method);
    if (!root) return null;

    const segments = path.split('/').filter(s => s.length > 0);
    const params: Record<string, string> = {};

    const result = this.matchRadix(root, segments, 0, params);
    if (result) {
      return { handler: result, params };
    }

    return null;
  }

  /**
   * Recursive radix tree matching
   */
  private matchRadix(
    node: RadixNode,
    segments: string[],
    index: number,
    params: Record<string, string>
  ): RouteHandler | null {
    // Reached end of path
    if (index === segments.length) {
      return node.handler;
    }

    const segment = segments[index];

    if (!segment) return null;

    // Try exact match first (highest priority)
    if (node.children.has(segment)) {
      const child = node.children.get(segment)!;
      const result = this.matchRadix(child, segments, index + 1, params);
      if (result) return result;
    }

    // Try parameter match
    if (node.paramChild) {
      const paramName = node.paramChild.paramName;
      if (paramName) {
        params[paramName] = segment;
        const result = this.matchRadix(node.paramChild, segments, index + 1, params);
        if (result) return result;
        delete params[paramName]; // Backtrack
      }
    }

    // Try wildcard match (lowest priority)
    if (node.wildcardChild) {
      return node.wildcardChild.handler;
    }

    return null;
  }

  /**
   * Get all registered routes
   */
  getRoutes(): Route[] {
    return [...this.routes];
  }

  /**
   * Clear all routes
   */
  clear(): void {
    this.staticRoutes.clear();
    this.dynamicRoutes.clear();
    this.routes = [];

    const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
    methods.forEach(method => {
      this.staticRoutes.set(method, new Map());
      this.dynamicRoutes.set(method, this.createNode(''));
    });
  }
}
