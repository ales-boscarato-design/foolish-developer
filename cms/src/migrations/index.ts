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
import * as migration_20260601_160000_align_locales_to_payload_schema from './20260601_160000_align_locales_to_payload_schema';
import * as migration_20260601_200000_add_product_packs from './20260601_200000_add_product_packs';
import * as migration_20260601_210000_add_variant_description from './20260601_210000_add_variant_description';
import * as migration_20260601_220000_localize_variant_pack_fields from './20260601_220000_localize_variant_pack_fields';
import * as migration_20260602_100000_add_variant_image from './20260602_100000_add_variant_image';
import * as migration_20260605_120000_fix_orders_array_column_names from './20260605_120000_fix_orders_array_column_names';
import * as migration_20260605_130000_fix_customers_tags from './20260605_130000_fix_customers_tags';
import * as migration_20260607_120000_add_billing_fields_to_orders from './20260607_120000_add_billing_fields_to_orders';
import * as migration_20260610_140000_add_customer_files from './20260610_140000_add_customer_files';
import * as migration_20260610_160000_add_push_sequences from './20260610_160000_add_push_sequences';

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
  {
    up: migration_20260601_160000_align_locales_to_payload_schema.up,
    down: migration_20260601_160000_align_locales_to_payload_schema.down,
    name: '20260601_160000_align_locales_to_payload_schema',
  },
  {
    up: migration_20260601_200000_add_product_packs.up,
    down: migration_20260601_200000_add_product_packs.down,
    name: '20260601_200000_add_product_packs',
  },
  {
    up: migration_20260601_210000_add_variant_description.up,
    down: migration_20260601_210000_add_variant_description.down,
    name: '20260601_210000_add_variant_description',
  },
  {
    up: migration_20260601_220000_localize_variant_pack_fields.up,
    down: migration_20260601_220000_localize_variant_pack_fields.down,
    name: '20260601_220000_localize_variant_pack_fields',
  },
  {
    up: migration_20260602_100000_add_variant_image.up,
    down: migration_20260602_100000_add_variant_image.down,
    name: '20260602_100000_add_variant_image',
  },
  {
    up: migration_20260605_120000_fix_orders_array_column_names.up,
    down: migration_20260605_120000_fix_orders_array_column_names.down,
    name: '20260605_120000_fix_orders_array_column_names',
  },
  {
    up: migration_20260605_130000_fix_customers_tags.up,
    down: migration_20260605_130000_fix_customers_tags.down,
    name: '20260605_130000_fix_customers_tags',
  },
  {
    up: migration_20260607_120000_add_billing_fields_to_orders.up,
    down: migration_20260607_120000_add_billing_fields_to_orders.down,
    name: '20260607_120000_add_billing_fields_to_orders',
  },
  {
    up: migration_20260610_140000_add_customer_files.up,
    down: migration_20260610_140000_add_customer_files.down,
    name: '20260610_140000_add_customer_files',
  },
  {
    up: migration_20260610_160000_add_push_sequences.up,
    down: migration_20260610_160000_add_push_sequences.down,
    name: '20260610_160000_add_push_sequences',
  },
];
