import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';

import { AuthSessionsService } from '../auth-sessions/auth-sessions.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import type { AccessTokenPayload } from './types/access-token-payload.type';
import type { RefreshTokenPayload } from './types/refresh-token-payload.type';
import { hashToken } from './utils/token-hash.util';
import { PrismaService } from '../prisma/prisma.service';

import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly authSessionsService: AuthSessionsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

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

  async login(loginDto: LoginDto) {
    const normalizedEmail = loginDto.email.trim().toLowerCase();

    const user = await this.usersService.findByEmail(normalizedEmail);

    if (!user) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('This account is inactive.');
    }

    const passwordMatches = await argon2.verify(
      user.passwordHash,
      loginDto.password,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const memberships = await this.prisma.businessMembership.findMany({
      where: {
        userId: user.id,
      },
      select: {
        status: true,
      },
    });

    const hasMembership = memberships.length > 0;

    const hasActiveMembership = memberships.some(
      (membership) => membership.status === 'ACTIVE',
    );

    if (hasMembership && !hasActiveMembership) {
      throw new UnauthorizedException(
        'Your business membership is not active.',
      );
    }

    const refreshExpiresIn = this.getRefreshTokenExpiresIn();

    const session = await this.authSessionsService.create({
      user: {
        connect: {
          id: user.id,
        },
      },
      refreshTokenHash: '',
      expiresAt: new Date(Date.now() + refreshExpiresIn * 1000),
    });

    const tokens = await this.createTokenPair(user, session.id);

    await this.authSessionsService.updateRefreshToken(session.id, {
      refreshTokenHash: hashToken(tokens.refreshToken),
      expiresAt: new Date(Date.now() + tokens.refreshExpiresIn * 1000),
    });
    return {
      message: 'Login successful.',
      tokenType: 'Bearer',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessExpiresIn: tokens.accessExpiresIn,
      refreshExpiresIn: tokens.refreshExpiresIn,
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

  async getProfile(userId: string) {
    const user = await this.usersService.findById(userId);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('The authenticated user is unavailable.');
    }

    const membership = await this.prisma.businessMembership.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
      },

      include: {
        business: {
          select: {
            id: true,
            businessName: true,
          },
        },

        branchAssignments: {
          where: {
            isActive: true,
          },

          include: {
            branch: {
              select: {
                id: true,
                branchName: true,
              },
            },
          },
        },
      },
    });

    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,

      workspace: membership
        ? {
            role: membership.role,

            business: {
              id: membership.business.id,

              businessName: membership.business.businessName,
            },

            assignedBranches: membership.branchAssignments.map(
              (assignment) => ({
                id: assignment.branch.id,

                branchName: assignment.branch.branchName,
              }),
            ),
          }
        : null,
    };
  }
  private getAccessTokenExpiresIn(): number {
    return Number(
      this.configService.get<string>('JWT_ACCESS_EXPIRES_IN_SECONDS', '900'),
    );
  }

  private getRefreshTokenExpiresIn(): number {
    return Number(
      this.configService.get<string>(
        'JWT_REFRESH_EXPIRES_IN_SECONDS',
        '2592000',
      ),
    );
  }

  private getRefreshTokenSecret(): string {
    const secret = this.configService.get<string>('JWT_REFRESH_SECRET');

    if (!secret) {
      throw new Error('JWT_REFRESH_SECRET is not defined.');
    }

    return secret;
  }

  private async createTokenPair(
    user: {
      id: string;
      email: string;
    },
    sessionId: string,
  ) {
    const accessExpiresIn = this.getAccessTokenExpiresIn();
    const refreshExpiresIn = this.getRefreshTokenExpiresIn();

    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
    };

    const refreshPayload: RefreshTokenPayload = {
      sub: user.id,
      sessionId,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        expiresIn: accessExpiresIn,
      }),

      this.jwtService.signAsync(refreshPayload, {
        secret: this.getRefreshTokenSecret(),
        expiresIn: refreshExpiresIn,
      }),
    ]);

    return {
      accessToken,
      refreshToken,
      accessExpiresIn,
      refreshExpiresIn,
    };
  }

  async refreshTokens(refreshTokenDto: RefreshTokenDto) {
    let payload: RefreshTokenPayload;

    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
        refreshTokenDto.refreshToken,
        {
          secret: this.getRefreshTokenSecret(),
        },
      );
    } catch {
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }

    const session = await this.authSessionsService.findById(payload.sessionId);

    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt ||
      session.expiresAt <= new Date()
    ) {
      throw new UnauthorizedException('Refresh session is invalid or expired.');
    }

    const submittedHash = hashToken(refreshTokenDto.refreshToken);

    if (submittedHash !== session.refreshTokenHash) {
      await this.authSessionsService.revoke(session.id);

      throw new UnauthorizedException(
        'Refresh token has already been replaced or revoked.',
      );
    }

    const user = await this.usersService.findById(payload.sub);

    if (!user || !user.isActive) {
      await this.authSessionsService.revoke(session.id);

      throw new UnauthorizedException('The authenticated user is unavailable.');
    }

    const memberships = await this.prisma.businessMembership.findMany({
      where: {
        userId: user.id,
      },
      select: {
        status: true,
      },
    });

    const hasMembership = memberships.length > 0;

    const hasActiveMembership = memberships.some(
      (membership) => membership.status === 'ACTIVE',
    );

    if (hasMembership && !hasActiveMembership) {
      await this.authSessionsService.revoke(session.id);

      throw new UnauthorizedException(
        'Your business membership is not active.',
      );
    }

    const tokens = await this.createTokenPair(user, session.id);

    await this.authSessionsService.updateRefreshToken(session.id, {
      refreshTokenHash: hashToken(tokens.refreshToken),
      expiresAt: new Date(Date.now() + tokens.refreshExpiresIn * 1000),
    });

    return {
      tokenType: 'Bearer',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessExpiresIn: tokens.accessExpiresIn,
      refreshExpiresIn: tokens.refreshExpiresIn,
    };
  }

  async logout(refreshToken: string) {
    let payload: RefreshTokenPayload;

    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
        refreshToken,
        {
          secret: this.getRefreshTokenSecret(),
          ignoreExpiration: true,
        },
      );
    } catch {
      return {
        message: 'Logged out successfully.',
      };
    }

    const session = await this.authSessionsService.findById(payload.sessionId);

    if (session && !session.revokedAt) {
      await this.authSessionsService.revoke(session.id);
    }

    return {
      message: 'Logged out successfully.',
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const currentUser = await this.usersService.findById(userId);

    if (!currentUser || !currentUser.isActive) {
      throw new UnauthorizedException('The authenticated user is unavailable.');
    }

    let normalizedEmail: string | undefined;

    if (dto.email !== undefined) {
      const email = dto.email.trim().toLowerCase();

      const existingUser = await this.usersService.findByEmail(email);

      if (existingUser && existingUser.id !== userId) {
        throw new ConflictException(
          'An account with this email address already exists.',
        );
      }

      normalizedEmail = email;
    }

    const user = await this.usersService.updateProfile(userId, {
      ...(dto.firstName !== undefined
        ? {
            firstName: dto.firstName.trim(),
          }
        : {}),

      ...(dto.lastName !== undefined
        ? {
            lastName: dto.lastName.trim(),
          }
        : {}),

      ...(normalizedEmail !== undefined
        ? {
            email: normalizedEmail,
          }
        : {}),

      ...(dto.phone !== undefined
        ? {
            phone: dto.phone.trim() || null,
          }
        : {}),
    });

    return {
      message: 'Profile updated successfully.',

      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        isActive: user.isActive,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.usersService.findById(userId);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('The authenticated user is unavailable.');
    }

    const currentPasswordMatches = await argon2.verify(
      user.passwordHash,
      dto.currentPassword,
    );

    if (!currentPasswordMatches) {
      throw new UnauthorizedException('Current password is incorrect.');
    }

    const samePassword = await argon2.verify(
      user.passwordHash,
      dto.newPassword,
    );

    if (samePassword) {
      throw new ConflictException(
        'New password must be different from your current password.',
      );
    }

    const passwordHash = await argon2.hash(dto.newPassword);

    await this.usersService.updatePassword(userId, passwordHash);

    await this.authSessionsService.revokeAllForUser(userId);

    return {
      message: 'Password changed successfully. Please log in again.',
    };
  }

  async logoutAll(userId: string) {
    const user = await this.usersService.findById(userId);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('The authenticated user is unavailable.');
    }

    const result = await this.authSessionsService.revokeAllForUser(userId);

    return {
      message: 'Logged out from all devices successfully.',
      revokedSessions: result.count,
    };
  }
}
