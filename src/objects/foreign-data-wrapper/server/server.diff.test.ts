import { describe, expect, test } from "vitest";
import { DefaultPrivilegeState } from "../../base.default-privileges.ts";
import {
  AlterServerChangeOwner,
  AlterServerSetOptions,
  AlterServerSetVersion,
} from "./changes/server.alter.ts";
import { CreateServer } from "./changes/server.create.ts";
import { DropServer } from "./changes/server.drop.ts";
import { diffServers } from "./server.diff.ts";
import { Server, type ServerProps } from "./server.model.ts";

const testContext = {
  version: 170000,
  currentUser: "postgres",
  defaultPrivilegeState: new DefaultPrivilegeState({}),
  mainRoles: {},
};

describe.concurrent("server.diff", () => {
  test("create and drop", () => {
    const props: ServerProps = {
      name: "srv1",
      owner: "o1",
      foreign_data_wrapper: "fdw1",
      type: null,
      version: null,
      options: null,
      comment: null,
      privileges: [],
    };
    const server = new Server(props);

    const created = diffServers(testContext, {}, { [server.stableId]: server });
    expect(created[0]).toBeInstanceOf(CreateServer);

    const dropped = diffServers(testContext, { [server.stableId]: server }, {});
    expect(dropped[0]).toBeInstanceOf(DropServer);
  });

  test("alter: owner change", () => {
    const main = new Server({
      name: "srv1",
      owner: "o1",
      foreign_data_wrapper: "fdw1",
      type: null,
      version: null,
      options: null,
      comment: null,
      privileges: [],
    });
    const branch = new Server({
      name: "srv1",
      owner: "o2",
      foreign_data_wrapper: "fdw1",
      type: null,
      version: null,
      options: null,
      comment: null,
      privileges: [],
    });

    const changes = diffServers(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((c) => c instanceof AlterServerChangeOwner)).toBe(true);
  });

  test("alter: version change", () => {
    const main = new Server({
      name: "srv1",
      owner: "o1",
      foreign_data_wrapper: "fdw1",
      type: null,
      version: "1.0",
      options: null,
      comment: null,
      privileges: [],
    });
    const branch = new Server({
      name: "srv1",
      owner: "o1",
      foreign_data_wrapper: "fdw1",
      type: null,
      version: "2.0",
      options: null,
      comment: null,
      privileges: [],
    });

    const changes = diffServers(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((c) => c instanceof AlterServerSetVersion)).toBe(true);
  });

  test("alter: options changes", () => {
    const main = new Server({
      name: "srv1",
      owner: "o1",
      foreign_data_wrapper: "fdw1",
      type: null,
      version: null,
      options: ["host", "localhost"],
      comment: null,
      privileges: [],
    });
    const branch = new Server({
      name: "srv1",
      owner: "o1",
      foreign_data_wrapper: "fdw1",
      type: null,
      version: null,
      options: ["host", "newhost", "port", "5432"],
      comment: null,
      privileges: [],
    });

    const changes = diffServers(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    const optionsChange = changes.find(
      (c) => c instanceof AlterServerSetOptions,
    ) as AlterServerSetOptions | undefined;
    expect(optionsChange).toBeDefined();
    expect(optionsChange?.options.length).toBeGreaterThan(0);
  });

  test("type change triggers drop and create", () => {
    const main = new Server({
      name: "srv1",
      owner: "o1",
      foreign_data_wrapper: "fdw1",
      type: "old_type",
      version: null,
      options: null,
      comment: null,
      privileges: [],
    });
    const branch = new Server({
      name: "srv1",
      owner: "o1",
      foreign_data_wrapper: "fdw1",
      type: "new_type",
      version: null,
      options: null,
      comment: null,
      privileges: [],
    });

    const changes = diffServers(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    // Type change should trigger drop + create
    expect(changes.some((c) => c instanceof DropServer)).toBe(true);
    expect(changes.some((c) => c instanceof CreateServer)).toBe(true);
  });
});
