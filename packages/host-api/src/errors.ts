/**
 * Errors thrown by `host.*` namespaces. Apps catch these by class so the
 * matching is robust across bundle/version skew.
 */

export class PermissionDeniedError extends Error {
  readonly permission: string;
  readonly appId: string;
  constructor(opts: { permission: string; appId: string; message?: string }) {
    super(
      opts.message ??
        `App "${opts.appId}" lacks permission "${opts.permission}".`,
    );
    this.name = 'PermissionDeniedError';
    this.permission = opts.permission;
    this.appId = opts.appId;
  }
}

export class AssetNotFoundError extends Error {
  readonly path: string;
  readonly appId: string;
  constructor(opts: { path: string; appId: string }) {
    super(`Asset not found in "${opts.appId}" bundle: ${opts.path}`);
    this.name = 'AssetNotFoundError';
    this.path = opts.path;
    this.appId = opts.appId;
  }
}

export class AssetTooLargeError extends Error {
  readonly path: string;
  readonly sizeBytes: number;
  readonly limitBytes: number;
  constructor(opts: { path: string; sizeBytes: number; limitBytes: number }) {
    super(
      `Asset too large: ${opts.path} (${opts.sizeBytes} bytes, limit ${opts.limitBytes}).`,
    );
    this.name = 'AssetTooLargeError';
    this.path = opts.path;
    this.sizeBytes = opts.sizeBytes;
    this.limitBytes = opts.limitBytes;
  }
}

export class AssetEscapeError extends Error {
  readonly path: string;
  constructor(path: string) {
    super(`Asset path escapes app bundle root: ${path}`);
    this.name = 'AssetEscapeError';
    this.path = path;
  }
}

export class ManifestValidationError extends Error {
  readonly issues: ReadonlyArray<{ path: string; message: string }>;
  constructor(issues: ReadonlyArray<{ path: string; message: string }>) {
    super(
      `Manifest validation failed:\n${issues
        .map((i) => `  ${i.path}: ${i.message}`)
        .join('\n')}`,
    );
    this.name = 'ManifestValidationError';
    this.issues = issues;
  }
}
