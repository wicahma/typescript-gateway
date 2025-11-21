/**
 * WebSocket Handler - Handle WebSocket proxying
 * Phase 6: Proxy Logic & Request Forwarding
 * 
 * Features:
 * - Upgrade handling and negotiation
 * - Bidirectional streaming
 * - Connection management
 * - Heartbeat/ping-pong
 * - Graceful shutdown
 * - Load balancing for WebSocket connections
 */

import { IncomingMessage } from 'http';
import { Socket } from 'net';
import http from 'http';
import https from 'https';
import { UpstreamTarget } from '../types/core.js';
import { LoadBalancer, LoadBalancerContext } from './load-balancer.js';
import { logger } from '../utils/logger.js';

/**
 * WebSocket configuration
 */
export interface WebSocketConfig {
  /** Enable WebSocket proxying */
  enabled: boolean;
  /** Heartbeat interval in milliseconds */
  heartbeatInterval: number;
  /** Maximum payload size in bytes */
  maxPayloadSize: number;
  /** Routes that support WebSocket */
  routes: string[];
  /** Connection timeout in milliseconds */
  connectionTimeout?: number;
}

/**
 * WebSocket connection info
 */
export interface WebSocketConnection {
  /** Connection ID */
  id: string;
  /** Client socket */
  clientSocket: Socket;
  /** Upstream socket */
  upstreamSocket: Socket | null;
  /** Upstream target */
  upstream: UpstreamTarget;
  /** Request path */
  path: string;
  /** Connection start time */
  startTime: number;
  /** Last activity timestamp */
  lastActivity: number;
  /** Bytes sent to upstream */
  bytesSent: number;
  /** Bytes received from upstream */
  bytesReceived: number;
  /** Message count sent */
  messagesSent: number;
  /** Message count received */
  messagesReceived: number;
  /** Heartbeat interval handle */
  heartbeatInterval?: NodeJS.Timeout;
}

/**
 * Default WebSocket configuration
 */
const DEFAULT_CONFIG: WebSocketConfig = {
  enabled: true,
  heartbeatInterval: 30000, // 30 seconds
  maxPayloadSize: 1048576, // 1MB
  routes: ['/ws/*'],
  connectionTimeout: 60000, // 60 seconds
};

/**
 * WebSocket Handler
 */
export class WebSocketHandler {
  private config: WebSocketConfig;
  private connections: Map<string, WebSocketConnection> = new Map();
  private loadBalancer: LoadBalancer;
  private connectionIdCounter = 0;

  constructor(loadBalancer: LoadBalancer, config?: Partial<WebSocketConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.loadBalancer = loadBalancer;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<WebSocketConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Check if path should be upgraded to WebSocket
   */
  shouldUpgrade(path: string): boolean {
    if (!this.config.enabled) {
      return false;
    }

    return this.config.routes.some((routePattern) => {
      const regex = this.routePatternToRegex(routePattern);
      return regex.test(path);
    });
  }

  /**
   * Handle WebSocket upgrade
   */
  async handleUpgrade(
    req: IncomingMessage,
    socket: Socket,
    head: Buffer
  ): Promise<void> {
    const startTime = Date.now();
    const path = req.url || '/';

    try {
      // Check if upgrade should be handled
      if (!this.shouldUpgrade(path)) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      // Select upstream
      const clientIp = this.getClientIp(req);
      const lbContext: LoadBalancerContext = {
        clientIp,
        path,
      };

      const upstream = this.loadBalancer.select(lbContext);
      if (!upstream) {
        logger.error('No healthy upstream available for WebSocket');
        socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        socket.destroy();
        return;
      }

      // Create connection
      const connectionId = this.generateConnectionId();
      const connection: WebSocketConnection = {
        id: connectionId,
        clientSocket: socket,
        upstreamSocket: null,
        upstream,
        path,
        startTime,
        lastActivity: startTime,
        bytesSent: 0,
        bytesReceived: 0,
        messagesSent: 0,
        messagesReceived: 0,
      };

      this.connections.set(connectionId, connection);

      // Proxy the upgrade to upstream
      await this.proxyUpgrade(connection, req, head);

      const upgradeTime = Date.now() - startTime;
      logger.info(`WebSocket upgrade completed in ${upgradeTime}ms for ${path}`);
    } catch (error) {
      logger.error(`WebSocket upgrade failed: ${error}`);
      socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      socket.destroy();
    }
  }

  /**
   * Proxy WebSocket upgrade to upstream
   */
  private async proxyUpgrade(
    connection: WebSocketConnection,
    req: IncomingMessage,
    head: Buffer
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const { upstream, path } = connection;
      const isHttps = upstream.protocol === 'https';
      const client = isHttps ? https : http;

      // Build request options
      const options = {
        hostname: upstream.host,
        port: upstream.port,
        path: upstream.basePath + path,
        method: 'GET',
        headers: {
          ...req.headers,
          host: `${upstream.host}:${upstream.port}`,
        },
      };

      // Create upgrade request
      const proxyReq = client.request(options);

      proxyReq.on('upgrade', (proxyRes: IncomingMessage, proxySocket: Socket, proxyHead: Buffer) => {
        // Connection established
        connection.upstreamSocket = proxySocket;

        // Send upgrade response to client
        connection.clientSocket.write(
          `HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n`
        );

        // Forward headers
        const headers = proxyRes.headers;
        for (const [key, value] of Object.entries(headers)) {
          if (value !== undefined) {
            const headerValue = Array.isArray(value) ? value.join(', ') : value;
            connection.clientSocket.write(`${key}: ${headerValue}\r\n`);
          }
        }
        connection.clientSocket.write('\r\n');

        // Write upgrade head data
        if (proxyHead.length > 0) {
          connection.clientSocket.write(proxyHead);
        }

        // Setup bidirectional pipe
        this.setupBidirectionalPipe(connection);

        // Start heartbeat
        this.startHeartbeat(connection);

        resolve();
      });

      proxyReq.on('error', (error) => {
        logger.error(`WebSocket upgrade request failed: ${error}`);
        this.closeConnection(connection.id);
        reject(error);
      });

      // End the request
      proxyReq.end();

      // Write the upgrade head
      if (head.length > 0) {
        proxyReq.write(head);
      }
    });
  }

  /**
   * Setup bidirectional pipe between client and upstream
   */
  private setupBidirectionalPipe(connection: WebSocketConnection): void {
    const { clientSocket, upstreamSocket } = connection;
    if (!upstreamSocket) return;

    // Client -> Upstream
    clientSocket.on('data', (data: Buffer) => {
      if (upstreamSocket && !upstreamSocket.destroyed) {
        connection.bytesSent += data.length;
        connection.messagesSent++;
        connection.lastActivity = Date.now();
        upstreamSocket.write(data);
      }
    });

    // Upstream -> Client
    upstreamSocket.on('data', (data: Buffer) => {
      if (!clientSocket.destroyed) {
        connection.bytesReceived += data.length;
        connection.messagesReceived++;
        connection.lastActivity = Date.now();
        clientSocket.write(data);
      }
    });

    // Handle errors and closes
    clientSocket.on('error', (error) => {
      logger.error(`WebSocket client socket error: ${error}`);
      this.closeConnection(connection.id);
    });

    clientSocket.on('close', () => {
      logger.debug(`WebSocket client socket closed: ${connection.id}`);
      this.closeConnection(connection.id);
    });

    upstreamSocket.on('error', (error) => {
      logger.error(`WebSocket upstream socket error: ${error}`);
      this.closeConnection(connection.id);
    });

    upstreamSocket.on('close', () => {
      logger.debug(`WebSocket upstream socket closed: ${connection.id}`);
      this.closeConnection(connection.id);
    });

    // Set timeout
    if (this.config.connectionTimeout) {
      const timeout = this.config.connectionTimeout;
      clientSocket.setTimeout(timeout);
      upstreamSocket.setTimeout(timeout);

      clientSocket.on('timeout', () => {
        logger.debug(`WebSocket client socket timeout: ${connection.id}`);
        this.closeConnection(connection.id);
      });

      upstreamSocket.on('timeout', () => {
        logger.debug(`WebSocket upstream socket timeout: ${connection.id}`);
        this.closeConnection(connection.id);
      });
    }
  }

  /**
   * Start heartbeat for connection
   */
  private startHeartbeat(connection: WebSocketConnection): void {
    if (this.config.heartbeatInterval <= 0) return;

    connection.heartbeatInterval = setInterval(() => {
      // Send ping frame (0x89 opcode)
      // Simple WebSocket ping frame: FIN=1, opcode=0x9, no payload
      const pingFrame = Buffer.from([0x89, 0x00]);

      if (connection.upstreamSocket && !connection.upstreamSocket.destroyed) {
        try {
          connection.upstreamSocket.write(pingFrame);
        } catch (error) {
          logger.error(`Failed to send heartbeat: ${error}`);
          this.closeConnection(connection.id);
        }
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Close a WebSocket connection
   */
  closeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    // Clear heartbeat
    if (connection.heartbeatInterval) {
      clearInterval(connection.heartbeatInterval);
    }

    // Close sockets
    if (!connection.clientSocket.destroyed) {
      connection.clientSocket.destroy();
    }

    if (connection.upstreamSocket && !connection.upstreamSocket.destroyed) {
      connection.upstreamSocket.destroy();
    }

    // Remove from connections
    this.connections.delete(connectionId);

    // Log metrics
    const duration = Date.now() - connection.startTime;
    logger.info(
      `WebSocket connection closed: ${connectionId}, ` +
        `duration: ${duration}ms, ` +
        `sent: ${connection.bytesSent} bytes (${connection.messagesSent} msgs), ` +
        `received: ${connection.bytesReceived} bytes (${connection.messagesReceived} msgs)`
    );
  }

  /**
   * Get client IP from request
   */
  private getClientIp(req: IncomingMessage): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded;
      if (ips) {
        return ips.split(',')[0]?.trim() || '';
      }
    }

    const realIp = req.headers['x-real-ip'];
    if (realIp) {
      return Array.isArray(realIp) ? realIp[0] || '' : realIp;
    }

    return req.socket.remoteAddress || '';
  }

  /**
   * Generate unique connection ID
   */
  private generateConnectionId(): string {
    return `ws-${++this.connectionIdCounter}-${Date.now()}`;
  }

  /**
   * Convert route pattern to regex
   */
  private routePatternToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    return new RegExp('^' + escaped + '$');
  }

  /**
   * Get active connections
   */
  getConnections(): WebSocketConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Get connection by ID
   */
  getConnection(connectionId: string): WebSocketConnection | undefined {
    return this.connections.get(connectionId);
  }

  /**
   * Get statistics
   */
  getStats(): {
    activeConnections: number;
    totalBytesSent: number;
    totalBytesReceived: number;
    totalMessagesSent: number;
    totalMessagesReceived: number;
  } {
    let totalBytesSent = 0;
    let totalBytesReceived = 0;
    let totalMessagesSent = 0;
    let totalMessagesReceived = 0;

    for (const conn of this.connections.values()) {
      totalBytesSent += conn.bytesSent;
      totalBytesReceived += conn.bytesReceived;
      totalMessagesSent += conn.messagesSent;
      totalMessagesReceived += conn.messagesReceived;
    }

    return {
      activeConnections: this.connections.size,
      totalBytesSent,
      totalBytesReceived,
      totalMessagesSent,
      totalMessagesReceived,
    };
  }

  /**
   * Graceful shutdown - close all connections
   */
  async shutdown(): Promise<void> {
    logger.info(`Shutting down WebSocket handler, closing ${this.connections.size} connections`);

    const connectionIds = Array.from(this.connections.keys());
    for (const connectionId of connectionIds) {
      this.closeConnection(connectionId);
    }

    logger.info('WebSocket handler shutdown complete');
  }
}
