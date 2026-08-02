import { ConflictException, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(private readonly usersService: UsersService) {}

  async register(registerDto: RegisterDto) {
    const normalizedEmail = registerDto.email.trim().toLowerCase();

    const existingUser = await this.usersService.findByEmail(normalizedEmail);

    if (existingUser) {
      throw new ConflictException(
        'An account with this email address already exists.',
      );
    }

    const passwordHash = await argon2.hash(registerDto.password);

    const user = await this.usersService.create({
      firstName: registerDto.firstName.trim(),
      lastName: registerDto.lastName.trim(),
      email: normalizedEmail,
      phone: registerDto.phone?.trim() || undefined,
      passwordHash,
    });

    return {
      message: 'Account created successfully.',
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        isActive: user.isActive,
        createdAt: user.createdAt,
      },
    };
  }
}
