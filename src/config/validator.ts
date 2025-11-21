/**
 * Configuration validator using AJV
 * Fast JSON schema validation with caching
 */

import Ajv, { ValidateFunction } from 'ajv';
import { gatewayConfigSchema } from './schema.js';
import { ConfigFile, ValidationResult, ValidationError } from '../types/config.js';

/**
 * Configuration validator class
 * Implements high-performance validation with schema caching
 */
export class ConfigValidator {
  private ajv: Ajv;
  private validateFn: ValidateFunction;

  constructor() {
    // Initialize AJV with performance optimizations
    this.ajv = new Ajv({
      allErrors: true, // Collect all errors
      coerceTypes: true, // Coerce types for better UX
      useDefaults: true, // Apply default values
      removeAdditional: false, // Keep additional properties
      strict: true, // Strict mode
      validateFormats: true, // Validate formats
    });

    // Pre-compile schema for better performance
    this.validateFn = this.ajv.compile(gatewayConfigSchema);
  }

  /**
   * Validate configuration against schema
   * Returns validation result with detailed errors
   */
  validate(config: unknown): ValidationResult {
    const valid = this.validateFn(config);

    if (valid) {
      return {
        valid: true,
        errors: [],
      };
    }

    const errors: ValidationError[] = (this.validateFn.errors || []).map(err => ({
      path: err.instancePath || err.schemaPath,
      message: err.message || 'Validation error',
      code: err.keyword || 'unknown',
    }));

    return {
      valid: false,
      errors,
    };
  }

  /**
   * Validate and throw on error
   * Convenience method for fail-fast validation
   */
  validateOrThrow(config: unknown): asserts config is ConfigFile {
    const result = this.validate(config);

    if (!result.valid) {
      const errorMessages = result.errors.map(err => `  - ${err.path}: ${err.message}`).join('\n');

      throw new Error(`Configuration validation failed:\n${errorMessages}`);
    }
  }

  /**
   * Check if configuration is valid (boolean only)
   */
  isValid(config: unknown): config is ConfigFile {
    return this.validateFn(config);
  }
}

// Export singleton instance for reuse
export const configValidator: ConfigValidator = new ConfigValidator();
