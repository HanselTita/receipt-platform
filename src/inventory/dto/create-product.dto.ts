
import {
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';

import { ProductUnit } from '../../../generated/prisma/client';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsNumberString()
  @Matches(/^\d+(\.\d{1,2})?$/)
  sellingPrice: string;

  @IsOptional()
  @IsNumberString()
  @Matches(/^\d+(\.\d{1,2})?$/)
  costPrice?: string;

  @IsEnum(ProductUnit)
  unit: ProductUnit;
}
