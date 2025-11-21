/**
 * Route handler type definitions
 * Designed for V8 optimization with monomorphic functions
 */

import { RequestContext } from './core.js';

/**
 * Route handler function signature
 * Handlers should be monomorphic for V8 optimization
 */
export type RouteHandler = (ctx: RequestContext) => Promise<void> | void;
