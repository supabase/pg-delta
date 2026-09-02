/**
 * A TCP proxy in front of a PostgreSQL server that (a) adds a fixed one-way
 * delay to every chunk in both directions, so a loopback container behaves
 * like a cross-region link, and (b) counts protocol round trips by parsing the
 * server→client stream for `ReadyForQuery` ('Z') messages — one per completed
 * query cycle (simple or extended protocol) plus one per connection startup.
 *
 * Benchmark tooling only (scripts/benchmark-baseline.ts); never part of the
 * library. Plaintext connections only: clients must connect with
 * `sslmode=disable`, and the proxy refuses to count once a server accepts an
 * SSLRequest ('S') because the stream is opaque from then on.
 */
import { createServer, type Server, type Socket, connect } from "node:net";

export interface ProxyStats {
  /** `ReadyForQuery` messages seen from the server — round trips */
  roundTrips: number;
  connections: number;
  bytesToServer: number;
  bytesToClient: number;
}

export interface LatencyProxy {
  host: string;
  port: number;
  /** one-way delay applied per direction, so the RTT added is twice this */
  delayMs: number;
  snapshot(): ProxyStats;
  /** Destroy every live proxied connection, both halves at once — what a
   *  client sees when a cross-region path resets or the backend dies. */
  dropConnections(): number;
  close(): Promise<void>;
}

const SSL_REQUEST_CODE = 80877103;
const GSSENC_REQUEST_CODE = 80877104;

/**
 * Incremental parser for the server→client half of one connection. Handles the
 * pre-startup single-byte replies to SSLRequest/GSSENCRequest (the only
 * unframed bytes in the protocol) and then counts framed messages by type.
 */
class RoundTripCounter {
  #pending: Buffer = Buffer.alloc(0);
  #expectSingleByte = false;
  #opaque = false;
  #startupSeen = false;

  constructor(private readonly onReadyForQuery: () => void) {}

  /** Peek at client→server bytes to learn whether an unframed reply is next. */
  onClientChunk(chunk: Buffer): void {
    if (this.#startupSeen || chunk.length < 8) return;
    const len = chunk.readInt32BE(0);
    const code = chunk.readInt32BE(4);
    if (
      len === 8 &&
      (code === SSL_REQUEST_CODE || code === GSSENC_REQUEST_CODE)
    ) {
      this.#expectSingleByte = true;
      return;
    }
    // Anything else before startup is the StartupMessage itself (protocol 3.0).
    this.#startupSeen = true;
  }

  onServerChunk(chunk: Buffer): void {
    if (this.#opaque) return;
    const data: Buffer =
      this.#pending.length === 0
        ? chunk
        : Buffer.concat([this.#pending, chunk]);
    let offset = 0;
    if (this.#expectSingleByte) {
      if (data.length === 0) return;
      const reply = data[offset]!;
      offset += 1;
      this.#expectSingleByte = false;
      if (reply === 0x53 /* 'S' */) {
        // TLS accepted: the rest of the stream is ciphertext.
        this.#opaque = true;
        this.#pending = Buffer.alloc(0);
        return;
      }
      // 'N' — client will now send StartupMessage or another request.
    }
    while (data.length - offset >= 5) {
      const type = data[offset]!;
      const len = data.readInt32BE(offset + 1);
      if (len < 4) {
        // Not a message boundary we understand; give up on this connection.
        this.#opaque = true;
        this.#pending = Buffer.alloc(0);
        return;
      }
      if (data.length - offset < 1 + len) break;
      if (type === 0x5a /* 'Z' */) this.onReadyForQuery();
      offset += 1 + len;
    }
    this.#pending =
      offset < data.length ? data.subarray(offset) : Buffer.alloc(0);
  }
}

/** Forward `chunk` to `to` after the proxy's one-way delay, preserving order. */
function forward(to: Socket, chunk: Buffer, delayMs: number): void {
  if (delayMs === 0) {
    to.write(chunk);
    return;
  }
  setTimeout(() => {
    if (!to.destroyed) to.write(chunk);
  }, delayMs);
}

function endLater(to: Socket, delayMs: number): void {
  if (delayMs === 0) {
    to.end();
    return;
  }
  setTimeout(() => {
    if (!to.destroyed) to.end();
  }, delayMs);
}

export async function startLatencyProxy(
  upstream: { host: string; port: number },
  delayMs: number,
): Promise<LatencyProxy> {
  const stats: ProxyStats = {
    roundTrips: 0,
    connections: 0,
    bytesToServer: 0,
    bytesToClient: 0,
  };
  const sockets = new Set<Socket>();

  const server: Server = createServer((client) => {
    stats.connections++;
    sockets.add(client);
    const counter = new RoundTripCounter(() => {
      stats.roundTrips++;
    });
    const serverSocket = connect({ host: upstream.host, port: upstream.port });
    sockets.add(serverSocket);
    client.setNoDelay(true);
    serverSocket.setNoDelay(true);

    client.on("data", (chunk: Buffer) => {
      stats.bytesToServer += chunk.length;
      counter.onClientChunk(chunk);
      forward(serverSocket, chunk, delayMs);
    });
    serverSocket.on("data", (chunk: Buffer) => {
      stats.bytesToClient += chunk.length;
      counter.onServerChunk(chunk);
      forward(client, chunk, delayMs);
    });
    client.on("end", () => endLater(serverSocket, delayMs));
    serverSocket.on("end", () => endLater(client, delayMs));
    const drop = () => {
      client.destroy();
      serverSocket.destroy();
      sockets.delete(client);
      sockets.delete(serverSocket);
    };
    client.on("error", drop);
    serverSocket.on("error", drop);
    client.on("close", () => {
      sockets.delete(client);
      if (!serverSocket.destroyed) endLater(serverSocket, delayMs);
    });
    serverSocket.on("close", () => {
      sockets.delete(serverSocket);
      if (!client.destroyed) endLater(client, delayMs);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("latency proxy: could not determine listening port");
  }

  return {
    host: "127.0.0.1",
    port: address.port,
    delayMs,
    snapshot: () => ({ ...stats }),
    dropConnections: () => {
      const n = sockets.size;
      for (const s of sockets) s.destroy();
      sockets.clear();
      return n;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        sockets.clear();
        server.close(() => resolve());
      }),
  };
}

/** Rewrite a libpq-style URI so it connects through `proxy` in plaintext. */
export function viaProxy(uri: string, proxy: LatencyProxy): string {
  const u = new URL(uri);
  u.hostname = proxy.host;
  u.port = String(proxy.port);
  u.searchParams.set("sslmode", "disable");
  return u.toString();
}

/** Host + port of a libpq-style URI (brackets stripped from an IPv6 literal). */
export function upstreamOf(uri: string): { host: string; port: number } {
  const u = new URL(uri);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const port = u.port === "" ? 5432 : Number(u.port);
  return { host, port };
}
