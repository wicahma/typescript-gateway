import { describe, it, expect } from 'vitest';
import { CircuitBreaker, CircuitBreakerEvent } from '../../src/core/circuit-breaker.js';
import { CircuitBreakerState } from '../../src/types/core.js';

describe('CircuitBreaker CLOSED fast-path', () => {
  it('keeps full state-machine behavior through the new fast path', async () => {
    const events: string[] = [];
    const cb = new CircuitBreaker('u1', { failureThreshold: 2, successThreshold: 2, timeout: 5, windowSize: 2 });
    cb.on(CircuitBreakerEvent.REQUEST_SUCCESS, () => events.push('success'));
    cb.on(CircuitBreakerEvent.REQUEST_FAILURE, () => events.push('failure'));
    cb.on(CircuitBreakerEvent.REQUEST_REJECTED, () => events.push('rejected'));
    cb.on(CircuitBreakerEvent.STATE_CHANGE, () => events.push('state-change'));

    for (let i = 0; i < 10; i++) await cb.execute(() => Promise.resolve('ok'));
    expect(cb.getMetrics().successfulRequests).toBe(10);
    expect(cb.getMetrics().totalRequests).toBe(10);
    expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);

    const failing = () => Promise.reject(new Error('boom'));
    await expect(cb.execute(failing)).rejects.toThrow('boom');
    await expect(cb.execute(failing)).rejects.toThrow('boom');
    expect(cb.getState()).toBe(CircuitBreakerState.OPEN);
    await expect(cb.execute(() => Promise.resolve('ok'))).rejects.toThrow('Circuit breaker is OPEN');
    expect(cb.getMetrics().rejectedRequests).toBe(1);

    await new Promise((r) => setTimeout(r, 10));
    await cb.execute(() => Promise.resolve('ok'));
    await cb.execute(() => Promise.resolve('ok'));
    expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
    expect(events.filter((e) => e === 'state-change').length).toBeGreaterThanOrEqual(2);
  });
});
