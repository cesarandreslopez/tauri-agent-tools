import { z } from 'zod';

// === tauri.conf.json (v1 + v2, partial — passthrough preserves unknown fields) ===

export const TauriBundleConfigSchema = z
  .object({
    identifier: z.string().optional(),
    externalBin: z.array(z.string()).optional(),
    targets: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .passthrough();
export type TauriBundleConfig = z.infer<typeof TauriBundleConfigSchema>;

export const TauriBuildConfigSchema = z
  .object({
    devUrl: z.string().optional(),
    devPath: z.string().optional(),
    frontendDist: z.string().optional(),
    distDir: z.string().optional(),
    beforeDevCommand: z.string().optional(),
  })
  .passthrough();
export type TauriBuildConfig = z.infer<typeof TauriBuildConfigSchema>;

export const TauriWindowConfigSchema = z
  .object({
    label: z.string().optional(),
    title: z.string().optional(),
    url: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  })
  .passthrough();
export type TauriWindowConfig = z.infer<typeof TauriWindowConfigSchema>;

export const TauriAppConfigSchema = z
  .object({
    windows: z.array(TauriWindowConfigSchema).optional(),
    security: z
      .object({
        capabilities: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])).optional(),
        csp: z.string().nullable().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type TauriAppConfig = z.infer<typeof TauriAppConfigSchema>;

export const TauriConfigSchema = z
  .object({
    identifier: z.string().optional(),
    productName: z.string().optional(),
    version: z.string().optional(),
    mainBinaryName: z.string().optional(),
    build: TauriBuildConfigSchema.optional(),
    bundle: TauriBundleConfigSchema.optional(),
    app: TauriAppConfigSchema.optional(),
    tauri: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export type TauriConfig = z.infer<typeof TauriConfigSchema>;

// === Tauri capability files (capabilities/*.json) ===

export const CapabilityPermissionSchema = z.union([
  z.string(),
  z
    .object({
      identifier: z.string(),
      allow: z.array(z.unknown()).optional(),
      deny: z.array(z.unknown()).optional(),
    })
    .passthrough(),
]);
export type CapabilityPermission = z.infer<typeof CapabilityPermissionSchema>;

export const CapabilitySchema = z
  .object({
    identifier: z.string(),
    description: z.string().optional(),
    windows: z.array(z.string()).optional(),
    webviews: z.array(z.string()).optional(),
    platforms: z.array(z.string()).optional(),
    permissions: z.array(CapabilityPermissionSchema).default([]),
    local: z.boolean().optional(),
    remote: z.unknown().optional(),
  })
  .passthrough();
export type Capability = z.infer<typeof CapabilitySchema>;

// === Resolved per-platform Tauri OS dirs ===

export const TauriPathSetSchema = z.object({
  appConfigDir: z.string(),
  appDataDir: z.string(),
  appLocalDataDir: z.string(),
  appCacheDir: z.string(),
  appLogDir: z.string(),
});
export type TauriPathSet = z.infer<typeof TauriPathSetSchema>;

export const ResolvedTauriConfigSchema = z.object({
  configPath: z.string(),
  identifier: z.string(),
  productName: z.string(),
  version: z.string().nullable(),
  mainBinaryName: z.string().nullable(),
  devUrl: z.string().nullable(),
  devPort: z.number().nullable(),
  frontendDist: z.string().nullable(),
  sidecars: z.array(z.string()),
  windows: z.array(z.string()),
  capabilityFiles: z.array(z.string()),
  paths: z.object({
    darwin: TauriPathSetSchema,
    linux: TauriPathSetSchema,
    win32: TauriPathSetSchema,
  }),
  platform: z.enum(['darwin', 'linux', 'win32']),
});
export type ResolvedTauriConfig = z.infer<typeof ResolvedTauriConfigSchema>;
