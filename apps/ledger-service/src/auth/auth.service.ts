import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { User } from './entities/user.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const EMAIL_UNIQUE_CONSTRAINT = 'UQ_97672ac88f789774dd47f7c8be3';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<TokenPair> {
    const existing = await this.users.findOne({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('Email вже зареєстровано');
    }
    const passwordHash = await bcrypt.hash(dto.password, 10);
    let user: User;
    try {
      user = await this.users.save(
        this.users.create({ email: dto.email, passwordHash }),
      );
    } catch (error) {
      if (error instanceof QueryFailedError) {
        const cause = error.driverError as { code?: string; constraint?: string };
        if (cause.code === '23505' && cause.constraint === EMAIL_UNIQUE_CONSTRAINT)
          throw new ConflictException('Email вже зареєстровано');
      }
      throw error;
    }
    return this.issueTokens(user);
  }

  async login(dto: LoginDto): Promise<TokenPair> {
    const user = await this.users.findOne({ where: { email: dto.email } });
    if (!user) {
      throw new UnauthorizedException('Невірний email або пароль');
    }
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Невірний email або пароль');
    }
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: { sub: string; sid?: string };
    try {
      payload = this.jwt.verify(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Невалідний refresh token');
    }
    const user = await this.users.findOne({ where: { id: payload.sub } });
    if (!user || !user.refreshTokenHash) {
      throw new UnauthorizedException('Refresh token відкликано');
    }
    const actual = Buffer.from(
      createHash('sha256').update(refreshToken).digest('hex'),
    );
    const expected = Buffer.from(user.refreshTokenHash);
    const matches =
      actual.length === expected.length && timingSafeEqual(actual, expected);
    if (!matches) {
      throw new UnauthorizedException('Refresh token відкликано');
    }
    const sessionId = payload.sid ?? actual.toString();
    if (sessionId !== user.refreshSessionId)
      throw new UnauthorizedException('Refresh token відкликано');
    return this.issueTokens(user, user.refreshTokenHash);
  }

  private async issueTokens(
    user: User,
    expectedRefreshHash?: string,
  ): Promise<TokenPair> {
    const payload = { sub: user.id, email: user.email, role: user.role };
    const sessionId =
      expectedRefreshHash === undefined ? randomUUID() : user.refreshSessionId!;
    const accessToken = this.jwt.sign(payload, {
      secret: process.env.JWT_ACCESS_SECRET!,
      expiresIn: process.env.JWT_ACCESS_TTL ?? '15m',
    });
    const refreshToken = this.jwt.sign(
      { ...payload, sid: sessionId },
      {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: process.env.JWT_REFRESH_TTL ?? '7d',
        jwtid: randomUUID(),
      },
    );
    user.refreshTokenHash = createHash('sha256')
      .update(refreshToken)
      .digest('hex');
    if (expectedRefreshHash !== undefined) {
      const result = await this.users.update(
        {
          id: user.id,
          refreshTokenHash: expectedRefreshHash,
          refreshSessionId: sessionId,
        },
        { refreshTokenHash: user.refreshTokenHash },
      );
      if (result.affected !== 1)
        throw new UnauthorizedException('Refresh token відкликано');
    } else {
      user.refreshSessionId = sessionId;
      await this.users.save(user);
    }
    return { accessToken, refreshToken };
  }

  async logout(refreshToken: string): Promise<void> {
    let payload: { sub: string; sid?: string };
    try {
      payload = this.jwt.verify(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET,
      });
    } catch {
      return;
    }
    // Токени одного входу мають спільний sid навіть після ротації.
    const sessionId =
      payload.sid ?? createHash('sha256').update(refreshToken).digest('hex');
    await this.users.update(
      { id: payload.sub, refreshSessionId: sessionId },
      { refreshTokenHash: null, refreshSessionId: null },
    );
  }
}
