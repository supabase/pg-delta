CREATE TABLE public.alter_function_sign_policy_dependent_profiles (
  id uuid PRIMARY KEY,
  role text
);
ALTER TABLE public.alter_function_sign_policy_dependent_profiles ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.alter_function_sign_policy_dependent_check_role(
  _id uuid, _role text, _extra text DEFAULT 'default'::text
) RETURNS boolean AS $$
BEGIN RETURN true; END;
$$ LANGUAGE plpgsql;
CREATE POLICY alter_function_sign_policy_dependent_check_role_policy
  ON public.alter_function_sign_policy_dependent_profiles
  FOR SELECT USING (
    public.alter_function_sign_policy_dependent_check_role(id, role)
  );
