import * as migration_20260519_103000_add_stencil_column from './20260519_103000_add_stencil_column';

export const migrations = [
  {
    up: migration_20260519_103000_add_stencil_column.up,
    down: migration_20260519_103000_add_stencil_column.down,
    name: '20260519_103000_add_stencil_column'
  },
];