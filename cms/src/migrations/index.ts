import * as migration_002_add_stencil_column from './002_add_stencil_column';
import * as migration_20260519_102507_add_stencil_column from './20260519_102507_add_stencil_column';

export const migrations = [
  {
    up: migration_002_add_stencil_column.up,
    down: migration_002_add_stencil_column.down,
    name: '002_add_stencil_column',
  },
  {
    up: migration_20260519_102507_add_stencil_column.up,
    down: migration_20260519_102507_add_stencil_column.down,
    name: '20260519_102507_add_stencil_column'
  },
];
