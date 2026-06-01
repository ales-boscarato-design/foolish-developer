import * as migration_20260519_103000_add_stencil_column from './20260519_103000_add_stencil_column';
import * as migration_20260519_213245_add_feature_highlights_usageSteps_whatsInTheBox from './20260519_213245_add_feature_highlights_usageSteps_whatsInTheBox';
import * as migration_20260530_085019_add_customers_and_orders from './20260530_085019_add_customers_and_orders';
import * as migration_20260530_120000_fix_orders_columns from './20260530_120000_fix_orders_columns';
import * as migration_20260530_130000_add_products_components from './20260530_130000_add_products_components';
import * as migration_20260530_180000_add_pro_members_promo_codes from './20260530_180000_add_pro_members_promo_codes';
import * as migration_20260531_120000_add_order_customer_page from './20260531_120000_add_order_customer_page';
import * as migration_20260601_100000_localize_products from './20260601_100000_localize_products';
import * as migration_20260601_120000_fix_localization_schema from './20260601_120000_fix_localization_schema';
import * as migration_20260601_140000_add_missing_array_locales from './20260601_140000_add_missing_array_locales';

export const migrations = [
  {
    up: migration_20260519_103000_add_stencil_column.up,
    down: migration_20260519_103000_add_stencil_column.down,
    name: '20260519_103000_add_stencil_column',
  },
  {
    up: migration_20260519_213245_add_feature_highlights_usageSteps_whatsInTheBox.up,
    down: migration_20260519_213245_add_feature_highlights_usageSteps_whatsInTheBox.down,
    name: '20260519_213245_add_feature_highlights_usageSteps_whatsInTheBox',
  },
  {
    up: migration_20260530_085019_add_customers_and_orders.up,
    down: migration_20260530_085019_add_customers_and_orders.down,
    name: '20260530_085019_add_customers_and_orders',
  },
  {
    up: migration_20260530_120000_fix_orders_columns.up,
    down: migration_20260530_120000_fix_orders_columns.down,
    name: '20260530_120000_fix_orders_columns',
  },
  {
    up: migration_20260530_130000_add_products_components.up,
    down: migration_20260530_130000_add_products_components.down,
    name: '20260530_130000_add_products_components',
  },
  {
    up: migration_20260530_180000_add_pro_members_promo_codes.up,
    down: migration_20260530_180000_add_pro_members_promo_codes.down,
    name: '20260530_180000_add_pro_members_promo_codes',
  },
  {
    up: migration_20260531_120000_add_order_customer_page.up,
    down: migration_20260531_120000_add_order_customer_page.down,
    name: '20260531_120000_add_order_customer_page',
  },
  {
    up: migration_20260601_100000_localize_products.up,
    down: migration_20260601_100000_localize_products.down,
    name: '20260601_100000_localize_products',
  },
  {
    up: migration_20260601_120000_fix_localization_schema.up,
    down: migration_20260601_120000_fix_localization_schema.down,
    name: '20260601_120000_fix_localization_schema',
  },
  {
    up: migration_20260601_140000_add_missing_array_locales.up,
    down: migration_20260601_140000_add_missing_array_locales.down,
    name: '20260601_140000_add_missing_array_locales',
  },
];
