import type { Pool } from "pg";
import { lit, qid } from "./ident.ts";

export type RoleMembership = {
  role: string;
  member: string;
  adminOption: boolean;
};

export type RoleSetting = {
  /** `null` means cluster-wide (`pg_db_role_setting.setdatabase = 0`). */
  database: string | null;
  role: string;
  setconfig: string[];
};

export type RoleAttributes = {
  name: string;
  rolsuper: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolcanlogin: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
  rolinherit: boolean;
  rolconnlimit: number;
};

export type LedgerSnapshot = {
  roles: string[];
  roleAttrs: RoleAttributes[];
  memberships: RoleMembership[];
  settings: RoleSetting[];
};

export type LedgerDiff = {
  createdRoles: string[];
  droppedRoles: string[];
  addedMemberships: RoleMembership[];
  removedMemberships: RoleMembership[];
  addedSettings: RoleSetting[];
  removedSettings: RoleSetting[];
};

const membershipKey = (m: RoleMembership): string =>
  `${m.role}\0${m.member}\0${m.adminOption ? "1" : "0"}`;

const settingKey = (s: RoleSetting): string =>
  `${s.database ?? ""}\0${s.role}\0${s.setconfig.join("\n")}`;

const sortRoles = (roles: string[]): string[] => [...roles].sort();

const sortMemberships = (memberships: RoleMembership[]): RoleMembership[] =>
  [...memberships].sort((a, b) =>
    membershipKey(a).localeCompare(membershipKey(b)),
  );

const sortSettings = (settings: RoleSetting[]): RoleSetting[] =>
  [...settings].sort((a, b) => settingKey(a).localeCompare(settingKey(b)));

export const ledgerDiffIsEmpty = (diff: LedgerDiff): boolean =>
  diff.createdRoles.length === 0 &&
  diff.droppedRoles.length === 0 &&
  diff.addedMemberships.length === 0 &&
  diff.removedMemberships.length === 0 &&
  diff.addedSettings.length === 0 &&
  diff.removedSettings.length === 0;

export const diffLedger = (
  before: LedgerSnapshot,
  after: LedgerSnapshot,
): LedgerDiff => {
  const beforeRoles = new Set(before.roles);
  const afterRoles = new Set(after.roles);
  const beforeMembers = new Map(
    before.memberships.map((m) => [membershipKey(m), m]),
  );
  const afterMembers = new Map(
    after.memberships.map((m) => [membershipKey(m), m]),
  );
  const beforeSettings = new Map(
    before.settings.map((s) => [settingKey(s), s]),
  );
  const afterSettings = new Map(after.settings.map((s) => [settingKey(s), s]));

  return {
    createdRoles: sortRoles([...afterRoles].filter((r) => !beforeRoles.has(r))),
    droppedRoles: sortRoles([...beforeRoles].filter((r) => !afterRoles.has(r))),
    addedMemberships: sortMemberships(
      [...afterMembers.entries()]
        .filter(([k]) => !beforeMembers.has(k))
        .map(([, m]) => m),
    ),
    removedMemberships: sortMemberships(
      [...beforeMembers.entries()]
        .filter(([k]) => !afterMembers.has(k))
        .map(([, m]) => m),
    ),
    addedSettings: sortSettings(
      [...afterSettings.entries()]
        .filter(([k]) => !beforeSettings.has(k))
        .map(([, s]) => s),
    ),
    removedSettings: sortSettings(
      [...beforeSettings.entries()]
        .filter(([k]) => !afterSettings.has(k))
        .map(([, s]) => s),
    ),
  };
};

export const snapshotLedger = async (admin: Pool): Promise<LedgerSnapshot> => {
  // `pg_roles` is the CREATEDB-readable catalog; `pg_authid` is superuser-only.
  const roles = await admin.query<{
    rolname: string;
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolcanlogin: boolean;
    rolreplication: boolean;
    rolbypassrls: boolean;
    rolinherit: boolean;
    rolconnlimit: number;
  }>(
    `SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolcanlogin,
            rolreplication, rolbypassrls, rolinherit, rolconnlimit
     FROM pg_roles ORDER BY 1`,
  );
  const memberships = await admin.query<{
    role: string;
    member: string;
    admin_option: boolean;
  }>(`
    SELECT r.rolname AS role, m.rolname AS member, am.admin_option
    FROM pg_auth_members am
    JOIN pg_roles r ON r.oid = am.roleid
    JOIN pg_roles m ON m.oid = am.member
    ORDER BY 1, 2, 3`);
  const settings = await admin.query<{
    database: string | null;
    role: string;
    setconfig: string[] | null;
  }>(`
    SELECT
      CASE WHEN s.setdatabase = 0 THEN NULL ELSE d.datname END AS database,
      r.rolname AS role,
      s.setconfig
    FROM pg_db_role_setting s
    JOIN pg_roles r ON r.oid = s.setrole
    LEFT JOIN pg_database d ON d.oid = s.setdatabase
    ORDER BY 1, 2`);

  return {
    roles: roles.rows.map((r) => r.rolname),
    roleAttrs: roles.rows.map((r) => ({
      name: r.rolname,
      rolsuper: r.rolsuper,
      rolcreatedb: r.rolcreatedb,
      rolcreaterole: r.rolcreaterole,
      rolcanlogin: r.rolcanlogin,
      rolreplication: r.rolreplication,
      rolbypassrls: r.rolbypassrls,
      rolinherit: r.rolinherit,
      rolconnlimit: r.rolconnlimit,
    })),
    memberships: memberships.rows.map((m) => ({
      role: m.role,
      member: m.member,
      adminOption: m.admin_option,
    })),
    settings: settings.rows.map((s) => ({
      database: s.database,
      role: s.role,
      setconfig: s.setconfig ?? [],
    })),
  };
};

const attrsSql = (attrs: RoleAttributes): string =>
  [
    attrs.rolsuper ? "SUPERUSER" : "NOSUPERUSER",
    attrs.rolcreatedb ? "CREATEDB" : "NOCREATEDB",
    attrs.rolcreaterole ? "CREATEROLE" : "NOCREATEROLE",
    attrs.rolcanlogin ? "LOGIN" : "NOLOGIN",
    attrs.rolreplication ? "REPLICATION" : "NOREPLICATION",
    attrs.rolbypassrls ? "BYPASSRLS" : "NOBYPASSRLS",
    attrs.rolinherit ? "INHERIT" : "NOINHERIT",
    `CONNECTION LIMIT ${String(attrs.rolconnlimit)}`,
  ].join(" ");

const attrsEqual = (a: RoleAttributes, b: RoleAttributes): boolean =>
  a.rolsuper === b.rolsuper &&
  a.rolcreatedb === b.rolcreatedb &&
  a.rolcreaterole === b.rolcreaterole &&
  a.rolcanlogin === b.rolcanlogin &&
  a.rolreplication === b.rolreplication &&
  a.rolbypassrls === b.rolbypassrls &&
  a.rolinherit === b.rolinherit &&
  a.rolconnlimit === b.rolconnlimit;

const GUC_KEY = /^[A-Za-z_][A-Za-z0-9_.]*$/;

const alterRoleTarget = (setting: RoleSetting): string =>
  setting.database === null
    ? `ALTER ROLE ${qid(setting.role)}`
    : `ALTER ROLE ${qid(setting.role)} IN DATABASE ${qid(setting.database)}`;

const applySetting = async (
  admin: Pool,
  setting: RoleSetting,
): Promise<void> => {
  const target = alterRoleTarget(setting);
  await admin.query(`${target} RESET ALL`);
  for (const entry of setting.setconfig) {
    const eq = entry.indexOf("=");
    if (eq < 0) continue;
    const key = entry.slice(0, eq);
    const value = entry.slice(eq + 1);
    if (!GUC_KEY.test(key)) continue;
    await admin.query(`${target} SET ${key} TO ${lit(value)}`);
  }
};

export class LedgerRevertError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(`ledger revert incomplete: ${errors.join("; ")}`);
    this.name = "LedgerRevertError";
    this.errors = errors;
  }
}

/**
 * Restore cluster-scope roles, memberships, and `pg_db_role_setting` rows
 * to `before`. Best-effort per statement; throws {@link LedgerRevertError}
 * if any step fails. Drop the replay database first when created roles own
 * objects in it — `DROP ROLE` cannot run while those objects exist.
 */
export const revertLedger = async (
  admin: Pool,
  before: LedgerSnapshot,
): Promise<void> => {
  const after = await snapshotLedger(admin);
  const diff = diffLedger(before, after);
  const errors: string[] = [];
  const session = await admin.query<{ current_user: string }>(
    `SELECT current_user`,
  );
  const currentUser = session.rows[0]?.current_user;

  const trySql = async (sql: string, what: string): Promise<void> => {
    try {
      await admin.query(sql);
    } catch (error) {
      errors.push(
        `${what}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  for (const m of diff.addedMemberships) {
    await trySql(
      `REVOKE ${qid(m.role)} FROM ${qid(m.member)}`,
      `revoke ${m.role} FROM ${m.member}`,
    );
  }

  for (const role of diff.createdRoles) {
    if (role === currentUser || role.startsWith("pg_")) continue;
    await trySql(`DROP ROLE IF EXISTS ${qid(role)}`, `drop role ${role}`);
  }

  for (const role of diff.droppedRoles) {
    if (role.startsWith("pg_")) continue;
    await trySql(`CREATE ROLE ${qid(role)}`, `recreate role ${role}`);
  }

  for (const m of diff.removedMemberships) {
    await trySql(
      `GRANT ${qid(m.role)} TO ${qid(m.member)}${m.adminOption ? " WITH ADMIN OPTION" : ""}`,
      `grant ${m.role} TO ${m.member}`,
    );
  }

  const now = await snapshotLedger(admin);
  const remainingRoles = new Set(now.roles);
  const wantAttrs = new Map(before.roleAttrs.map((a) => [a.name, a]));
  for (const current of now.roleAttrs) {
    if (current.name === currentUser || current.name.startsWith("pg_")) {
      continue;
    }
    const want = wantAttrs.get(current.name);
    if (want === undefined || attrsEqual(want, current)) continue;
    await trySql(
      `ALTER ROLE ${qid(current.name)} WITH ${attrsSql(want)}`,
      `restore attributes for ${current.name}`,
    );
  }
  const settingsByTarget = new Map<string, RoleSetting>();
  for (const setting of before.settings) {
    if (!remainingRoles.has(setting.role)) continue;
    settingsByTarget.set(`${setting.database ?? ""}\0${setting.role}`, setting);
  }
  for (const setting of now.settings) {
    const key = `${setting.database ?? ""}\0${setting.role}`;
    if (settingsByTarget.has(key)) continue;
    if (!remainingRoles.has(setting.role)) continue;
    settingsByTarget.set(key, {
      database: setting.database,
      role: setting.role,
      setconfig: [],
    });
  }
  for (const setting of settingsByTarget.values()) {
    try {
      await applySetting(admin, setting);
    } catch (error) {
      errors.push(
        `restore settings for ${setting.role}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (errors.length > 0) {
    throw new LedgerRevertError(errors);
  }
};
