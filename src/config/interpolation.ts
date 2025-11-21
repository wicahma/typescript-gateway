/**
 * Configuration environment variable interpolation
 * Supports ${ENV_VAR} and ${ENV_VAR:default_value} syntax
 */

/**
 * Interpolation error for tracking issues during variable replacement
 */
export class InterpolationError extends Error {
  constructor(
    message: string,
    public readonly variable: string,
    public readonly path: string
  ) {
    super(message);
    this.name = 'InterpolationError';
  }
}

/**
 * Interpolation options
 */
export interface InterpolationOptions {
  /** Whether to throw error on missing required variables (default: true) */
  strict: boolean;
  /** Custom environment variables to use instead of process.env */
  env?: Record<string, string | undefined>;
}

/**
 * Pattern for matching environment variables: ${VAR} or ${VAR:default}
 */
const ENV_VAR_PATTERN = /\$\{([A-Z_][A-Z0-9_]*?)(?::([^}]*))?\}/g;

/**
 * Interpolate environment variables in a string value
 * 
 * @param value - String value that may contain ${ENV_VAR} or ${ENV_VAR:default}
 * @param options - Interpolation options
 * @param path - JSON path for error reporting
 * @returns Interpolated string
 */
export function interpolateString(
  value: string,
  options: InterpolationOptions = { strict: true },
  path = ''
): string {
  const env = options.env ?? process.env;
  
  return value.replace(ENV_VAR_PATTERN, (match, varName: string, defaultValue: string | undefined) => {
    const envValue = env[varName];
    
    if (envValue !== undefined) {
      return envValue;
    }
    
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    
    if (options.strict) {
      throw new InterpolationError(
        `Required environment variable '${varName}' is not set`,
        varName,
        path
      );
    }
    
    // In non-strict mode, keep the placeholder
    return match;
  });
}

/**
 * Recursively interpolate environment variables in a configuration object
 * 
 * @param config - Configuration object
 * @param options - Interpolation options
 * @param currentPath - Current path in the object (for error reporting)
 * @returns Configuration object with interpolated values
 */
export function interpolateConfig<T>(
  config: T,
  options: InterpolationOptions = { strict: true },
  currentPath = ''
): T {
  if (typeof config === 'string') {
    return interpolateString(config, options, currentPath) as T;
  }
  
  if (Array.isArray(config)) {
    return config.map((item, index) =>
      interpolateConfig(item, options, `${currentPath}[${index}]`)
    ) as T;
  }
  
  if (config !== null && typeof config === 'object') {
    const result: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(config)) {
      const path = currentPath ? `${currentPath}.${key}` : key;
      result[key] = interpolateConfig(value, options, path);
    }
    
    return result as T;
  }
  
  return config;
}

/**
 * Extract all environment variable references from a configuration object
 * Useful for documentation and validation
 * 
 * @param config - Configuration object
 * @returns Set of environment variable names referenced
 */
export function extractEnvVars(config: unknown): Set<string> {
  const vars = new Set<string>();
  
  function extract(value: unknown): void {
    if (typeof value === 'string') {
      const matches = value.matchAll(ENV_VAR_PATTERN);
      for (const match of matches) {
        vars.add(match[1] as string);
      }
    } else if (Array.isArray(value)) {
      value.forEach(extract);
    } else if (value !== null && typeof value === 'object') {
      Object.values(value).forEach(extract);
    }
  }
  
  extract(config);
  return vars;
}

/**
 * Validate that all required environment variables are set
 * 
 * @param config - Configuration object
 * @param env - Environment variables to check against
 * @returns Array of missing required variables
 */
export function validateEnvVars(
  config: unknown,
  env: Record<string, string | undefined> = process.env
): string[] {
  const missing: string[] = [];
  
  function validate(value: unknown): void {
    if (typeof value === 'string') {
      const matches = value.matchAll(ENV_VAR_PATTERN);
      for (const match of matches) {
        const varName = match[1] as string;
        const hasDefault = match[2] !== undefined;
        
        if (!hasDefault && env[varName] === undefined) {
          missing.push(varName);
        }
      }
    } else if (Array.isArray(value)) {
      value.forEach(validate);
    } else if (value !== null && typeof value === 'object') {
      Object.values(value).forEach(validate);
    }
  }
  
  validate(config);
  return [...new Set(missing)]; // Remove duplicates
}
