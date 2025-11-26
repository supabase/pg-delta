import { describe, expect, test } from "vitest";
import { Server } from "../server.model.ts";
import { CreateServer } from "./server.create.ts";

describe("server", () => {
  test("create basic", () => {
    const server = new Server({
      name: "test_server",
      owner: "test",
      foreign_data_wrapper: "test_fdw",
      type: null,
      version: null,
      options: null,
      comment: null,
      privileges: [],
    });

    const change = new CreateServer({
      server,
    });

    expect(change.serialize()).toBe(
      "CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw",
    );
  });

  test("create with type", () => {
    const server = new Server({
      name: "test_server",
      owner: "test",
      foreign_data_wrapper: "test_fdw",
      type: "postgres_fdw",
      version: null,
      options: null,
      comment: null,
      privileges: [],
    });

    const change = new CreateServer({
      server,
    });

    expect(change.serialize()).toBe(
      "CREATE SERVER test_server TYPE 'postgres_fdw' FOREIGN DATA WRAPPER test_fdw",
    );
  });

  test("create with version", () => {
    const server = new Server({
      name: "test_server",
      owner: "test",
      foreign_data_wrapper: "test_fdw",
      type: null,
      version: "1.0",
      options: null,
      comment: null,
      privileges: [],
    });

    const change = new CreateServer({
      server,
    });

    expect(change.serialize()).toBe(
      "CREATE SERVER test_server VERSION '1.0' FOREIGN DATA WRAPPER test_fdw",
    );
  });

  test("create with type and version", () => {
    const server = new Server({
      name: "test_server",
      owner: "test",
      foreign_data_wrapper: "test_fdw",
      type: "postgres_fdw",
      version: "1.0",
      options: null,
      comment: null,
      privileges: [],
    });

    const change = new CreateServer({
      server,
    });

    expect(change.serialize()).toBe(
      "CREATE SERVER test_server TYPE 'postgres_fdw' VERSION '1.0' FOREIGN DATA WRAPPER test_fdw",
    );
  });

  test("create with options", () => {
    const server = new Server({
      name: "test_server",
      owner: "test",
      foreign_data_wrapper: "test_fdw",
      type: null,
      version: null,
      options: ["host", "localhost", "port", "5432"],
      comment: null,
      privileges: [],
    });

    const change = new CreateServer({
      server,
    });

    expect(change.serialize()).toBe(
      "-- WARNING: Server contains options (host, port)\n-- Replace placeholders below or run ALTER SERVER test_server after this script\nCREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw OPTIONS (host '__OPTION_HOST__', port '__OPTION_PORT__')",
    );
  });

  test("create with all properties", () => {
    const server = new Server({
      name: "test_server",
      owner: "test",
      foreign_data_wrapper: "test_fdw",
      type: "postgres_fdw",
      version: "1.0",
      options: ["host", "localhost", "port", "5432"],
      comment: null,
      privileges: [],
    });

    const change = new CreateServer({
      server,
    });

    expect(change.serialize()).toBe(
      "-- WARNING: Server contains options (host, port)\n-- Replace placeholders below or run ALTER SERVER test_server after this script\nCREATE SERVER test_server TYPE 'postgres_fdw' VERSION '1.0' FOREIGN DATA WRAPPER test_fdw OPTIONS (host '__OPTION_HOST__', port '__OPTION_PORT__')",
    );
  });
});
