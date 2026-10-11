---
title: "Profiling & Diagnostics"
description: "V8 CPU profiler, heap snapshot generator, and memory leak analysis tools."
---

The profiling module provides native V8 diagnostic facilities for capturing CPU profiles, taking heap snapshots, and inspecting memory growth trends. It integrates with Node.js inspector sessions to allow runtime diagnostic sampling without requiring server restarts. These tools assist operators in diagnosing performance regressions and memory leaks under production traffic.

## Exports

| Symbol | Kind | Signature | Purpose |
| --- | --- | --- | --- |
| `ProfilerConfig` | interface | `interface ProfilerConfig` | Profiler configuration |
| `ProfileResult` | interface | `interface ProfileResult` | Profile result |
| `ProfileNode` | interface | `interface ProfileNode` | Profile node representing a function call |
| `CallFrame` | interface | `interface CallFrame` | Call frame information |
| `ProfileAnalysis` | interface | `interface ProfileAnalysis` | Profile analysis result |
| `HotFunction` | interface | `interface HotFunction` | Hot function information |
| `SamplingResult` | interface | `interface SamplingResult` | Sampling result |
| `Sample` | interface | `interface Sample` | Individual sample |
| `CPUProfiler` | class | `class CPUProfiler` | CPU Profiler class |
| `createCPUProfiler` | function | `function createCPUProfiler(config?: Partial<ProfilerConfig>): CPUProfiler` | Create a CPU profiler with default configuration |
| `MemoryProfilerConfig` | interface | `interface MemoryProfilerConfig` | Memory profiler configuration |
| `Snapshot` | interface | `interface Snapshot` | Heap snapshot reference |
| `Comparison` | interface | `interface Comparison` | Snapshot comparison result |
| `LeakSuspect` | interface | `interface LeakSuspect` | Suspected memory leak |
| `AllocationProfile` | interface | `interface AllocationProfile` | Allocation profile |
| `Allocation` | interface | `interface Allocation` | Single allocation event |
| `GCMonitor` | interface | `interface GCMonitor` | GC monitor interface |
| `GCEvent` | interface | `interface GCEvent` | GC event |
| `GCMonitorStats` | interface | `interface GCMonitorStats` | GC monitoring statistics |
| `RetentionTree` | interface | `interface RetentionTree` | Retention tree for object analysis |
| `RetentionNode` | interface | `interface RetentionNode` | Retention tree node |
| `MemoryProfiler` | class | `class MemoryProfiler` | Memory profiler class |
| `createMemoryProfiler` | function | `function createMemoryProfiler(` | Create a memory profiler with default configuration |

## Notes

### CpuProfiler
Controls V8 CPU sampling sessions and produces Chrome DevTools-compatible `.cpuprofile` exports.

### MemoryProfiler
Inspects V8 heap statistics and triggers targeted garbage collection cycles during testing.

### HeapSnapshot
Serializes process heap graphs to disk for offline retention and leak graph analysis.

## Source

- `src/profiling/cpu-profiler.ts`
- `src/profiling/memory-profiler.ts`

## See also

- [Deep Dive: Operations](/docs/deep-dive/operations/)
