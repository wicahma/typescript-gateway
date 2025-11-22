/**
 * CPU profiling system for production environments
 * Phase 9: Low-overhead CPU profiling and analysis
 */

import { writeFile } from 'fs/promises';
import { Session } from 'inspector';

/**
 * Profiler configuration
 */
export interface ProfilerConfig {
  samplingInterval: number; // microseconds
  maxSamples: number;
  includeNative: boolean;
}

/**
 * Profile result
 */
export interface ProfileResult {
  startTime: number;
  endTime: number;
  duration: number;
  nodes: ProfileNode[];
  samples: number[];
  timeDeltas: number[];
}

/**
 * Profile node representing a function call
 */
export interface ProfileNode {
  id: number;
  callFrame: CallFrame;
  hitCount: number;
  children?: number[];
  parent?: number;
  selfTime: number;
  totalTime: number;
}

/**
 * Call frame information
 */
export interface CallFrame {
  functionName: string;
  scriptId: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
}

/**
 * Profile analysis result
 */
export interface ProfileAnalysis {
  hotFunctions: HotFunction[];
  totalTime: number;
  cpuTime: number;
}

/**
 * Hot function information
 */
export interface HotFunction {
  name: string;
  file: string;
  line: number;
  selfTime: number;
  totalTime: number;
  callCount: number;
  percentage: number;
}

/**
 * Sampling result
 */
export interface SamplingResult {
  samples: Sample[];
  startTime: number;
  endTime: number;
  totalSamples: number;
}

/**
 * Individual sample
 */
export interface Sample {
  timestamp: number;
  functionName: string;
  file: string;
  line: number;
}

/**
 * CPU Profiler class
 */
export class CPUProfiler {
  private config: ProfilerConfig;
  private session: Session | null = null;
  private profiling = false;
  private startTime = 0;
  private samplingInterval: NodeJS.Timeout | null = null;
  private samples: Sample[] = [];

  constructor(config: ProfilerConfig) {
    this.config = {
      samplingInterval: config.samplingInterval || 1000, // 1ms default
      maxSamples: config.maxSamples || 10000,
      includeNative: config.includeNative ?? false,
    };
  }

  /**
   * Start CPU profiling using V8 inspector
   */
  async startProfiling(duration?: number): Promise<string> {
    if (this.profiling) {
      throw new Error('Profiling already in progress');
    }

    this.session = new Session();
    this.session.connect();

    return new Promise((resolve, reject) => {
      this.session!.post('Profiler.enable', (err) => {
        if (err) {
          reject(err);
          return;
        }

        this.session!.post(
          'Profiler.start',
          {
            samplingInterval: this.config.samplingInterval,
          },
          (err) => {
            if (err) {
              reject(err);
              return;
            }

            this.profiling = true;
            this.startTime = Date.now();

            // Auto-stop after duration
            if (duration) {
              setTimeout(() => {
                this.stopProfiling().catch(reject);
              }, duration);
            }

            resolve('Profiling started');
          }
        );
      });
    });
  }

  /**
   * Stop CPU profiling and get results
   */
  async stopProfiling(): Promise<ProfileResult> {
    if (!this.profiling || !this.session) {
      throw new Error('No profiling session active');
    }

    return new Promise((resolve, reject) => {
      this.session!.post('Profiler.stop', (err, { profile }) => {
        if (err) {
          reject(err);
          return;
        }

        this.profiling = false;
        const endTime = Date.now();
        
        // Process raw profile data
        const result = this.processProfile(profile, this.startTime, endTime);
        
        // Cleanup
        this.session!.post('Profiler.disable', () => {
          this.session!.disconnect();
          this.session = null;
        });

        resolve(result);
      });
    });
  }

  /**
   * Process raw V8 profile data
   */
  private processProfile(
    profile: any,
    startTime: number,
    endTime: number
  ): ProfileResult {
    const nodes: ProfileNode[] = [];
    const nodeMap = new Map<number, ProfileNode>();

    // Process nodes
    for (const node of profile.nodes) {
      const processedNode: ProfileNode = {
        id: node.id,
        callFrame: {
          functionName: node.callFrame.functionName || '(anonymous)',
          scriptId: node.callFrame.scriptId,
          url: node.callFrame.url || '',
          lineNumber: node.callFrame.lineNumber,
          columnNumber: node.callFrame.columnNumber,
        },
        hitCount: node.hitCount || 0,
        children: node.children,
        selfTime: 0,
        totalTime: 0,
      };

      nodes.push(processedNode);
      nodeMap.set(node.id, processedNode);
    }

    // Calculate times from samples
    const samples = profile.samples || [];
    const timeDeltas = profile.timeDeltas || [];
    
    for (let i = 0; i < samples.length; i++) {
      const nodeId = samples[i];
      const node = nodeMap.get(nodeId);
      if (node) {
        const delta = timeDeltas[i] || 0;
        node.selfTime += delta;
        node.totalTime += delta;
      }
    }

    return {
      startTime,
      endTime,
      duration: endTime - startTime,
      nodes,
      samples,
      timeDeltas,
    };
  }

  /**
   * Analyze profile to identify hot paths
   */
  analyzeProfile(profile: ProfileResult): ProfileAnalysis {
    const hotFunctions: HotFunction[] = [];
    const totalTime = profile.duration;
    let cpuTime = 0;

    // Calculate total CPU time
    for (const node of profile.nodes) {
      cpuTime += node.selfTime;
    }

    // Find hot functions (top 20 by self time)
    const sortedNodes = [...profile.nodes].sort((a, b) => b.selfTime - a.selfTime);
    
    for (let i = 0; i < Math.min(20, sortedNodes.length); i++) {
      const node = sortedNodes[i]!;
      
      if (node.selfTime > 0) {
        hotFunctions.push({
          name: node.callFrame.functionName,
          file: node.callFrame.url,
          line: node.callFrame.lineNumber,
          selfTime: node.selfTime,
          totalTime: node.totalTime,
          callCount: node.hitCount,
          percentage: (node.selfTime / cpuTime) * 100,
        });
      }
    }

    return {
      hotFunctions,
      totalTime,
      cpuTime,
    };
  }

  /**
   * Generate flame graph from profile
   * Outputs data in a format suitable for flame graph tools
   */
  async generateFlameGraph(
    profile: ProfileResult,
    outputPath: string
  ): Promise<void> {
    const stacks: string[] = [];

    // Build call stacks from profile nodes
    const nodeMap = new Map<number, ProfileNode>();
    for (const node of profile.nodes) {
      nodeMap.set(node.id, node);
    }

    // Process samples to build stacks
    for (let i = 0; i < profile.samples.length; i++) {
      const nodeId = profile.samples[i];
      const stack = this.buildStackTrace(nodeId!, nodeMap);
      if (stack) {
        stacks.push(stack);
      }
    }

    // Write in collapsed stack format (for flamegraph.pl)
    const collapsedStacks = this.collapseStacks(stacks);
    await writeFile(outputPath, collapsedStacks);
  }

  /**
   * Build stack trace from node ID
   */
  private buildStackTrace(
    nodeId: number,
    nodeMap: Map<number, ProfileNode>
  ): string | null {
    const stack: string[] = [];
    let currentId: number | undefined = nodeId;

    while (currentId !== undefined) {
      const node = nodeMap.get(currentId);
      if (!node) break;

      const funcName = node.callFrame.functionName || '(anonymous)';
      const fileName = node.callFrame.url.split('/').pop() || 'unknown';
      stack.push(`${funcName} (${fileName}:${node.callFrame.lineNumber})`);

      currentId = node.parent;
    }

    return stack.reverse().join(';');
  }

  /**
   * Collapse stacks for flame graph format
   */
  private collapseStacks(stacks: string[]): string {
    const counts = new Map<string, number>();

    for (const stack of stacks) {
      counts.set(stack, (counts.get(stack) || 0) + 1);
    }

    const lines: string[] = [];
    for (const [stack, count] of counts) {
      lines.push(`${stack} ${count}`);
    }

    return lines.join('\n');
  }

  /**
   * Start sampling-based profiling (lower overhead)
   */
  startSampling(interval: number = 100): void {
    if (this.samplingInterval) {
      throw new Error('Sampling already in progress');
    }

    this.samples = [];
    const startTime = Date.now();

    this.samplingInterval = setInterval(() => {
      const stack = this.captureStackSample();
      if (stack) {
        this.samples.push(stack);
      }

      if (this.samples.length >= this.config.maxSamples) {
        this.stopSampling();
      }
    }, interval);

    this.startTime = startTime;
  }

  /**
   * Stop sampling-based profiling
   */
  stopSampling(): SamplingResult {
    if (this.samplingInterval) {
      clearInterval(this.samplingInterval);
      this.samplingInterval = null;
    }

    const endTime = Date.now();

    return {
      samples: this.samples,
      startTime: this.startTime,
      endTime,
      totalSamples: this.samples.length,
    };
  }

  /**
   * Capture a single stack sample
   */
  private captureStackSample(): Sample | null {
    const err = new Error();
    const stack = err.stack;

    if (!stack) return null;

    const lines = stack.split('\n');
    // Skip first 2 lines (Error and captureStackSample)
    if (lines.length < 3) return null;

    const line = lines[2]!;
    const match = line.match(/at\s+(.+?)\s+\((.+?):(\d+):\d+\)/);

    if (match) {
      return {
        timestamp: Date.now(),
        functionName: match[1]!,
        file: match[2]!,
        line: parseInt(match[3]!, 10),
      };
    }

    return null;
  }

  /**
   * Check if profiling is active
   */
  isProfiling(): boolean {
    return this.profiling;
  }

  /**
   * Get profiler configuration
   */
  getConfig(): ProfilerConfig {
    return { ...this.config };
  }
}

/**
 * Create a CPU profiler with default configuration
 */
export function createCPUProfiler(config?: Partial<ProfilerConfig>): CPUProfiler {
  const defaultConfig: ProfilerConfig = {
    samplingInterval: 1000, // 1ms
    maxSamples: 10000,
    includeNative: false,
  };

  return new CPUProfiler({ ...defaultConfig, ...config });
}
