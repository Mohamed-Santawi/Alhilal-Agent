-- 0004: optional VAT registration number (companies only). Saudi format: 15 digits, starts and ends with 3.
alter table customers add column if not exists vat_number text;
alter table customers add constraint customers_vat_number_format
  check (vat_number is null or vat_number ~ '^3[0-9]{13}3$');
