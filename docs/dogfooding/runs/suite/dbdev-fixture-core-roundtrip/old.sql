SET check_function_bodies = false

CREATE SCHEMA app AUTHORIZATION postgres

GRANT USAGE ON SCHEMA app TO anon

GRANT USAGE ON SCHEMA app TO authenticated

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app GRANT SELECT ON TABLES TO anon

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app GRANT SELECT ON TABLES TO authenticated

CREATE TYPE app.membership_role AS ENUM ('maintainer')

CREATE TYPE app.semver_struct AS (major smallint, minor smallint, patch smallint)

CREATE FUNCTION app.exception(message text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
        begin
                raise exception using errcode='22000', message=message;
        end;
        $function$

CREATE FUNCTION app.is_organization_maintainer(account_id uuid, organization_id uuid)
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

CREATE FUNCTION app.is_package_maintainer(account_id uuid, package_id uuid)
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

CREATE FUNCTION app.is_package_version_maintainer(account_id uuid, package_version_id uuid)
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

CREATE FUNCTION app.is_valid(app.semver_struct)
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

CREATE DOMAIN app.semver AS app.semver_struct CHECK (app.is_valid(VALUE))

CREATE FUNCTION app.register_account()
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

CREATE FUNCTION app.register_organization_creator_as_member()
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

CREATE FUNCTION app.semver_exception(version text)
 RETURNS app.semver_struct
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
begin
    raise exception using errcode='22000', message=format('Invalid semver %L', version);
end;
$function$

CREATE FUNCTION app.semver_to_text(app.semver)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
    select
        format('%s.%s.%s', $1.major, $1.minor, $1.patch)
$function$

CREATE FUNCTION app.text_to_semver(text)
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

CREATE FUNCTION app.update_avatar_id()
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

CREATE TABLE app.members (id uuid DEFAULT uuid_generate_v4() NOT NULL, organization_id uuid NOT NULL, account_id uuid NOT NULL, role app.membership_role NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL)

ALTER TABLE app.members ENABLE ROW LEVEL SECURITY

ALTER TABLE app.members ADD CONSTRAINT members_organization_id_account_id_key UNIQUE (organization_id, account_id)

ALTER TABLE app.members ADD CONSTRAINT members_pkey PRIMARY KEY (id)

GRANT SELECT ON app.members TO anon

GRANT DELETE, SELECT ON app.members TO authenticated

GRANT INSERT (account_id, organization_id, role) ON app.members TO authenticated

CREATE POLICY members_delete_policy ON app.members FOR DELETE TO authenticated USING (app.is_organization_maintainer(uid(), organization_id))

CREATE POLICY members_insert_policy ON app.members FOR INSERT TO authenticated WITH CHECK (app.is_organization_maintainer(uid(), organization_id))

CREATE POLICY members_select_policy ON app.members FOR SELECT TO authenticated USING (true)

CREATE TABLE app.package_upgrades (id uuid DEFAULT gen_random_uuid() NOT NULL, package_id uuid NOT NULL, from_version_struct app.semver NOT NULL, from_version text GENERATED ALWAYS AS (app.semver_to_text(from_version_struct)) STORED NOT NULL, to_version_struct app.semver NOT NULL, to_version text GENERATED ALWAYS AS (app.semver_to_text(to_version_struct)) STORED NOT NULL, sql character varying(250000), created_at timestamp with time zone DEFAULT now() NOT NULL)

ALTER TABLE app.package_upgrades ENABLE ROW LEVEL SECURITY

ALTER TABLE app.package_upgrades ADD CONSTRAINT package_upgrades_package_id_from_version_struct_to_version__key UNIQUE (package_id, from_version_struct, to_version_struct)

ALTER TABLE app.package_upgrades ADD CONSTRAINT package_upgrades_pkey PRIMARY KEY (id)

GRANT SELECT ON app.package_upgrades TO anon

GRANT INSERT (from_version_struct, package_id, sql, to_version_struct) ON app.package_upgrades TO authenticated

GRANT SELECT ON app.package_upgrades TO authenticated

CREATE POLICY package_upgrades_insert_policy ON app.package_upgrades FOR INSERT TO authenticated WITH CHECK (app.is_package_maintainer(uid(), package_id))

CREATE POLICY package_upgrades_select_policy ON app.package_upgrades FOR SELECT USING (true)

CREATE POLICY package_upgrades_update_policy ON app.package_upgrades FOR UPDATE TO authenticated USING (app.is_package_maintainer(uid(), package_id))

CREATE TABLE app.package_versions (id uuid DEFAULT gen_random_uuid() NOT NULL, package_id uuid NOT NULL, version_struct app.semver NOT NULL, version text GENERATED ALWAYS AS (app.semver_to_text(version_struct)) STORED NOT NULL, sql character varying(250000), description_md character varying(250000), created_at timestamp with time zone DEFAULT now() NOT NULL)

ALTER TABLE app.package_versions ENABLE ROW LEVEL SECURITY

ALTER TABLE app.package_versions ADD CONSTRAINT package_versions_package_id_version_struct_key UNIQUE (package_id, version_struct)

ALTER TABLE app.package_versions ADD CONSTRAINT package_versions_pkey PRIMARY KEY (id)

GRANT SELECT ON app.package_versions TO anon

GRANT INSERT (description_md, package_id, sql, version_struct) ON app.package_versions TO authenticated

GRANT SELECT ON app.package_versions TO authenticated

CREATE POLICY package_versions_insert_policy ON app.package_versions FOR INSERT TO authenticated WITH CHECK (app.is_package_maintainer(uid(), package_id))

CREATE POLICY package_versions_select_policy ON app.package_versions FOR SELECT USING (true)

CREATE POLICY package_versions_update_policy ON app.package_versions FOR UPDATE TO authenticated USING (app.is_package_maintainer(uid(), package_id))

CREATE TRIGGER on_auth_user_created AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION app.register_account()

CREATE EXTENSION citext WITH SCHEMA extensions

CREATE DOMAIN app.email_address AS extensions.citext CHECK ((VALUE ~ '^[a-zA-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$'::citext))

CREATE DOMAIN app.valid_name AS extensions.citext CHECK ((VALUE ~ '^[A-z][A-z0-9\_]{2,32}$'::citext))

CREATE FUNCTION app.is_handle_maintainer(account_id uuid, handle app.valid_name)
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

CREATE FUNCTION app.simulate_login(email citext)
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

CREATE FUNCTION app.to_package_name(handle app.valid_name, partial_name app.valid_name)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
    select format('%s-%s', $1, $2)
$function$

CREATE FUNCTION app.version_text_to_handle(version text)
 RETURNS app.valid_name
 LANGUAGE sql
 IMMUTABLE
AS $function$
    select split_part($1, '-', 1)
$function$

CREATE FUNCTION app.version_text_to_package_partial_name(version text)
 RETURNS app.valid_name
 LANGUAGE sql
 IMMUTABLE
AS $function$
    select split_part($1, '--', 2)
$function$

CREATE TABLE app.accounts (id uuid NOT NULL, handle app.valid_name NOT NULL, is_organization boolean GENERATED ALWAYS AS (false) STORED, avatar_id uuid, display_name text, bio text, contact_email app.email_address, created_at timestamp with time zone DEFAULT now() NOT NULL)

ALTER TABLE app.accounts ENABLE ROW LEVEL SECURITY

ALTER TABLE app.accounts ADD CONSTRAINT accounts_avatar_id_fkey FOREIGN KEY (avatar_id) REFERENCES storage.objects(id)

ALTER TABLE app.accounts ADD CONSTRAINT accounts_bio_check CHECK (length(bio) <= 512)

ALTER TABLE app.accounts ADD CONSTRAINT accounts_display_name_check CHECK (length(display_name) <= 128)

ALTER TABLE app.accounts ADD CONSTRAINT accounts_handle_key UNIQUE (handle)

ALTER TABLE app.accounts ADD CONSTRAINT accounts_id_fkey FOREIGN KEY (id) REFERENCES users(id)

ALTER TABLE app.accounts ADD CONSTRAINT accounts_pkey PRIMARY KEY (id)

GRANT SELECT ON app.accounts TO anon

GRANT SELECT ON app.accounts TO authenticated

GRANT UPDATE (avatar_id, bio, contact_email, display_name) ON app.accounts TO authenticated

CREATE POLICY accounts_select_policy ON app.accounts FOR SELECT TO authenticated USING (true)

CREATE POLICY accounts_update_policy ON app.accounts FOR UPDATE TO authenticated USING ((id = uid()))

CREATE TABLE app.handle_registry (handle app.valid_name NOT NULL, is_organization boolean NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL)

ALTER TABLE app.handle_registry ADD CONSTRAINT handle_registry_handle_is_organization_key UNIQUE (handle, is_organization)

ALTER TABLE app.accounts ADD CONSTRAINT fk_handle_registry FOREIGN KEY (handle, is_organization) REFERENCES app.handle_registry(handle, is_organization)

ALTER TABLE app.handle_registry ADD CONSTRAINT handle_registry_pkey PRIMARY KEY (handle)

GRANT SELECT ON app.handle_registry TO anon

GRANT INSERT (handle, is_organization) ON app.handle_registry TO authenticated

GRANT SELECT ON app.handle_registry TO authenticated

ALTER TABLE app.members ADD CONSTRAINT members_account_id_fkey FOREIGN KEY (account_id) REFERENCES app.accounts(id)

CREATE TABLE app.organizations (id uuid DEFAULT gen_random_uuid() NOT NULL, handle app.valid_name NOT NULL, is_organization boolean GENERATED ALWAYS AS (true) STORED, avatar_id uuid, display_name text, bio text, contact_email app.email_address, created_at timestamp with time zone DEFAULT now() NOT NULL)

ALTER TABLE app.organizations ENABLE ROW LEVEL SECURITY

ALTER TABLE app.organizations ADD CONSTRAINT fk_handle_registry FOREIGN KEY (handle, is_organization) REFERENCES app.handle_registry(handle, is_organization)

ALTER TABLE app.organizations ADD CONSTRAINT organizations_avatar_id_fkey FOREIGN KEY (avatar_id) REFERENCES storage.objects(id)

ALTER TABLE app.organizations ADD CONSTRAINT organizations_bio_check CHECK (length(bio) <= 512)

ALTER TABLE app.organizations ADD CONSTRAINT organizations_display_name_check CHECK (length(display_name) <= 128)

ALTER TABLE app.organizations ADD CONSTRAINT organizations_handle_key UNIQUE (handle)

ALTER TABLE app.organizations ADD CONSTRAINT organizations_pkey PRIMARY KEY (id)

ALTER TABLE app.members ADD CONSTRAINT members_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES app.organizations(id)

GRANT SELECT ON app.organizations TO anon

GRANT INSERT (avatar_id, bio, contact_email, display_name, handle) ON app.organizations TO authenticated

GRANT SELECT ON app.organizations TO authenticated

GRANT UPDATE (avatar_id, bio, contact_email, display_name) ON app.organizations TO authenticated

CREATE TRIGGER on_app_organization_created AFTER INSERT ON app.organizations FOR EACH ROW EXECUTE FUNCTION app.register_organization_creator_as_member()

CREATE POLICY organizations_insert_policy ON app.organizations FOR INSERT TO authenticated WITH CHECK (true)

CREATE POLICY organizations_select_policy ON app.organizations FOR SELECT TO authenticated USING (true)

CREATE POLICY organizations_update_policy ON app.organizations FOR UPDATE TO authenticated USING (app.is_organization_maintainer(uid(), id))

CREATE TABLE app.packages (id uuid DEFAULT gen_random_uuid() NOT NULL, package_name text GENERATED ALWAYS AS (app.to_package_name(handle, partial_name)) STORED NOT NULL, handle app.valid_name NOT NULL, partial_name app.valid_name NOT NULL, control_description character varying(1000), control_relocatable boolean DEFAULT false NOT NULL, control_requires character varying(128)[] DEFAULT '{}'::character varying(128)[], created_at timestamp with time zone DEFAULT now() NOT NULL)

ALTER TABLE app.packages ENABLE ROW LEVEL SECURITY

ALTER TABLE app.packages ADD CONSTRAINT packages_handle_fkey FOREIGN KEY (handle) REFERENCES app.handle_registry(handle)

ALTER TABLE app.packages ADD CONSTRAINT packages_handle_partial_name_key UNIQUE (handle, partial_name)

ALTER TABLE app.packages ADD CONSTRAINT packages_pkey PRIMARY KEY (id)

ALTER TABLE app.package_upgrades ADD CONSTRAINT package_upgrades_package_id_fkey FOREIGN KEY (package_id) REFERENCES app.packages(id)

ALTER TABLE app.package_versions ADD CONSTRAINT package_versions_package_id_fkey FOREIGN KEY (package_id) REFERENCES app.packages(id)

GRANT SELECT ON app.packages TO anon

GRANT INSERT (handle, partial_name) ON app.packages TO authenticated

GRANT SELECT ON app.packages TO authenticated

CREATE POLICY package_insert_policy ON app.packages FOR INSERT TO authenticated WITH CHECK (app.is_handle_maintainer(uid(), handle))

CREATE POLICY packages_select_policy ON app.packages FOR SELECT TO authenticated USING (true)

CREATE EXTENSION pg_trgm WITH SCHEMA extensions

CREATE INDEX packages_partial_name_search_idx ON app.packages USING gin (partial_name gin_trgm_ops)

CREATE INDEX packages_handle_search_idx ON app.packages USING gin (handle gin_trgm_ops)

CREATE EXTENSION pg_cron WITH SCHEMA pg_catalog

CREATE VIEW public.accounts AS SELECT acc.id,
    acc.handle,
    obj.name AS avatar_path,
    acc.display_name,
    acc.bio,
    acc.contact_email,
    acc.created_at
   FROM (app.accounts acc
     LEFT JOIN storage.objects obj ON ((acc.avatar_id = obj.id)))

GRANT ALL ON public.accounts TO anon

GRANT ALL ON public.accounts TO authenticated

GRANT ALL ON public.accounts TO service_role

CREATE VIEW public.members AS SELECT aio.organization_id,
    aio.account_id,
    aio.role,
    aio.created_at
   FROM app.members aio

GRANT ALL ON public.members TO anon

GRANT ALL ON public.members TO authenticated

GRANT ALL ON public.members TO service_role

CREATE VIEW public.organizations AS SELECT org.id,
    org.handle,
    obj.name AS avatar_path,
    org.display_name,
    org.bio,
    org.contact_email,
    org.created_at
   FROM (app.organizations org
     LEFT JOIN storage.objects obj ON ((org.avatar_id = obj.id)))

GRANT ALL ON public.organizations TO anon

GRANT ALL ON public.organizations TO authenticated

GRANT ALL ON public.organizations TO service_role

CREATE VIEW public.package_upgrades AS SELECT pu.id,
    pu.package_id,
    pa.package_name,
    pu.from_version,
    pu.to_version,
    pu.sql,
    pu.created_at
   FROM (app.packages pa
     JOIN app.package_upgrades pu ON ((pa.id = pu.package_id)))

GRANT ALL ON public.package_upgrades TO anon

GRANT ALL ON public.package_upgrades TO authenticated

GRANT ALL ON public.package_upgrades TO service_role

CREATE VIEW public.package_versions AS SELECT pv.id,
    pv.package_id,
    pa.package_name,
    pv.version,
    pv.sql,
    pv.description_md,
    pa.control_description,
    pa.control_requires,
    pv.created_at
   FROM (app.packages pa
     JOIN app.package_versions pv ON ((pa.id = pv.package_id)))

GRANT ALL ON public.package_versions TO anon

GRANT ALL ON public.package_versions TO authenticated

GRANT ALL ON public.package_versions TO service_role

CREATE VIEW public.packages AS SELECT pa.id,
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
         LIMIT 1) newest_ver

CREATE FUNCTION public.search_packages(handle citext DEFAULT NULL::citext, partial_name citext DEFAULT NULL::citext)
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

GRANT ALL ON FUNCTION public.search_packages(citext, citext) TO anon

GRANT ALL ON FUNCTION public.search_packages(citext, citext) TO authenticated

GRANT ALL ON FUNCTION public.search_packages(citext, citext) TO service_role

GRANT ALL ON public.packages TO anon

GRANT ALL ON public.packages TO authenticated

GRANT ALL ON public.packages TO service_role

CREATE TRIGGER on_storage_object_created AFTER INSERT ON storage.objects FOR EACH ROW WHEN (new.bucket_id = 'avatars'::text) EXECUTE FUNCTION app.update_avatar_id()