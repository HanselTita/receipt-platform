
import {
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class AdjustStockDto {
  @IsUUID()
  branchId: string;

  @IsUUID()
  productId: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^[+-]?(?=.*[1-9])\d+(\.\d{1,3})?$/, {
    message:
      'Adjustment must be a non-zero number with up to 3 decimal places.',
  })
  quantityChange: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(500)
  reason: string;
}
