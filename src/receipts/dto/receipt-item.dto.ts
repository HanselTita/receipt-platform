import {
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ReceiptItemDto {
  // Optional: only inventory-linked items need a product ID.
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsString()
  @MaxLength(200)
  description!: string;

  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  quantity!: number;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  discountAmount?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  taxRate?: number;
}
