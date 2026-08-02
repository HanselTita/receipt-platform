import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateBusinessDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(120)
  businessName!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(80)
  businessType!: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Length(3, 3)
  defaultCurrency!: string;

  @IsOptional()
  @IsBoolean()
  taxEnabled?: boolean;

  @ValidateIf((dto: CreateBusinessDto) => dto.taxEnabled === true)
  @IsNumber(
    {
      maxDecimalPlaces: 4,
    },
    {
      message: 'taxRate must be a valid number.',
    },
  )
  @Min(0)
  @Max(100)
  taxRate?: number;
}
