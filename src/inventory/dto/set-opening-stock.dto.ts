
import {
  IsNotEmpty,
  IsNumberString,
  IsUUID,
  Matches,
} from 'class-validator';

export class SetOpeningStockDto {
  @IsUUID()
  branchId: string;

  @IsUUID()
  productId: string;

  @IsNotEmpty()
  @IsNumberString()
  @Matches(/^\d+(\.\d{1,3})?$/, {
    message: 'Quantity must be a non-negative number with up to 3 decimal places.',
  })
  quantity: string;

  @IsNotEmpty()
  @IsNumberString()
  @Matches(/^\d+(\.\d{1,3})?$/, {
    message: 'Reference stock must be a non-negative number with up to 3 decimal places.',
  })
  referenceStock: string;
}
