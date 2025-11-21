/**
 * Plugin lifecycle hooks
 * Defines standard hooks for plugin integration
 */

import { PluginHook } from '../types/plugin.js';

/**
 * Hook execution order
 */
export const HOOK_ORDER = [
  PluginHook.INIT,
  PluginHook.PRE_ROUTE,
  PluginHook.PRE_HANDLER,
  PluginHook.POST_HANDLER,
  PluginHook.POST_RESPONSE,
  PluginHook.ON_ERROR,
  PluginHook.DESTROY
];

/**
 * Hook metadata
 */
export interface HookMetadata {
  name: PluginHook;
  description: string;
  async: boolean;
  errorHandler: boolean;
}

/**
 * Get hook metadata
 */
export function getHookMetadata(hook: PluginHook): HookMetadata {
  const metadata: Record<PluginHook, HookMetadata> = {
    [PluginHook.INIT]: {
      name: PluginHook.INIT,
      description: 'Called when plugin is loaded',
      async: true,
      errorHandler: false
    },
    [PluginHook.PRE_ROUTE]: {
      name: PluginHook.PRE_ROUTE,
      description: 'Called before request routing',
      async: true,
      errorHandler: false
    },
    [PluginHook.PRE_HANDLER]: {
      name: PluginHook.PRE_HANDLER,
      description: 'Called after route matching, before handler',
      async: true,
      errorHandler: false
    },
    [PluginHook.POST_HANDLER]: {
      name: PluginHook.POST_HANDLER,
      description: 'Called after handler, before response',
      async: true,
      errorHandler: false
    },
    [PluginHook.POST_RESPONSE]: {
      name: PluginHook.POST_RESPONSE,
      description: 'Called after response is sent',
      async: true,
      errorHandler: false
    },
    [PluginHook.ON_ERROR]: {
      name: PluginHook.ON_ERROR,
      description: 'Called on request error',
      async: true,
      errorHandler: true
    },
    [PluginHook.DESTROY]: {
      name: PluginHook.DESTROY,
      description: 'Called when plugin is unloaded',
      async: true,
      errorHandler: false
    }
  };

  return metadata[hook];
}

/**
 * Check if hook is async
 */
export function isAsyncHook(hook: PluginHook): boolean {
  return getHookMetadata(hook).async;
}

/**
 * Check if hook is error handler
 */
export function isErrorHandlerHook(hook: PluginHook): boolean {
  return getHookMetadata(hook).errorHandler;
}

/**
 * Get all hook names
 */
export function getAllHooks(): PluginHook[] {
  return HOOK_ORDER;
}

/**
 * Get request lifecycle hooks (excluding init/destroy)
 */
export function getRequestLifecycleHooks(): PluginHook[] {
  return [
    PluginHook.PRE_ROUTE,
    PluginHook.PRE_HANDLER,
    PluginHook.POST_HANDLER,
    PluginHook.POST_RESPONSE
  ];
}

export { PluginHook };
