CREATE SCHEMA "app" AUTHORIZATION "postgres"

CREATE EXTENSION "citext" SCHEMA "extensions"

CREATE EXTENSION "pg_cron"

CREATE EXTENSION "pg_trgm" SCHEMA "extensions"

CREATE TABLE "app"."accounts" ("avatar_id" uuid, "bio" text, "created_at" timestamp with time zone NOT NULL DEFAULT now(), "display_name" text, "id" uuid NOT NULL)

ALTER TABLE "app"."accounts" ENABLE ROW LEVEL SECURITY

CREATE TABLE "app"."handle_registry" ("created_at" timestamp with time zone NOT NULL DEFAULT now(), "is_organization" boolean NOT NULL)

CREATE TABLE "app"."members" ("account_id" uuid NOT NULL, "created_at" timestamp with time zone NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL)

ALTER TABLE "app"."members" ENABLE ROW LEVEL SECURITY

CREATE TABLE "app"."organizations" ("avatar_id" uuid, "bio" text, "created_at" timestamp with time zone NOT NULL DEFAULT now(), "display_name" text, "id" uuid NOT NULL DEFAULT gen_random_uuid())

ALTER TABLE "app"."organizations" ENABLE ROW LEVEL SECURITY

CREATE TABLE "app"."package_upgrades" ("created_at" timestamp with time zone NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT gen_random_uuid(), "package_id" uuid NOT NULL, "sql" character varying(250000))

ALTER TABLE "app"."package_upgrades" ENABLE ROW LEVEL SECURITY

CREATE TABLE "app"."package_versions" ("created_at" timestamp with time zone NOT NULL DEFAULT now(), "description_md" character varying(250000), "id" uuid NOT NULL DEFAULT gen_random_uuid(), "package_id" uuid NOT NULL, "sql" character varying(250000))

ALTER TABLE "app"."package_versions" ENABLE ROW LEVEL SECURITY

CREATE TABLE "app"."packages" ("control_description" character varying(1000), "control_relocatable" boolean NOT NULL DEFAULT false, "control_requires" character varying(128)[] DEFAULT '{}'::character varying(128)[], "created_at" timestamp with time zone NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT gen_random_uuid())

ALTER TABLE "app"."packages" ENABLE ROW LEVEL SECURITY

ALTER TABLE "app"."accounts" ADD COLUMN "is_organization" boolean GENERATED ALWAYS AS (false) STORED

ALTER TABLE "app"."organizations" ADD COLUMN "is_organization" boolean GENERATED ALWAYS AS (true) STORED

CREATE DOMAIN "app"."email_address" AS citext

ALTER TABLE "app"."accounts" ADD COLUMN "contact_email" app.email_address

ALTER TABLE "app"."organizations" ADD COLUMN "contact_email" app.email_address

CREATE DOMAIN "app"."valid_name" AS citext

ALTER TABLE "app"."accounts" ADD COLUMN "handle" app.valid_name NOT NULL

ALTER TABLE "app"."handle_registry" ADD COLUMN "handle" app.valid_name NOT NULL

ALTER TABLE "app"."organizations" ADD COLUMN "handle" app.valid_name NOT NULL

ALTER TABLE "app"."packages" ADD COLUMN "handle" app.valid_name NOT NULL

ALTER TABLE "app"."packages" ADD COLUMN "partial_name" app.valid_name NOT NULL

CREATE TYPE "app"."membership_role" AS ENUM ('maintainer')

ALTER TABLE "app"."members" ADD COLUMN "role" app.membership_role NOT NULL

CREATE TYPE "app"."semver_struct" AS ("major" smallint, "minor" smallint, "patch" smallint)

CREATE DOMAIN "app"."semver" AS app.semver_struct

ALTER TABLE "app"."package_upgrades" ADD COLUMN "from_version_struct" app.semver NOT NULL

ALTER TABLE "app"."package_upgrades" ADD COLUMN "to_version_struct" app.semver NOT NULL

ALTER TABLE "app"."package_versions" ADD COLUMN "version_struct" app.semver NOT NULL

CREATE OR REPLACE FUNCTION app.exception(message text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
        begin
                raise exception using errcode='22000', message=message;
        end;
        $function$


CREATE OR REPLACE FUNCTION app.is_handle_maintainer(account_id uuid, handle app.valid_name)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
    select
        exists(
            select
                1
            from
                app.accounts acc
            where
                acc.id = $1
                and acc.handle = $2
        )
        or exists(
            select
                1
            from
                app.organizations o
                join app.members m
                    on o.id = m.organization_id
            where
                m.role = 'maintainer'
                and m.account_id = $1
                and o.handle = $2
            )
$function$


CREATE OR REPLACE FUNCTION app.is_organization_maintainer(account_id uuid, organization_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
    -- Does the currently authenticated user have permission to admin orgs and org members?
    select
        exists(
            select
                1
            from
                app.members m
            where
                m.account_id = $1
                and m.organization_id = $2
                and m.role = 'maintainer'
        )
$function$


CREATE OR REPLACE FUNCTION app.is_package_maintainer(account_id uuid, package_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
    select
        exists(
            select
                1
            from
                app.accounts acc
                join app.packages p
                    on acc.handle = p.handle
            where
                acc.id = $1
                and p.id = $2
        )
        or exists(
            -- current user is maintainer of org that owns the package
            select
                1
            from
                app.packages p
                join app.organizations o
                    on p.handle = o.handle
                join app.members m
                    on o.id = m.organization_id
            where
                m.role = 'maintainer'
                and m.account_id = $1
                and p.id = $2
            )
$function$


CREATE OR REPLACE FUNCTION app.is_package_version_maintainer(account_id uuid, package_version_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
    select
        app.is_package_maintainer($1, pv.package_id)
    from
        app.package_versions pv
    where
        pv.id = $2
$function$


CREATE OR REPLACE FUNCTION app.is_valid(app.semver_struct)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
    select (
        ($1).major is not null
        and ($1).minor is not null
        and ($1).patch is not null
    )
$function$


CREATE OR REPLACE FUNCTION app.register_account()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
    begin
        insert into app.handle_registry (handle, is_organization)
          values (
            new.raw_user_meta_data ->> 'handle',
            false
          );

        insert into app.accounts (id, handle, display_name, bio, contact_email)
          values (
            new.id,
            new.raw_user_meta_data ->> 'handle',
            new.raw_user_meta_data ->> 'display_name',
            new.raw_user_meta_data ->> 'bio',
            new.raw_user_meta_data ->> 'contact_email'
          );
          return new;
    end;
    $function$


CREATE OR REPLACE FUNCTION app.register_organization_creator_as_member()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
    begin
        insert into app.members(organization_id, account_id, role)
        values (new.id, auth.uid(), 'maintainer');

        return new;
    end;
    $function$


CREATE OR REPLACE FUNCTION app.semver_exception(version text)
 RETURNS app.semver_struct
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
begin
    raise exception using errcode='22000', message=format('Invalid semver %L', version);
end;
$function$


CREATE OR REPLACE FUNCTION app.semver_to_text(app.semver)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
    select
        format('%s.%s.%s', $1.major, $1.minor, $1.patch)
$function$


ALTER TABLE "app"."package_upgrades" ADD COLUMN "from_version" text GENERATED ALWAYS AS (app.semver_to_text(from_version_struct)) STORED NOT NULL

ALTER TABLE "app"."package_upgrades" ADD COLUMN "to_version" text GENERATED ALWAYS AS (app.semver_to_text(to_version_struct)) STORED NOT NULL

ALTER TABLE "app"."package_versions" ADD COLUMN "version" text GENERATED ALWAYS AS (app.semver_to_text(version_struct)) STORED NOT NULL

CREATE OR REPLACE FUNCTION app.simulate_login(email citext)
 RETURNS void
 LANGUAGE sql
AS $function$
    /*
    Simulated JWT of logged in user
    */

    select
        set_config(
            'request.jwt.claims',
            (
                select
                    json_build_object(
                        'sub',
                        id,
                        'role',
                        'authenticated'
                    )::text
                from
                    auth.users
                where
                    email = $1
            ),
            true
        ),
        set_config('role', 'authenticated', true)
$function$


CREATE OR REPLACE FUNCTION app.text_to_semver(text)
 RETURNS app.semver_struct
 LANGUAGE sql
 IMMUTABLE STRICT
AS $function$
    with s(version) as (
        select (
            split_part($1, '.', 1),
            split_part($1, '.', 2),
            split_part(split_part(split_part($1, '.', 3), '-', 1), '+', 1)
        )::app.semver_struct
    )
    select
        case app.is_valid(s.version)
            when true then s.version
            else app.semver_exception($1)
       end
    from
        s
$function$


CREATE OR REPLACE FUNCTION app.to_package_name(handle app.valid_name, partial_name app.valid_name)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
    select format('%s-%s', $1, $2)
$function$


ALTER TABLE "app"."packages" ADD COLUMN "package_name" text GENERATED ALWAYS AS (app.to_package_name(handle, partial_name)) STORED NOT NULL

CREATE OR REPLACE FUNCTION app.update_avatar_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
    declare
        v_handle app.valid_name;
        v_affected_account app.accounts := null;
    begin
        select (string_to_array(new.name, '-'::text))[1]::app.valid_name into v_handle;

        update app.accounts
        set avatar_id = new.id
        where handle = v_handle
        returning * into v_affected_account;

        if not v_affected_account is null then
            update auth.users u
            set
                "raw_user_meta_data" = u.raw_user_meta_data || jsonb_build_object(
                    'avatar_path', new.name
                )
            where u.id = v_affected_account.id;
        else
            update app.organizations
            set avatar_id = new.id
            where handle = v_handle;
        end if;

        return new;
    end;
    $function$


CREATE OR REPLACE FUNCTION app.version_text_to_handle(version text)
 RETURNS app.valid_name
 LANGUAGE sql
 IMMUTABLE
AS $function$
    select split_part($1, '-', 1)
$function$


CREATE OR REPLACE FUNCTION app.version_text_to_package_partial_name(version text)
 RETURNS app.valid_name
 LANGUAGE sql
 IMMUTABLE
AS $function$
    select split_part($1, '--', 2)
$function$


ALTER TABLE "app"."accounts" ADD CONSTRAINT "accounts_avatar_id_fkey" FOREIGN KEY (avatar_id) REFERENCES storage.objects(id)

ALTER TABLE "app"."accounts" ADD CONSTRAINT "accounts_bio_check" CHECK ((length(bio) <= 512))

ALTER TABLE "app"."accounts" ADD CONSTRAINT "accounts_display_name_check" CHECK ((length(display_name) <= 128))

ALTER TABLE "app"."accounts" ADD CONSTRAINT "accounts_handle_key" UNIQUE (handle)

ALTER TABLE "app"."accounts" ADD CONSTRAINT "accounts_id_fkey" FOREIGN KEY (id) REFERENCES users(id)

ALTER TABLE "app"."accounts" ADD CONSTRAINT "accounts_pkey" PRIMARY KEY (id)

ALTER DOMAIN "app"."email_address" ADD CONSTRAINT "email_address_check" CHECK ((VALUE ~ '^[a-zA-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$'::citext))

ALTER TABLE "app"."handle_registry" ADD CONSTRAINT "handle_registry_handle_is_organization_key" UNIQUE (handle, is_organization)

ALTER TABLE "app"."accounts" ADD CONSTRAINT "fk_handle_registry" FOREIGN KEY (handle, is_organization) REFERENCES app.handle_registry(handle, is_organization)

ALTER TABLE "app"."handle_registry" ADD CONSTRAINT "handle_registry_pkey" PRIMARY KEY (handle)

ALTER TABLE "app"."members" ADD CONSTRAINT "members_account_id_fkey" FOREIGN KEY (account_id) REFERENCES app.accounts(id)

ALTER TABLE "app"."members" ADD CONSTRAINT "members_organization_id_account_id_key" UNIQUE (organization_id, account_id)

ALTER TABLE "app"."members" ADD CONSTRAINT "members_pkey" PRIMARY KEY (id)

ALTER TABLE "app"."organizations" ADD CONSTRAINT "fk_handle_registry" FOREIGN KEY (handle, is_organization) REFERENCES app.handle_registry(handle, is_organization)

ALTER TABLE "app"."organizations" ADD CONSTRAINT "organizations_avatar_id_fkey" FOREIGN KEY (avatar_id) REFERENCES storage.objects(id)

ALTER TABLE "app"."organizations" ADD CONSTRAINT "organizations_bio_check" CHECK ((length(bio) <= 512))

ALTER TABLE "app"."organizations" ADD CONSTRAINT "organizations_display_name_check" CHECK ((length(display_name) <= 128))

ALTER TABLE "app"."organizations" ADD CONSTRAINT "organizations_handle_key" UNIQUE (handle)

ALTER TABLE "app"."organizations" ADD CONSTRAINT "organizations_pkey" PRIMARY KEY (id)

ALTER TABLE "app"."members" ADD CONSTRAINT "members_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES app.organizations(id)

ALTER TABLE "app"."package_upgrades" ADD CONSTRAINT "package_upgrades_package_id_from_version_struct_to_version__key" UNIQUE (package_id, from_version_struct, to_version_struct)

ALTER TABLE "app"."package_upgrades" ADD CONSTRAINT "package_upgrades_pkey" PRIMARY KEY (id)

ALTER TABLE "app"."package_versions" ADD CONSTRAINT "package_versions_package_id_version_struct_key" UNIQUE (package_id, version_struct)

ALTER TABLE "app"."package_versions" ADD CONSTRAINT "package_versions_pkey" PRIMARY KEY (id)

ALTER TABLE "app"."packages" ADD CONSTRAINT "packages_handle_fkey" FOREIGN KEY (handle) REFERENCES app.handle_registry(handle)

ALTER TABLE "app"."packages" ADD CONSTRAINT "packages_handle_partial_name_key" UNIQUE (handle, partial_name)

ALTER TABLE "app"."packages" ADD CONSTRAINT "packages_pkey" PRIMARY KEY (id)

ALTER TABLE "app"."package_upgrades" ADD CONSTRAINT "package_upgrades_package_id_fkey" FOREIGN KEY (package_id) REFERENCES app.packages(id)

ALTER TABLE "app"."package_versions" ADD CONSTRAINT "package_versions_package_id_fkey" FOREIGN KEY (package_id) REFERENCES app.packages(id)

ALTER DOMAIN "app"."semver" ADD CONSTRAINT "semver_check" CHECK (app.is_valid(VALUE))

ALTER DOMAIN "app"."valid_name" ADD CONSTRAINT "valid_name_check" CHECK ((VALUE ~ '^[A-z][A-z0-9\_]{2,32}$'::citext))

CREATE VIEW "public"."accounts" AS  SELECT acc.id,
    acc.handle,
    obj.name AS avatar_path,
    acc.display_name,
    acc.bio,
    acc.contact_email,
    acc.created_at
   FROM (app.accounts acc
     LEFT JOIN storage.objects obj ON ((acc.avatar_id = obj.id)));

CREATE VIEW "public"."members" AS  SELECT aio.organization_id,
    aio.account_id,
    aio.role,
    aio.created_at
   FROM app.members aio;

CREATE VIEW "public"."organizations" AS  SELECT org.id,
    org.handle,
    obj.name AS avatar_path,
    org.display_name,
    org.bio,
    org.contact_email,
    org.created_at
   FROM (app.organizations org
     LEFT JOIN storage.objects obj ON ((org.avatar_id = obj.id)));

CREATE VIEW "public"."package_upgrades" AS  SELECT pu.id,
    pu.package_id,
    pa.package_name,
    pu.from_version,
    pu.to_version,
    pu.sql,
    pu.created_at
   FROM (app.packages pa
     JOIN app.package_upgrades pu ON ((pa.id = pu.package_id)));

CREATE VIEW "public"."package_versions" AS  SELECT pv.id,
    pv.package_id,
    pa.package_name,
    pv.version,
    pv.sql,
    pv.description_md,
    pa.control_description,
    pa.control_requires,
    pv.created_at
   FROM (app.packages pa
     JOIN app.package_versions pv ON ((pa.id = pv.package_id)));

CREATE VIEW "public"."packages" AS  SELECT pa.id,
    pa.package_name,
    pa.handle,
    pa.partial_name,
    newest_ver.version AS latest_version,
    newest_ver.description_md,
    pa.control_description,
    pa.control_requires,
    pa.created_at
   FROM app.packages pa,
    LATERAL ( SELECT pv.id,
            pv.package_id,
            pv.version_struct,
            pv.version,
            pv.sql,
            pv.description_md,
            pv.created_at
           FROM app.package_versions pv
          WHERE (pv.package_id = pa.id)
          ORDER BY pv.version_struct
         LIMIT 1) newest_ver;

CREATE OR REPLACE FUNCTION public.search_packages(handle citext DEFAULT NULL::citext, partial_name citext DEFAULT NULL::citext)
 RETURNS SETOF packages
 LANGUAGE sql
 STABLE
AS $function$
    select *
    from public.packages
    where
        ($1 is null or handle <% $1 or handle ~ $1)
        and
        ($2 is null or partial_name <% $2 or partial_name ~ $2)
    order by
        coalesce(extensions.similarity($1, handle), 0) + coalesce(extensions.similarity($2, partial_name), 0) desc,
        created_at desc;
$function$


CREATE INDEX packages_handle_search_idx ON app.packages USING gin (handle gin_trgm_ops)

CREATE INDEX packages_partial_name_search_idx ON app.packages USING gin (partial_name gin_trgm_ops)

CREATE TRIGGER on_app_organization_created AFTER INSERT ON app.organizations FOR EACH ROW EXECUTE FUNCTION app.register_organization_creator_as_member()

CREATE POLICY "accounts_select_policy" ON "app"."accounts" FOR SELECT TO "authenticated" USING (true)

CREATE POLICY "accounts_update_policy" ON "app"."accounts" FOR UPDATE TO "authenticated" USING ((id = uid()))

CREATE POLICY "members_delete_policy" ON "app"."members" FOR DELETE TO "authenticated" USING (app.is_organization_maintainer(uid(), organization_id))

CREATE POLICY "members_insert_policy" ON "app"."members" FOR INSERT TO "authenticated" WITH CHECK (app.is_organization_maintainer(uid(), organization_id))

CREATE POLICY "members_select_policy" ON "app"."members" FOR SELECT TO "authenticated" USING (true)

CREATE POLICY "organizations_insert_policy" ON "app"."organizations" FOR INSERT TO "authenticated" WITH CHECK (true)

CREATE POLICY "organizations_select_policy" ON "app"."organizations" FOR SELECT TO "authenticated" USING (true)

CREATE POLICY "organizations_update_policy" ON "app"."organizations" FOR UPDATE TO "authenticated" USING (app.is_organization_maintainer(uid(), id))

CREATE POLICY "package_upgrades_insert_policy" ON "app"."package_upgrades" FOR INSERT TO "authenticated" WITH CHECK (app.is_package_maintainer(uid(), package_id))

CREATE POLICY "package_upgrades_select_policy" ON "app"."package_upgrades" FOR SELECT TO PUBLIC USING (true)

CREATE POLICY "package_upgrades_update_policy" ON "app"."package_upgrades" FOR UPDATE TO "authenticated" USING (app.is_package_maintainer(uid(), package_id))

CREATE POLICY "package_versions_insert_policy" ON "app"."package_versions" FOR INSERT TO "authenticated" WITH CHECK (app.is_package_maintainer(uid(), package_id))

CREATE POLICY "package_versions_select_policy" ON "app"."package_versions" FOR SELECT TO PUBLIC USING (true)

CREATE POLICY "package_versions_update_policy" ON "app"."package_versions" FOR UPDATE TO "authenticated" USING (app.is_package_maintainer(uid(), package_id))

CREATE POLICY "package_insert_policy" ON "app"."packages" FOR INSERT TO "authenticated" WITH CHECK (app.is_handle_maintainer(uid(), handle))

CREATE POLICY "packages_select_policy" ON "app"."packages" FOR SELECT TO "authenticated" USING (true)

COMMENT ON EXTENSION "citext" IS 'data type for case-insensitive character strings'

COMMENT ON EXTENSION "pg_cron" IS 'Job scheduler for PostgreSQL'

COMMENT ON EXTENSION "pg_trgm" IS 'text similarity measurement and index searching based on trigrams'

GRANT EXECUTE ON FUNCTION "public"."search_packages"(citext, citext) TO "anon"

GRANT EXECUTE ON FUNCTION "public"."search_packages"(citext, citext) TO "authenticated"

GRANT EXECUTE ON FUNCTION "public"."search_packages"(citext, citext) TO "service_role"

GRANT USAGE ON SCHEMA "app" TO "anon"

GRANT USAGE ON SCHEMA "app" TO "authenticated"

GRANT SELECT ON TABLE "app"."accounts" TO "anon"

GRANT SELECT ON TABLE "app"."accounts" TO "authenticated"

GRANT SELECT ON TABLE "app"."handle_registry" TO "anon"

GRANT SELECT ON TABLE "app"."handle_registry" TO "authenticated"

GRANT SELECT ON TABLE "app"."members" TO "anon"

GRANT DELETE, SELECT ON TABLE "app"."members" TO "authenticated"

GRANT SELECT ON TABLE "app"."organizations" TO "anon"

GRANT SELECT ON TABLE "app"."organizations" TO "authenticated"

GRANT SELECT ON TABLE "app"."package_upgrades" TO "anon"

GRANT SELECT ON TABLE "app"."package_upgrades" TO "authenticated"

GRANT SELECT ON TABLE "app"."package_versions" TO "anon"

GRANT SELECT ON TABLE "app"."package_versions" TO "authenticated"

GRANT SELECT ON TABLE "app"."packages" TO "anon"

GRANT SELECT ON TABLE "app"."packages" TO "authenticated"

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."accounts" TO "anon"

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."accounts" TO "authenticated"

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."accounts" TO "service_role"

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."members" TO "anon"

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."members" TO "authenticated"

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."members" TO "service_role"

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."organizations" TO "anon"

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."organizations" TO "authenticated"

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."organizations" TO "service_role"

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."package_upgrades" TO "anon"

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."package_upgrades" TO "authenticated"

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."package_upgrades" TO "service_role"

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."package_versions" TO "anon"

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."package_versions" TO "authenticated"

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."package_versions" TO "service_role"

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."packages" TO "anon"

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."packages" TO "authenticated"

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."packages" TO "service_role"

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "app" GRANT SELECT ON TABLES TO "anon"

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "app" GRANT SELECT ON TABLES TO "authenticated"