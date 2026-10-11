---
title: "Pemrofilan & Diagnostik (Profiling & Diagnostics)"
description: "Pemrofil CPU V8, pembuat heap snapshot, dan analisis kebocoran memori."
---

Modul pemrofilan menyediakan fasilitas diagnostik V8 bawaan untuk merekam profil CPU, mengambil heap snapshot, dan memeriksa tren pertumbuhan memori. Modul ini terintegrasi dengan sesi inspektor Node.js untuk memungkinkan pengambilan sampel diagnostik runtime tanpa memerlukan restart server. Alat-alat ini membantu operator mendiagnosis regresi performa dan kebocoran memori di bawah beban produksi.

## Ekspor (Exports)

| Simbol | Jenis | Tanda Tangan | Tujuan |
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

## Catatan (Notes)

### CpuProfiler
Mengontrol sesi pengambilan sampel CPU V8 dan menghasilkan ekspor `.cpuprofile` yang kompatibel dengan Chrome DevTools.

### MemoryProfiler
Memeriksa statistik heap V8 dan memicu siklus garbage collection tertarget selama pengujian.

### HeapSnapshot
Menyimpan graf heap proses ke disk untuk retensi offline dan analisis kebocoran memori.

## Sumber (Source)

- `src/profiling/cpu-profiler.ts`
- `src/profiling/memory-profiler.ts`

## Lihat juga (See also)

- [Pendalaman: Operasional](/id/docs/deep-dive/operations/)
