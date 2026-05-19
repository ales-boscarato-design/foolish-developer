import * as migration_20260519_103000_add_stencil_column from './20260519_103000_add_stencil_column';
import * as migration_20260519_213245_add_feature_highlights_usageSteps_whatsInTheBox from './20260519_213245_add_feature_highlights_usageSteps_whatsInTheBox';

export const migrations = [
  {
    up: migration_20260519_103000_add_stencil_column.up,
    down: migration_20260519_103000_add_stencil_column.down,
    name: '20260519_103000_add_stencil_column',
  },
  {
    up: migration_20260519_213245_add_feature_highlights_usageSteps_whatsInTheBox.up,
    down: migration_20260519_213245_add_feature_highlights_usageSteps_whatsInTheBox.down,
    name: '20260519_213245_add_feature_highlights_usageSteps_whatsInTheBox'
  },
];
