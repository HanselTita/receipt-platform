
-- Prevent duplicate stock deductions or reversals
-- for the same receipt item.

CREATE UNIQUE INDEX
  "StockMovement_unique_receipt_item_sale"
ON "StockMovement" ("receiptItemId")
WHERE "receiptItemId" IS NOT NULL
  AND "type" = 'SALE';

CREATE UNIQUE INDEX
  "StockMovement_unique_receipt_item_reversal"
ON "StockMovement" ("receiptItemId")
WHERE "receiptItemId" IS NOT NULL
  AND "type" = 'SALE_REVERSAL';
