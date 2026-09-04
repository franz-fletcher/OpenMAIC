/**
 * Role configuration loader. Reads ADMIN_EMAILS env and optional
 * server-roles.yml to build the default role grants.
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export interface RoleDefaults {
  adminEmails: string[];
}

const DEFAULT_FILENAME = 'server-roles.yml';

/**
 * Loads role defaults from ADMIN_EMAILS env and server-roles.yml.
 * Env wins over yaml when both are set.
 */
export function loadRoleDefaults(): RoleDefaults {
  const envEmails = process.env.ADMIN_EMAILS;

  let yamlEmails: string[] = [];
  try {
    const filePath = path.join(process.cwd(), DEFAULT_FILENAME);
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = yaml.load(raw) as Record<string, unknown> | null;
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.adminEmails)) {
        yamlEmails = (parsed.adminEmails as unknown[])
          .map((e) => String(e).trim().toLowerCase())
          .filter(Boolean);
      }
    }
  } catch {
    // YAML load failure is non-fatal.
  }

  if (envEmails !== undefined) {
    const parsed = envEmails
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    return { adminEmails: parsed };
  }

  return { adminEmails: yamlEmails };
}
