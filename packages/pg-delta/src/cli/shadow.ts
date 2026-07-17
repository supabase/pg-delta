/**
 * Re-export co-located shadow provisioning from the public frontend module so
 * existing CLI imports (`./shadow.ts`) keep working.
 */
export {
  provisionCoLocatedShadow,
  isShadowProvisionError,
  withDatabaseName,
  type CoLocatedShadow,
} from "../frontends/shadow.ts";
