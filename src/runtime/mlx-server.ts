// src/runtime/mlx-server.ts (stub; Task 3 implements)
import { ProviderKind } from '../core/types.ts';
import type { Runtime } from './runtime.ts';

export const mlxServerRuntime: Runtime = {
  kind: ProviderKind.MlxServer,
  isAvailable: async () => false,
  createModel: () => { throw new Error('MLX runtime not implemented'); },
  control: {
    isInstalled: async () => false,
    pull: async () => { throw new Error('MLX pull not implemented'); },
    warm: async () => {},
    unload: async () => {},
    listLoaded: async () => [],
    getModelMax: async () => undefined,
  },
};
