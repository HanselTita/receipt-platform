
import {
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class RestockProductDto {
  @IsUUID()
  branchId: string;

  @IsUUID()
  productId: string;

  @IsNotEmpty()
  @IsNumberString()
  @Matches(/^(?=.*[1-9])\d+(\.\d{1,3})?$/, {
    message:
      'Restock quantity must be greater than zero with up to 3 decimal places.',
  })
  quantity: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
