import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateBusinessSettingsDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  businessName?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  businessType?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  defaultCurrency?: string;

  @IsOptional()
  @IsBoolean()
  taxEnabled?: boolean;

  @IsOptional()
  @IsNumber({
    maxDecimalPlaces: 4,
  })
  @Min(0)
  @Max(100)
  taxRate?: number;
}
