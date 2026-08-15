import { exec as execCallback } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execCallback);

export interface SslCertificates {
  caCert: string;
  serverCert: string;
  serverKey: string;
  clientCert: string;
  clientKey: string;
  cleanup: () => Promise<void>;
}

export interface SslCertificateOptions {
  /**
   * Common Name for the server certificate.
   * Default: "localhost"
   */
  serverCN?: string;
  /**
   * Subject Alternative Names for the server certificate.
   * Default: ["DNS:localhost", "IP:127.0.0.1"]
   */
  serverSAN?: string[];
}

/**
 * Generate self-signed SSL certificates for testing PostgreSQL SSL connections.
 * Creates a temporary directory with all necessary certificates.
 *
 * @param options - Optional configuration for certificate generation
 */
export async function generateSslCertificates(
  options?: SslCertificateOptions,
): Promise<SslCertificates> {
  const serverCN = options?.serverCN ?? "localhost";
  const serverSAN = options?.serverSAN ?? ["DNS:localhost", "IP:127.0.0.1"];
  const certDir = await mkdtemp(join(tmpdir(), "pg-delta-ssl-certs-"));
  const caKey = join(certDir, "ca-key.pem");
  const caCert = join(certDir, "ca-cert.pem");
  const serverKey = join(certDir, "server-key.pem");
  const serverCert = join(certDir, "server-cert.pem");
  const clientKey = join(certDir, "client-key.pem");
  const clientCert = join(certDir, "client-cert.pem");

  try {
    // Generate CA private key
    await exec(`openssl genrsa -out "${caKey}" 2048`);

    // Generate CA certificate
    await exec(
      `openssl req -new -x509 -days 365 -key "${caKey}" -out "${caCert}" -subj "/CN=Test CA"`,
    );

    // Generate server private key
    await exec(`openssl genrsa -out "${serverKey}" 2048`);

    // Generate server certificate signing request
    await exec(
      `openssl req -new -key "${serverKey}" -out "${certDir}/server.csr" -subj "/CN=${serverCN}"`,
    );

    // Create extfile for server certificate with SAN
    const extfile = join(certDir, "server-extfile.conf");
    await writeFile(
      extfile,
      `[v3_req]\nsubjectAltName=${serverSAN.join(",")}\n`,
    );

    // Sign server certificate with CA
    await exec(
      `openssl x509 -req -days 365 -in "${certDir}/server.csr" -CA "${caCert}" -CAkey "${caKey}" -CAcreateserial -out "${serverCert}" -extensions v3_req -extfile "${extfile}"`,
    );

    // Generate client private key
    await exec(`openssl genrsa -out "${clientKey}" 2048`);

    // Generate client certificate signing request
    await exec(
      `openssl req -new -key "${clientKey}" -out "${certDir}/client.csr" -subj "/CN=test-client"`,
    );

    // Sign client certificate with CA
    await exec(
      `openssl x509 -req -days 365 -in "${certDir}/client.csr" -CA "${caCert}" -CAkey "${caKey}" -CAcreateserial -out "${clientCert}"`,
    );

    const cleanup = async () => {
      try {
        await exec(`rm -rf "${certDir}"`);
      } catch {
        // Ignore cleanup errors
      }
    };

    return {
      caCert,
      serverCert,
      serverKey,
      clientCert,
      clientKey,
      cleanup,
    };
  } catch (error) {
    // Cleanup on error
    try {
      await exec(`rm -rf "${certDir}"`);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}
