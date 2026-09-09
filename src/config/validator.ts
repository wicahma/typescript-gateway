import { ConfigFile, ValidationResult, ValidationError } from '../types/config.js';

export class ConfigValidator {
  validate(raw: unknown): ValidationResult {
    const errors: ValidationError[] = [];

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { valid: false, errors: [{ path: '', message: 'Configuration must be an object', code: 'type' }] };
    }

    const cfg = raw as Record<string, unknown>;

    if (typeof cfg['version'] !== 'string' || !/^\d+\.\d+\.\d+$/.test(cfg['version'])) {
      errors.push({ path: '/version', message: 'must match pattern ^\\d+\\.\\d+\\.\\d+$', code: 'pattern' });
    }

    const envs = ['development', 'staging', 'production'];
    if (typeof cfg['environment'] !== 'string' || !envs.includes(cfg['environment'])) {
      errors.push({ path: '/environment', message: `must be equal to one of the allowed values: ${envs.join(', ')}`, code: 'enum' });
    }

    if (!cfg['server'] || typeof cfg['server'] !== 'object') {
      errors.push({ path: '/server', message: 'must be object', code: 'type' });
    } else {
      const s = cfg['server'] as Record<string, unknown>;
      if (typeof s['port'] !== 'number' || !Number.isInteger(s['port']) || s['port'] < 1 || s['port'] > 65535) {
        errors.push({ path: '/server/port', message: 'must be <= 65535 and >= 1 integer', code: 'maximum' });
      }
      if (typeof s['host'] !== 'string') {
        errors.push({ path: '/server/host', message: 'must be string', code: 'type' });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  validateOrThrow(config: unknown): asserts config is ConfigFile {
    const res = this.validate(config);
    if (!res.valid) {
      const msgs = res.errors.map(e => `  - ${e.path}: ${e.message}`).join('\n');
      throw new Error(`Configuration validation failed:\n${msgs}`);
    }
  }

  isValid(config: unknown): config is ConfigFile {
    return this.validate(config).valid;
  }
}

export const configValidator: ConfigValidator = new ConfigValidator();
